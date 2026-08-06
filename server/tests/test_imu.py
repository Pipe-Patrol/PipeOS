"""The acceleration deadband.

Everything downstream integrates this number, so where the noise floor sits and
whether it is applied before or after the value becomes readable are not
presentation details -- they decide whether a parked robot logs distance.
"""

import pytest

from pipepatrol.hardware.imu import ACCEL_DEADBAND_M_S2, IMU, _deadband


class TestDeadband:
    @pytest.mark.parametrize(
        "raw",
        [0.0, 0.02, 0.07, ACCEL_DEADBAND_M_S2, -0.05, -ACCEL_DEADBAND_M_S2],
    )
    def test_noise_becomes_exactly_zero(self, raw):
        assert _deadband(raw) == 0.0

    @pytest.mark.parametrize("raw", [0.11, 0.4, 9.81, -0.11, -2.0])
    def test_real_acceleration_passes_through_untouched(self, raw):
        assert _deadband(raw) == raw

    def test_no_reading_stays_no_reading(self):
        """None is not zero. One is 'no sensor', the other is 'not moving'."""
        assert _deadband(None) is None


class TestReportedAcceleration:
    """The deadband is applied where the value is read, not where it is shown,
    so the estimator and the screen can never disagree about what is zero."""

    @pytest.fixture
    def imu(self):
        device = IMU(autostart=False)
        yield device
        device.close()

    def test_the_property_and_the_payload_agree(self, imu):
        imu._accel = 0.06

        assert imu.acceleration == 0.0
        assert imu.status()["accel_m_s2"] == 0.0

    def test_the_raw_value_is_still_available_for_diagnosis(self, imu):
        imu._accel = 0.06

        assert imu.raw_acceleration == 0.06
        assert imu.status()["accel_raw_m_s2"] == 0.06

    def test_a_real_reading_survives(self, imu):
        imu._accel = 0.55

        assert imu.acceleration == 0.55
        assert imu.status()["accel_m_s2"] == 0.55

    def test_stillness_is_the_deadband(self, imu):
        imu._accel = 0.06
        assert imu.seems_still() is True

        imu._accel = 0.55
        assert imu.seems_still() is False

    def test_a_dead_sensor_is_not_called_still(self, imu):
        """Absence of evidence is not evidence of stillness."""
        imu._accel = None

        assert imu.acceleration is None
        assert imu.seems_still() is False


class TestNorth:
    """Turning a relative yaw into a compass bearing.

    Nothing on the robot can measure this — the BNO085 runs on the game
    rotation vector, with no magnetometer — so an operator supplies it, and the
    reference is only as good as the sensor session it was taken in.
    """

    @pytest.fixture
    def imu(self):
        device = IMU(autostart=False)
        device._session = 1
        yield device
        device.close()

    def test_there_is_no_heading_until_north_is_set(self, imu):
        imu._yaw = 30.0

        assert imu.heading_deg is None
        assert imu.status()["north"]["set"] is False

    def test_pointing_the_robot_at_north_makes_that_yaw_zero(self, imu):
        imu._yaw = 30.0
        imu.set_north(0.0)

        assert imu.heading_deg == pytest.approx(0.0)

    def test_turning_afterwards_reads_as_a_bearing(self, imu):
        imu._yaw = 30.0
        imu.set_north(0.0)

        imu._yaw = 120.0
        assert imu.heading_deg == pytest.approx(90.0)

        imu._yaw = -60.0
        assert imu.heading_deg == pytest.approx(270.0)

    def test_the_robot_can_be_pointed_anywhere_known(self, imu):
        """The usual case: it is facing down the road, not at north."""
        imu._yaw = 10.0
        imu.set_north(217.0)

        assert imu.heading_deg == pytest.approx(217.0)

        imu._yaw = 100.0  # turned 90 degrees
        assert imu.heading_deg == pytest.approx(307.0)

    def test_the_heading_stays_inside_a_full_circle(self, imu):
        imu._yaw = 0.0
        imu.set_north(350.0)

        imu._yaw = 20.0
        heading = imu.heading_deg
        assert 0.0 <= heading < 360.0
        assert heading == pytest.approx(10.0)

    def test_a_sensor_restart_makes_the_reference_stale(self, imu):
        """Yaw restarts from a new zero on every reconnect, so the old datum is
        meaningless. It must not quietly keep answering."""
        imu._yaw = 30.0
        imu.set_north(0.0)

        imu._session += 1

        assert imu.heading_deg is None
        status = imu.status()["north"]
        assert status["set"] is False
        assert status["stale"] is True

    def test_setting_it_again_after_a_restart_works(self, imu):
        imu._yaw = 30.0
        imu.set_north(0.0)
        imu._session += 1
        imu._yaw = 90.0

        imu.set_north(0.0)

        assert imu.heading_deg == pytest.approx(0.0)
        assert imu.status()["north"]["stale"] is False

    def test_clearing_puts_the_heading_back_to_nothing(self, imu):
        imu._yaw = 30.0
        imu.set_north(0.0)

        imu.clear_north()

        assert imu.heading_deg is None
        assert imu.status()["north"]["stale"] is False

    def test_it_cannot_be_set_against_a_sensor_that_is_not_reading(self, imu):
        imu._yaw = None

        assert imu.set_north(0.0) is None
        assert imu.heading_deg is None
