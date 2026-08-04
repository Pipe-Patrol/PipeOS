"""How far the robot has gone, without anything that measures how far it has gone.

There are no wheel encoders. Two weak sources are blended here, chosen because
they fail differently:

  duty      Commanded duty x top speed x time. Knows exactly what the motors
            were told and nothing about whether the robot obeyed. Wrong on every
            slip, and slip is the normal condition in a wet pipe.

  visual    Radial optical flow (estimation/flow.py) scaled into m/s. Sees what
            actually moved. Scale-ambiguous on its own, and blind when the pipe
            wall is too dark or too smooth to hold a feature.

The blend: duty teaches visual its scale while the robot is confidently rolling,
then visual is trusted to correct duty -- which is precisely the slip case,
where the wheels turn and the picture does not.

NOT used: double integration of IMU acceleration. The error grows with the
square of time, so over a five-minute run the number is meaningless. The IMU's
acceleration appears here only as a yes/no on whether anything is moving.

Everything this module produces is an estimate and is reported as one. The
uncertainty only ever grows -- there is no GPS underground to re-fix it.
"""

import math
import threading
import time

from pipepatrol.hardware import drive as drive_module

# Duty below which we do not attempt to learn anything. Near MIN_DUTY the
# relationship between duty and speed is least linear.
CALIBRATION_MIN_SPEED_M_S = 0.5 * drive_module.TOP_SPEED_M_S

# Divergence below this is indistinguishable from noise, so it must not become
# the denominator of a scale estimate.
CALIBRATION_MIN_DIVERGENCE = 0.05

# The scale factor moves slowly. It is a property of the pipe's diameter and the
# camera's field of view, neither of which changes mid-run.
SCALE_SMOOTHING = 0.05

# Fraction of travelled distance added to the uncertainty each step. Visual
# correction roughly triples the confidence, which is the whole reason for it.
ERROR_FRACTION_FUSED = 0.08
ERROR_FRACTION_DUTY = 0.25

# Visual speed above this multiple of the commanded speed is rejected: the
# wheels are the upper bound on how fast the chassis can be going, so a larger
# number means the flow estimate has been fooled, not that the robot sped up.
MAX_VISUAL_OVERSHOOT = 1.3


class OdometryState:
    __slots__ = (
        "distance_travelled_m",
        "chainage_m",
        "speed_m_s",
        "uncertainty_m",
        "heading_deg",
        "x_m",
        "y_m",
        "source",
        "slipping",
        "scale",
        "calibrated",
    )

    def __init__(self):
        self.distance_travelled_m = 0.0
        self.chainage_m = 0.0
        self.speed_m_s = 0.0
        self.uncertainty_m = 0.0
        self.heading_deg = 0.0
        self.x_m = 0.0
        self.y_m = 0.0
        self.source = "stopped"
        self.slipping = False
        self.scale = None
        self.calibrated = False

    def as_dict(self):
        return {
            "quality": "estimated",
            "distance_travelled_m": round(self.distance_travelled_m, 2),
            "chainage_m": round(self.chainage_m, 2),
            "speed_m_s": round(self.speed_m_s, 3),
            "uncertainty_m": round(self.uncertainty_m, 2),
            "heading_deg": round(self.heading_deg, 1),
            "position": {"x": round(self.x_m, 2), "y": round(self.y_m, 2)},
            "source": self.source,
            "slipping": self.slipping,
            "calibrated": self.calibrated,
        }


class Odometry:
    """Fuses commanded speed with visual flow into a distance estimate.

    `update()` is called from the telemetry loop, which owns the clock. Nothing
    here runs on its own thread.
    """

    def __init__(self, drive, imu, flow):
        self._drive = drive
        self._imu = imu
        self._flow = flow
        self._lock = threading.Lock()
        self._state = OdometryState()
        self._scale = None
        self._last_at = None
        self._yaw_origin = None

    def reset(self):
        """Zero the run. Keeps the learned visual scale -- the pipe has not changed."""
        with self._lock:
            scale = self._scale
            self._state = OdometryState()
            self._state.scale = scale
            self._state.calibrated = scale is not None
            self._last_at = None
            self._yaw_origin = None

    def update(self, now=None):
        """Advance the estimate by one step. Returns the new state."""
        now = time.monotonic() if now is None else now
        with self._lock:
            if self._last_at is None:
                self._last_at = now
                return self._state

            dt = now - self._last_at
            self._last_at = now
            if dt <= 0:
                return self._state

            commanded = self._drive.status()["commanded_speed_m_s"]
            sample = self._flow.latest()

            self._learn_scale(commanded, sample)
            speed, source, slipping = self._fuse(commanded, sample)

            step = speed * dt
            state = self._state
            state.speed_m_s = speed
            state.source = source
            state.slipping = slipping
            state.distance_travelled_m += abs(step)
            state.chainage_m += step
            state.uncertainty_m += abs(step) * (
                ERROR_FRACTION_FUSED if source == "fused" else ERROR_FRACTION_DUTY
            )
            state.scale = self._scale
            state.calibrated = self._scale is not None

            self._advance_position(state, step)
            return state

    # --- internals ---

    def _learn_scale(self, commanded, sample):
        """Teach the flow estimator what a metre per second looks like.

        Only while the robot is unambiguously rolling: a decent commanded speed,
        the IMU agreeing something is moving, and a divergence large enough to
        divide by. Learning during a slip would bake the slip into the scale.
        """
        if not sample.valid or abs(commanded) < CALIBRATION_MIN_SPEED_M_S:
            return
        if abs(sample.divergence) < CALIBRATION_MIN_DIVERGENCE:
            return
        if self._imu.seems_still():
            return
        # Divergence is positive moving forward; the signs must agree or we are
        # looking at something other than our own translation.
        if (commanded > 0) != (sample.divergence > 0):
            return

        observed = abs(commanded) / abs(sample.divergence)
        if self._scale is None:
            self._scale = observed
        else:
            self._scale += SCALE_SMOOTHING * (observed - self._scale)

    def _fuse(self, commanded, sample):
        """Returns (speed_m_s, source, slipping)."""
        if commanded == 0.0:
            return 0.0, "stopped", False

        if not sample.valid or self._scale is None:
            return commanded, "duty", False

        visual = math.copysign(abs(sample.divergence) * self._scale, sample.divergence)

        # The wheels bound the chassis. A visual estimate above that is the flow
        # being fooled -- by a hand passing the lens, or the robot being carried.
        ceiling = abs(commanded) * MAX_VISUAL_OVERSHOOT
        if abs(visual) > ceiling:
            return commanded, "duty", False

        # Signs disagreeing means the picture says one thing and the wheels
        # another. Trust the picture and call it what it is.
        slipping = abs(visual) < abs(commanded) * 0.5
        return visual, "fused", slipping

    def _advance_position(self, state, step):
        """Dead-reckon x/y from the IMU's yaw.

        Yaw is game-rotation-vector yaw: relative to startup and drifting, with
        no magnetometer behind it. Zeroed at the first sample so the run starts
        pointing along +x, which is the only claim about direction this can
        honestly make.
        """
        yaw = self._imu.status().get("yaw")
        if yaw is None:
            heading = state.heading_deg
        else:
            if self._yaw_origin is None:
                self._yaw_origin = yaw
            heading = (yaw - self._yaw_origin + 180.0) % 360.0 - 180.0
            state.heading_deg = heading

        radians = math.radians(heading)
        state.x_m += step * math.cos(radians)
        state.y_m += step * math.sin(radians)

    def status(self):
        with self._lock:
            return self._state.as_dict()
