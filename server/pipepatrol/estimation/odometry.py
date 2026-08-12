"""How far the robot has gone, measured only by what the camera saw.

ONE SOURCE, ON PURPOSE. This used to blend three: an integrated IMU
acceleration, the commanded motor duty, and optical flow. It no longer does.
Distance now comes from the picture and from nothing else.

The reason is that the other two were never measuring the robot's progress down
the pipe -- they were measuring the robot's *intent*, and then being corrected
back towards the picture whenever the picture disagreed:

  duty      knows exactly what the motors were told and nothing about whether
            the robot obeyed. Wrong on every slip, and slip is the normal
            condition in a wet pipe. It could not disagree with the wheels
            because it *was* the wheels.

  inertial  responds to the chassis genuinely starting and stopping, but a
            noisy acceleration integrated twice is a distance that drifts on
            its own, and the deadband that made it survivable also made a
            steady crawl indistinguishable from a stop.

Both had to be bounded by the visual estimate to stay believable, which is the
tell: the visual estimate was already the answer, and the other two were error
terms wearing a sensor's name. Removing them removes the failure mode where a
robot with spinning wheels logs metres it never travelled.

WHAT MAKES THIS METRIC. estimation/flow.py turns radial optical flow into metres
per second using the pipe's own diameter as the ruler -- see its header. So
there is no calibration run, no scale learned off the duty, and nothing here
that has to be told what a metre looks like.

WHAT IT COSTS. A camera that cannot see gives no distance at all. A dark or
glass-smooth wall holds no feature to track, and where the old fusion would have
carried on off the wheels, this reports that it is blind and stops the odometer.
That is the intended trade: a gap in the record is recoverable, and a confident
wrong distance is not. A short coast (COAST_S) covers the flicker between two
good patches without inventing a journey.

Everything this module produces is an estimate and is reported as one. The
uncertainty only ever grows -- there is no GPS underground to re-fix it.
"""

import threading
import time

# How long a valid visual speed is carried through a blind patch before the
# odometer stops. Long enough to bridge a few dropped frames or a bare stretch
# of wall, short enough that it cannot manufacture a metre on its own.
COAST_S = 1.0

# Fraction of travelled distance added to the uncertainty each step. Measured
# motion is the confident case; a coast is an extrapolation and is priced like
# one.
ERROR_FRACTION_VISUAL = 0.08
ERROR_FRACTION_COAST = 0.35

ERROR_FRACTION = {
    "stopped": 0.0,
    "blind": 0.0,
    "visual": ERROR_FRACTION_VISUAL,
    "coasting": ERROR_FRACTION_COAST,
}


class OdometryState:
    __slots__ = (
        "distance_travelled_m",
        "chainage_m",
        "speed_m_s",
        "uncertainty_m",
        "x_m",
        "source",
        "blind",
    )

    def __init__(self):
        self.distance_travelled_m = 0.0
        self.chainage_m = 0.0
        self.speed_m_s = 0.0
        self.uncertainty_m = 0.0
        self.x_m = 0.0
        self.source = "stopped"
        self.blind = False

    def as_dict(self):
        return {
            "quality": "estimated",
            "distance_travelled_m": round(self.distance_travelled_m, 2),
            "chainage_m": round(self.chainage_m, 2),
            "speed_m_s": round(self.speed_m_s, 3),
            "uncertainty_m": round(self.uncertainty_m, 2),
            # A pipe is the ruler and the pipe is straight, so the track is the
            # chainage laid along the direction the run was entered in. There is
            # no yaw here any more, and a heading invented from one would be a
            # drifting number drawn on a map as if it were a bearing.
            "heading_deg": 0.0,
            "position": {"x": round(self.x_m, 2), "y": 0.0},
            "source": self.source,
            # Kept, and always false: slip is a disagreement between the wheels
            # and the picture, and the wheels are no longer part of this. A
            # slipping robot now simply logs no distance, which is the truth.
            "slipping": False,
            "blind": self.blind,
            # Nothing to calibrate: the scale comes from the pipe's diameter.
            "calibrated": True,
        }


class Odometry:
    """Turns optical flow into a distance travelled.

    `update()` is called from the telemetry loop, which owns the clock. Nothing
    here runs on its own thread.
    """

    def __init__(self, flow):
        self._flow = flow
        self._lock = threading.Lock()
        self._state = OdometryState()
        self._last_at = None
        # The last speed the camera actually measured, and when. Together these
        # are the whole of the coast.
        self._last_visual = 0.0
        self._last_visual_at = None

    def reset(self):
        """Zero the run."""
        with self._lock:
            self._state = OdometryState()
            self._last_at = None
            self._last_visual = 0.0
            self._last_visual_at = None

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

            speed, source = self._visual_speed(self._flow.latest(), now)

            step = speed * dt
            state = self._state
            state.speed_m_s = speed
            state.source = source
            state.blind = source == "blind"
            state.distance_travelled_m += abs(step)
            state.chainage_m += step
            state.x_m += step
            state.uncertainty_m += abs(step) * ERROR_FRACTION.get(
                source, ERROR_FRACTION_COAST
            )
            return state

    def _visual_speed(self, sample, now):
        """(metres per second, source) from the picture alone.

        `speed_m_s` is metric already -- flow.py derives it from the pipe's
        diameter. A sample that is valid but carries no metric speed means the
        geometry could not price the motion, and an unpriced divergence is not a
        speed: it is treated as blind rather than guessed at.
        """
        if sample.valid and sample.speed_m_s is not None:
            self._last_visual = sample.speed_m_s
            self._last_visual_at = now
            return sample.speed_m_s, "visual"

        if self._last_visual_at is not None and now - self._last_visual_at <= COAST_S:
            return self._last_visual, "coasting"

        # Held at the last speed for COAST_S and then dropped, rather than
        # decayed: a robot whose camera has gone dark is not slowing down, it is
        # unmeasured, and the odometer should say so by not moving.
        self._last_visual = 0.0
        return 0.0, "blind"

    def status(self):
        with self._lock:
            return self._state.as_dict()
