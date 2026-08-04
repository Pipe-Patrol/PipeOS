"""Stall and obstruction inference — both heuristics, both debounced."""

import pytest

from pipepatrol.estimation.obstacle import Hazards
from tests.fakes import FakeDrive, FakeFlow, FakeIMU


@pytest.fixture
def rig():
    drive, imu, flow = FakeDrive(), FakeIMU(), FakeFlow()
    return drive, imu, flow, Hazards(drive, imu, flow)


def hold(hazards, seconds, start=100.0, step=0.1, **kwargs):
    now = start
    for _ in range(int(seconds / step)):
        now += step
        state = hazards.update(now=now, **kwargs)
    return state


class TestStall:
    def test_fires_when_driving_but_nothing_moves(self, rig):
        drive, imu, flow, hazards = rig
        drive.drive_forward(0.2, duty=0.5)
        imu.still = True
        flow.see_nothing()

        assert hold(hazards, 2.0)["stalled"] is True

    def test_does_not_fire_before_the_debounce(self, rig):
        drive, imu, flow, hazards = rig
        drive.drive_forward(0.2, duty=0.5)
        imu.still = True
        flow.see_nothing()

        assert hold(hazards, 0.4)["stalled"] is False

    def test_does_not_fire_while_the_picture_is_moving(self, rig):
        drive, imu, flow, hazards = rig
        drive.drive_forward(0.2, duty=0.5)
        imu.still = True
        flow.see(divergence=0.3, magnitude=25.0)

        assert hold(hazards, 3.0)["stalled"] is False

    def test_does_not_fire_when_stopped(self, rig):
        drive, imu, flow, hazards = rig
        drive.stop()
        imu.still = True
        flow.see_nothing()

        assert hold(hazards, 3.0)["stalled"] is False

    def test_clears_as_soon_as_something_moves(self, rig):
        drive, imu, flow, hazards = rig
        drive.drive_forward(0.2, duty=0.5)
        imu.still = True
        flow.see_nothing()
        assert hold(hazards, 2.0)["stalled"] is True

        imu.still = False
        assert hazards.update(now=200.0)["stalled"] is False

    def test_a_dead_imu_alone_does_not_fire_it(self, rig):
        # seems_still() is False when there is no reading, so an absent IMU
        # cannot manufacture a stall.
        drive, imu, flow, hazards = rig
        drive.drive_forward(0.2, duty=0.5)
        imu.still = False
        flow.blind()

        assert hold(hazards, 5.0)["stalled"] is False


class TestObstruction:
    def test_warns_as_time_to_contact_falls(self, rig):
        drive, _, flow, hazards = rig
        drive.drive_forward(0.2, duty=0.5)
        flow.see(divergence=0.4)  # ttc = 2.5 s

        state = hold(hazards, 1.0, speed_m_s=0.2)

        assert state["obstruction"]["level"] == "warning"
        assert state["time_to_contact_s"] == pytest.approx(2.5, abs=0.1)

    def test_escalates_when_contact_is_imminent(self, rig):
        drive, _, flow, hazards = rig
        drive.drive_forward(0.2, duty=0.5)
        flow.see(divergence=1.0)  # ttc = 1.0 s

        state = hold(hazards, 1.0, speed_m_s=0.2)

        assert state["obstruction"]["level"] == "critical"
        assert state["obstruction"]["estimated_distance_m"] == pytest.approx(0.2, abs=0.05)

    def test_silent_in_open_pipe(self, rig):
        drive, _, flow, hazards = rig
        drive.drive_forward(0.2, duty=0.5)
        flow.see(divergence=0.05)  # ttc = 20 s

        assert hold(hazards, 2.0, speed_m_s=0.2)["obstruction"] is None

    def test_silent_while_reversing(self, rig):
        # Divergence is about what is in front of the camera; backing away from
        # it is not an approach.
        drive, _, flow, hazards = rig
        drive.drive_forward(-0.2, duty=-0.5)
        flow.see(divergence=1.0)

        assert hold(hazards, 2.0, speed_m_s=-0.2)["obstruction"] is None
