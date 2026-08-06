"""Distance estimation, including the case it exists for: wheels that slip."""

import pytest

from pipepatrol.estimation.odometry import Odometry
from tests.fakes import Clock, FakeDrive, FakeFlow, FakeIMU


@pytest.fixture
def rig():
    drive, imu, flow = FakeDrive(), FakeIMU(), FakeFlow()
    return drive, imu, flow, Odometry(drive, imu, flow), Clock()


def run_for(odometry, seconds, clock, step=0.1):
    """Step the estimator over `seconds` of simulated time.

    The clock is shared, so a second call continues where the first stopped.
    """
    odometry.update(clock.now)  # establishes the clock; a no-op afterwards
    state = odometry.status()
    for _ in range(int(seconds / step)):
        state = odometry.update(clock.advance(step))
    return state


class TestWithoutFlow:
    def test_falls_back_to_commanded_duty(self, rig):
        drive, _, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.blind()

        state = run_for(odometry, 10.0, clock)

        assert state.source == "duty"
        assert state.distance_travelled_m == pytest.approx(2.0, abs=0.05)
        assert state.chainage_m == pytest.approx(2.0, abs=0.05)

    def test_uncertainty_grows_faster_without_flow(self, rig):
        drive, _, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.blind()

        state = run_for(odometry, 10.0, clock)

        # 25% of travelled distance, per ERROR_FRACTION_DUTY.
        assert state.uncertainty_m == pytest.approx(0.5, abs=0.02)


class TestWithFlow:
    def test_learns_a_scale_and_fuses(self, rig):
        drive, _, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.see(divergence=0.5)

        state = run_for(odometry, 20.0, clock)

        assert state.calibrated is True
        assert state.source == "fused"
        # scale converges on 0.2 / 0.5 = 0.4, so visual speed lands back on 0.2.
        assert state.speed_m_s == pytest.approx(0.2, abs=0.02)

    def test_uncertainty_grows_slower_once_fused(self, rig):
        drive, _, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.see(divergence=0.5)

        state = run_for(odometry, 20.0, clock)

        assert state.uncertainty_m < 0.25 * state.distance_travelled_m


class TestSlip:
    def test_wheels_turning_and_picture_still_stops_the_odometer(self, rig):
        drive, _, flow, odometry, clock = rig

        # Calibrate on a genuine roll.
        drive.drive_forward(0.2)
        flow.see(divergence=0.5)
        run_for(odometry, 20.0, clock)
        rolled = odometry.status()["distance_travelled_m"]

        # Now the wheels spin and nothing on screen moves.
        flow.see_nothing()
        state = run_for(odometry, 10.0, clock)

        assert state.slipping is True
        assert state.speed_m_s == pytest.approx(0.0, abs=0.01)
        # The odometer barely advanced across those ten seconds -- which is the
        # whole point. Duty integration alone would have added two metres.
        assert state.distance_travelled_m == pytest.approx(rolled, abs=0.05)

    def test_implausible_visual_speed_is_rejected(self, rig):
        drive, _, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.see(divergence=0.5)
        run_for(odometry, 20.0, clock)

        # Something crossed the lens: flow says far faster than the wheels can go.
        flow.see(divergence=5.0)
        state = run_for(odometry, 1.0, clock)

        assert state.source == "duty"
        assert state.speed_m_s == pytest.approx(0.2, abs=0.01)


class TestStopped:
    def test_nothing_accumulates_while_stopped(self, rig):
        drive, _, flow, odometry, clock = rig
        drive.stop()
        flow.see(divergence=0.4)

        state = run_for(odometry, 30.0, clock)

        assert state.source == "stopped"
        assert state.distance_travelled_m == 0.0
        assert state.uncertainty_m == 0.0


class TestReverse:
    def test_chainage_falls_and_the_odometer_does_not(self, rig):
        drive, _, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.blind()
        run_for(odometry, 10.0, clock)

        drive.drive_forward(-0.2)
        state = run_for(odometry, 5.0, clock)

        assert state.chainage_m == pytest.approx(1.0, abs=0.05)
        assert state.distance_travelled_m == pytest.approx(3.0, abs=0.05)


class TestInertial:
    """Distance built by integrating acceleration, and the deadband that makes
    that survivable. See the module docstring in estimation/odometry.py."""

    def test_acceleration_builds_a_velocity(self, rig):
        drive, imu, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.blind()
        imu.accelerate(0.4)

        state = run_for(odometry, 0.5, clock)

        # 0.4 m/s^2 for half a second, capped by nothing yet.
        assert state.source == "inertial"
        assert state.speed_m_s == pytest.approx(0.2, abs=0.05)

    def test_a_steady_crawl_keeps_logging_distance(self, rig):
        """The case a naive deadband gets catastrophically wrong.

        Steady speed means zero acceleration. If the deadband were read as "not
        moving", a robot crawling forty metres down a pipe at a constant 20 cm/s
        would log almost none of it.
        """
        drive, imu, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.blind()

        imu.accelerate(0.4)
        run_for(odometry, 0.5, clock)  # up to speed
        imu.coast()  # inside the deadband: no acceleration to feel
        state = run_for(odometry, 10.0, clock)

        assert state.speed_m_s == pytest.approx(0.2, abs=0.05)
        assert state.distance_travelled_m == pytest.approx(2.05, abs=0.15)

    def test_the_deadband_alone_does_not_stop_the_odometer(self, rig):
        drive, imu, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.blind()
        imu.accelerate(0.4)
        run_for(odometry, 0.5, clock)

        imu.coast()
        before = odometry.status()["distance_travelled_m"]
        run_for(odometry, 5.0, clock)

        assert odometry.status()["distance_travelled_m"] > before

    def test_stopped_and_feeling_nothing_zeroes_the_velocity(self, rig):
        """Deadband AND no throttle. Only both together mean parked."""
        drive, imu, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.blind()
        imu.accelerate(0.4)
        run_for(odometry, 1.0, clock)

        drive.stop()
        imu.coast()
        state = run_for(odometry, 1.0, clock)
        travelled = state.distance_travelled_m

        state = run_for(odometry, 60.0, clock)

        assert state.speed_m_s == 0.0
        # A whole minute parked adds nothing. Integrating noise instead would
        # have quietly logged metres the robot never travelled.
        assert state.distance_travelled_m == pytest.approx(travelled, abs=0.001)

    def test_drift_cannot_exceed_what_the_motors_could_deliver(self, rig):
        """A stuck-high accelerometer must not integrate into a fantasy."""
        drive, imu, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.blind()
        imu.accelerate(9.0)

        state = run_for(odometry, 30.0, clock)

        assert state.speed_m_s <= odometry_ceiling()

    def test_the_camera_corrects_the_integrator_on_a_slip(self, rig):
        drive, imu, flow, odometry, clock = rig

        # Calibrate the visual scale on a genuine roll, as ever.
        drive.drive_forward(0.2)
        flow.see(divergence=0.5)
        run_for(odometry, 20.0, clock)

        # Now the wheels spin and the picture holds still. The accelerometer
        # feels nothing either -- a robot going nowhere is not accelerating.
        imu.coast()
        flow.see_nothing()
        state = run_for(odometry, 10.0, clock)

        assert state.slipping is True
        assert state.speed_m_s == pytest.approx(0.0, abs=0.02)

    def test_falls_back_to_duty_when_no_accelerometer_is_fitted(self, rig):
        drive, imu, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.blind()
        assert imu.acceleration is None

        state = run_for(odometry, 10.0, clock)

        assert state.source == "duty"
        assert state.distance_travelled_m == pytest.approx(2.0, abs=0.05)


def odometry_ceiling():
    from pipepatrol.estimation.odometry import SPEED_CEILING_M_S

    return SPEED_CEILING_M_S


class TestReset:
    def test_zeroes_the_run_but_keeps_the_learned_scale(self, rig):
        drive, _, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.see(divergence=0.5)
        run_for(odometry, 20.0, clock)

        odometry.reset()
        state = odometry.status()

        assert state["distance_travelled_m"] == 0.0
        assert state["uncertainty_m"] == 0.0
        # The pipe did not change while the operator started a new run.
        assert state["calibrated"] is True


class TestHeading:
    def test_position_dead_reckons_along_the_heading(self, rig):
        drive, imu, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.blind()
        imu.yaw = 90.0  # zeroed at the first sample, so this is still "straight"

        state = run_for(odometry, 10.0, clock)

        assert state.heading_deg == pytest.approx(0.0, abs=0.1)
        assert state.x_m == pytest.approx(2.0, abs=0.05)
        assert state.y_m == pytest.approx(0.0, abs=0.05)

    def test_a_turn_curves_the_track(self, rig):
        drive, imu, flow, odometry, clock = rig
        drive.drive_forward(0.2)
        flow.blind()
        run_for(odometry, 5.0, clock)

        imu.yaw = 90.0  # a right-angle turn away from the startup heading
        state = run_for(odometry, 5.0, clock)

        assert state.heading_deg == pytest.approx(90.0, abs=0.1)
        assert state.x_m == pytest.approx(1.0, abs=0.05)
        assert state.y_m == pytest.approx(1.0, abs=0.05)
