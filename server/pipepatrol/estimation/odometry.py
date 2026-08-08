"""How far the robot has gone, without anything that measures how far it has gone.

There are no wheel encoders. Three weak sources are blended here, chosen because
they fail differently:

  inertial  IMU acceleration integrated into a velocity. Responds immediately to
            the robot actually starting, stopping and being dragged, and is the
            only source that knows about motion the wheels did not cause. Drifts,
            because integrating a noisy number accumulates its noise.

  duty      Commanded duty x top speed x time. Knows exactly what the motors
            were told and nothing about whether the robot obeyed. Wrong on every
            slip, and slip is the normal condition in a wet pipe.

  visual    Radial optical flow (estimation/flow.py), made metric by the pipe's
            own diameter rather than by a factor learned off the wheels — so it
            is free to disagree with them, which is the only reason to have it.
            Sees what
            actually moved. Scale-ambiguous on its own, and blind when the pipe
            wall is too dark or too smooth to hold a feature.

The blend, when the IMU is fitted: acceleration integrates into velocity,
duty bounds it (the wheels are the only thing that can push this chassis, so
they cap how fast it can be going), and visual corrects it -- which is precisely
the slip case, where the wheels turn and the picture does not. With no
accelerometer it falls back to the duty/visual fusion alone.

THE DEADBAND IS WHAT MAKES INTEGRATION SURVIVABLE. hardware/imu.py reports
acceleration inside +/- 0.1 m/s^2 as exactly zero, so:

    accelerating      velocity climbs
    steady crawl      acceleration reads 0, velocity is HELD -- distance keeps
                      accumulating, which is the case a naive "no acceleration
                      means no movement" rule gets catastrophically wrong
    stopped           acceleration reads 0 AND nothing is commanded, so the
                      velocity is forced to zero rather than left to drift

Without that, sensor noise around zero integrates into a phantom velocity and a
robot standing still slowly logs metres it never travelled.

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
# Between the two: better than duty alone because it responds to real motion,
# worse than a visually corrected estimate because nothing bounds its drift.
ERROR_FRACTION_INERTIAL = 0.15

# Visual speed above this multiple of the commanded speed is rejected: the
# wheels are the upper bound on how fast the chassis can be going, so a larger
# number means the flow estimate has been fooled, not that the robot sped up.
MAX_VISUAL_OVERSHOOT = 1.3

# How hard the camera pulls the integrated velocity back per step, at 10 Hz.
# Low enough that a flicker of bad flow does not throw the estimate, high enough
# that a genuine slip shows up within about a second.
VISUAL_CORRECTION = 0.25

# The chassis cannot exceed what the motors can deliver, so neither can the
# integrated velocity. This is the ceiling that stops accelerometer drift from
# running away into a number nobody would believe.
SPEED_CEILING_M_S = drive_module.TOP_SPEED_M_S * MAX_VISUAL_OVERSHOOT

# How much of the travelled distance each source adds to the uncertainty.
ERROR_FRACTION = {
    "stopped": 0.0,
    "duty": ERROR_FRACTION_DUTY,
    "fused": ERROR_FRACTION_FUSED,
    "inertial": ERROR_FRACTION_INERTIAL,
    "inertial+flow": ERROR_FRACTION_FUSED,
}


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
        # Carried between steps: this is the integrator, and it is the reason
        # a steady crawl keeps logging distance while acceleration reads zero.
        self._velocity = 0.0

    def reset(self):
        """Zero the run. Keeps the learned visual scale -- the pipe has not changed."""
        with self._lock:
            scale = self._scale
            self._state = OdometryState()
            self._state.scale = scale
            self._state.calibrated = scale is not None
            self._last_at = None
            self._yaw_origin = None
            self._velocity = 0.0

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
            accel = self._imu.acceleration

            self._learn_scale(commanded, sample)
            if accel is None:
                # No accelerometer fitted, or it has gone quiet. Nothing to
                # integrate, so this is the duty/visual estimate on its own.
                speed, source, slipping = self._fuse(commanded, sample)
                self._velocity = speed
            else:
                speed, source, slipping = self._integrate(accel, commanded, sample, dt)

            step = speed * dt
            state = self._state
            state.speed_m_s = speed
            state.source = source
            state.slipping = slipping
            state.distance_travelled_m += abs(step)
            state.chainage_m += step
            state.uncertainty_m += abs(step) * ERROR_FRACTION.get(
                source, ERROR_FRACTION_DUTY
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

    def _integrate(self, accel, commanded, sample, dt):
        """Advance the velocity by the measured acceleration. Returns
        (speed_m_s, source, slipping).

        `accel` arrives deadbanded from hardware/imu.py, so a zero here means
        "no acceleration worth believing" rather than "a perfect zero was
        measured". Everything below turns on that distinction.
        """
        # The IMU reports a magnitude -- one number, not three axes -- so it
        # cannot say which way the robot accelerated. The throttle can: the
        # motors are the only thing that pushes this chassis, so their direction
        # is the direction of any acceleration they caused. Coasting keeps the
        # sign of the velocity already established.
        if commanded > 0:
            direction = 1.0
        elif commanded < 0:
            direction = -1.0
        else:
            direction = math.copysign(1.0, self._velocity) if self._velocity else 0.0

        # accel == 0 inside the deadband, so this HOLDS the velocity rather than
        # decaying it. A steady crawl reads no acceleration and still travels.
        velocity = self._velocity + accel * direction * dt

        # Nothing is being commanded and nothing is being felt: the robot is
        # stopped. Said explicitly, because a velocity that is only ever
        # integrated never quite returns to zero on its own, and the difference
        # between "parked" and "creeping at 2 cm/s forever" is a run that logs
        # forty phantom metres over a lunch break.
        if accel == 0.0 and commanded == 0.0:
            velocity = 0.0

        # The wheels bound the chassis. Drift cannot exceed what the motors
        # could physically have delivered.
        velocity = max(-SPEED_CEILING_M_S, min(SPEED_CEILING_M_S, velocity))

        source = "inertial"
        slipping = False

        # The camera is the only source that sees what actually moved, so where
        # it is usable it corrects the integrator rather than the other way
        # round. This is what stops the drift compounding over a long run.
        visual = self._visual_speed(sample)
        if visual is not None:
            ceiling = abs(commanded) * MAX_VISUAL_OVERSHOOT
            if commanded != 0.0 and abs(visual) <= ceiling:
                velocity += VISUAL_CORRECTION * (visual - velocity)
                source = "inertial+flow"
                slipping = abs(visual) < abs(commanded) * 0.5

        self._velocity = velocity
        return velocity, source, slipping

    def _visual_speed(self, sample):
        """Metres per second off the picture alone, or None.

        Two ways to get one, in order of how much they can be trusted:

          1. The pipe's own geometry (estimation/flow.py). Metric with no
             calibration, and — the point of it — derived without reference to
             the wheels, so it can contradict them. That is the whole reason a
             visual estimate exists: slipping wheels move the odometer and not
             the picture.

          2. The learned scale, from duty. Kept as the fallback for the case
             the geometry cannot cover: an unknown or badly deformed bore, where
             the assumed diameter would be a wrong ruler rather than no ruler.
        """
        if not sample.valid:
            return None
        if sample.speed_m_s is not None:
            return sample.speed_m_s
        if self._scale is None:
            return None
        return math.copysign(abs(sample.divergence) * self._scale, sample.divergence)

    def _fuse(self, commanded, sample):
        """Returns (speed_m_s, source, slipping)."""
        if commanded == 0.0:
            return 0.0, "stopped", False

        visual = self._visual_speed(sample)
        if visual is None:
            return commanded, "duty", False

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
