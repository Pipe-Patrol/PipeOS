"""Distance estimation, which is now optical flow and nothing else.

The cases worth holding on to are the ones that used to be covered by fusing in
the wheels: a slip, a stall, and a camera that has gone dark. All three are now
answered by the same rule -- no picture, no distance -- and these check that the
rule does not quietly become "no picture, guess".
"""

import pytest

from pipepatrol.estimation.odometry import COAST_S, Odometry
from tests.fakes import Clock, FakeFlow


@pytest.fixture
def rig():
    flow = FakeFlow()
    return flow, Odometry(flow), Clock()


def run_for(odometry, seconds, clock, step=0.1):
    """Step the estimator over `seconds` of simulated time.

    The clock is shared, so a second call continues where the first stopped.
    """
    odometry.update(clock.now)  # establishes the clock; a no-op afterwards
    state = odometry.status()
    for _ in range(int(seconds / step)):
        state = odometry.update(clock.advance(step))
    return state


class TestVisual:
    def test_distance_is_the_measured_speed_integrated(self, rig):
        flow, odometry, clock = rig
        flow.see(divergence=0.5, speed_m_s=0.2)

        state = run_for(odometry, 10.0, clock)

        assert state.source == "visual"
        assert state.speed_m_s == pytest.approx(0.2, abs=0.001)
        assert state.distance_travelled_m == pytest.approx(2.0, abs=0.05)
        assert state.chainage_m == pytest.approx(2.0, abs=0.05)

    def test_a_tracked_scene_with_no_metric_price_is_not_a_speed(self, rig):
        """Features tracked, geometry unable to say how fast. Not a measurement.

        The old estimator would have fallen back on a scale learned from the
        duty here, which is the circularity the visual estimate exists to break.
        """
        flow, odometry, clock = rig
        flow.see(divergence=0.5, speed_m_s=None)

        state = run_for(odometry, 10.0, clock)

        assert state.source == "blind"
        assert state.distance_travelled_m == 0.0


class TestSlip:
    def test_a_still_picture_logs_no_distance(self, rig):
        """The case the whole design turns on: wheels spinning, robot going
        nowhere. There is no throttle in this estimator to disagree with, so a
        slip is simply a scene that did not move."""
        flow, odometry, clock = rig
        flow.see(divergence=0.5, speed_m_s=0.2)
        run_for(odometry, 10.0, clock)
        rolled = odometry.status()["distance_travelled_m"]

        flow.see_nothing()
        state = run_for(odometry, 10.0, clock)

        assert state.speed_m_s == 0.0
        assert state.distance_travelled_m == pytest.approx(rolled, abs=0.001)
        # Reported as a measurement, because it is one: the camera looked and
        # nothing moved.
        assert state.source == "visual"
        assert state.blind is False


class TestBlind:
    def test_a_dark_wall_coasts_briefly_then_stops_counting(self, rig):
        flow, odometry, clock = rig
        flow.see(divergence=0.5, speed_m_s=0.2)
        run_for(odometry, 10.0, clock)

        flow.blind()
        coasting = run_for(odometry, COAST_S * 0.5, clock)
        assert coasting.source == "coasting"
        assert coasting.speed_m_s == pytest.approx(0.2, abs=0.001)

        state = run_for(odometry, 10.0, clock)
        assert state.source == "blind"
        assert state.blind is True
        assert state.speed_m_s == 0.0

    def test_the_coast_cannot_manufacture_a_journey(self, rig):
        flow, odometry, clock = rig
        flow.see(divergence=0.5, speed_m_s=0.2)
        run_for(odometry, 10.0, clock)
        travelled = odometry.status()["distance_travelled_m"]

        flow.blind()
        state = run_for(odometry, 120.0, clock)

        # Two minutes blind adds at most the coast window's worth, not two
        # minutes of the last speed it happened to see.
        assert state.distance_travelled_m <= travelled + 0.2 * COAST_S + 0.05

    def test_uncertainty_grows_faster_while_coasting(self, rig):
        flow, odometry, clock = rig
        flow.see(divergence=0.5, speed_m_s=0.2)
        measured = run_for(odometry, 10.0, clock)
        per_metre_measured = measured.uncertainty_m / measured.distance_travelled_m

        flow.blind()
        before = odometry.status()
        run_for(odometry, COAST_S * 0.5, clock)
        after = odometry.status()

        gained = after["distance_travelled_m"] - before["distance_travelled_m"]
        added = after["uncertainty_m"] - before["uncertainty_m"]
        assert added / gained > per_metre_measured


class TestReverse:
    def test_chainage_falls_and_the_odometer_does_not(self, rig):
        flow, odometry, clock = rig
        flow.see(divergence=0.5, speed_m_s=0.2)
        run_for(odometry, 10.0, clock)

        flow.see(divergence=-0.5, speed_m_s=-0.2)
        state = run_for(odometry, 5.0, clock)

        assert state.chainage_m == pytest.approx(1.0, abs=0.05)
        assert state.distance_travelled_m == pytest.approx(3.0, abs=0.05)


class TestTrack:
    def test_the_track_runs_straight_along_the_pipe(self, rig):
        """No yaw, so no curve. The map anchors this to a street with the north
        reference taken when the run started; nothing here claims a bearing."""
        flow, odometry, clock = rig
        flow.see(divergence=0.5, speed_m_s=0.2)

        state = run_for(odometry, 10.0, clock)
        published = odometry.status()

        assert state.x_m == pytest.approx(2.0, abs=0.05)
        assert published["heading_deg"] == 0.0
        assert published["position"]["y"] == 0.0


class TestReset:
    def test_zeroes_the_run(self, rig):
        flow, odometry, clock = rig
        flow.see(divergence=0.5, speed_m_s=0.2)
        run_for(odometry, 20.0, clock)

        odometry.reset()
        state = odometry.status()

        assert state["distance_travelled_m"] == 0.0
        assert state["chainage_m"] == 0.0
        assert state["uncertainty_m"] == 0.0

    def test_a_reset_does_not_carry_the_last_speed_into_the_new_run(self, rig):
        flow, odometry, clock = rig
        flow.see(divergence=0.5, speed_m_s=0.2)
        run_for(odometry, 10.0, clock)

        odometry.reset()
        flow.blind()
        state = run_for(odometry, 0.5, clock)

        assert state.source == "blind"
        assert state.distance_travelled_m == 0.0
