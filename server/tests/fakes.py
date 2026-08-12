"""Stand-ins for the three things the estimators read.

Deliberately dumb: every test sets the exact numbers it wants and steps the
clock by hand, so nothing depends on real time or real hardware.
"""

from pipepatrol.estimation.flow import FlowSample


class Clock:
    """A monotonic clock the test moves by hand.

    Shared across successive `run_for` calls so simulated time stays contiguous.
    Restarting from a fixed number instead would hand the estimator a sudden
    ninety-second step and integrate a phantom twenty metres.
    """

    def __init__(self, now=100.0):
        self.now = now

    def advance(self, step):
        self.now += step
        return self.now


class FakeDrive:
    def __init__(self, speed_m_s=0.0, duties=(0.0, 0.0)):
        self.speed_m_s = speed_m_s
        self.duties = duties

    def drive_forward(self, speed_m_s, duty=0.5):
        self.speed_m_s = speed_m_s
        self.duties = (duty, duty)

    def stop(self):
        self.speed_m_s = 0.0
        self.duties = (0.0, 0.0)

    def status(self):
        return {"commanded_speed_m_s": self.speed_m_s}


class FakeIMU:
    """Defaults to no accelerometer at all.

    `acceleration = None` is the honest default: it is what a robot with no IMU
    fitted reports, and it keeps a test that only cares about duty or flow from
    having to opt out of the integrator.

    Anything set here is already past the deadband, exactly like the real
    hardware -- hardware/imu.py applies it before the number is readable, so a
    fake that handed out raw noise would be testing a path that cannot happen.
    """

    def __init__(self, still=False, yaw=0.0, acceleration=None):
        self.still = still
        self.yaw = yaw
        self.acceleration = acceleration

    def accelerate(self, m_s2):
        """Feel a real acceleration, i.e. one outside the deadband."""
        self.acceleration = m_s2

    def coast(self):
        """Fitted, reading cleanly, feeling nothing -- inside the deadband."""
        self.acceleration = 0.0

    def seems_still(self):
        return self.still

    def status(self):
        return {"yaw": self.yaw}


class FakeFlow:
    def __init__(self):
        self.sample = FlowSample()

    def see(self, divergence, magnitude=20.0, speed_m_s=None):
        """A tracked scene. `speed_m_s` is what the pipe's geometry priced it at.

        None means the features were tracked but the geometry could not turn
        them into metres — which odometry treats as no measurement at all,
        because an unpriced divergence is not a speed.
        """
        self.sample = FlowSample(
            divergence=divergence,
            magnitude=magnitude,
            features=60,
            valid=True,
            speed_m_s=speed_m_s,
        )

    def see_nothing(self):
        """Valid measurement, nothing moving. Not the same as an invalid one."""
        self.sample = FlowSample(
            divergence=0.0, magnitude=0.0, features=60, valid=True, speed_m_s=0.0
        )

    def blind(self):
        """No usable features -- a dark or featureless pipe wall."""
        self.sample = FlowSample()

    def latest(self):
        return self.sample
