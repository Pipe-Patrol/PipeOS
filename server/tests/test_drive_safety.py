"""The tests that have to pass before anyone powers the motors.

No hardware required, on purpose: gpiozero is absent on a laptop, the backend
reports itself unavailable, and every limit in this file is still enforced.
That is the design -- the protections are in the driver, not in the GPIO.
"""

import time

import pytest

from pipepatrol.hardware import drive as drive_module
from pipepatrol.hardware.drive import Drive, clamp_command


@pytest.fixture
def drive():
    """An armed drive, i.e. one with a run open.

    Arming is explicit here because a bare Drive() refuses to move at all -- see
    TestArming. Every limit below is about what happens once movement IS
    allowed, so they would otherwise all pass for the wrong reason.
    """
    device = Drive()
    device.arm(True, reason="test")
    try:
        yield device
    finally:
        device.close()


class TestClamp:
    def test_ceiling_applies_to_full_throttle(self):
        assert clamp_command(1.0) == pytest.approx(drive_module.MAX_DUTY)
        assert clamp_command(-1.0) == pytest.approx(-drive_module.MAX_DUTY)

    def test_beyond_full_throttle_is_clamped_not_rejected(self):
        assert clamp_command(5.0) == pytest.approx(drive_module.MAX_DUTY)
        assert clamp_command(-5.0) == pytest.approx(-drive_module.MAX_DUTY)

    def test_below_the_floor_snaps_to_zero(self):
        # Buzzing without turning IS a stall, so it must never reach the motor.
        floor_input = (drive_module.MIN_DUTY / drive_module.MAX_DUTY) * 0.99
        assert clamp_command(floor_input) == 0.0
        assert clamp_command(-floor_input) == 0.0

    def test_at_the_floor_is_allowed(self):
        floor_input = drive_module.MIN_DUTY / drive_module.MAX_DUTY
        assert clamp_command(floor_input) == pytest.approx(drive_module.MIN_DUTY)

    @pytest.mark.parametrize("value", [None, "fast", float("nan"), object()])
    def test_garbage_becomes_zero(self, value):
        assert clamp_command(value) == 0.0


class TestArming:
    """No run open, no movement. The console enforces this too, but this is the
    copy that still holds when the console or the socket is what broke."""

    def test_a_fresh_drive_will_not_move(self):
        device = Drive()
        try:
            assert device.armed is False
            assert device.command(1.0, 1.0) == (0.0, 0.0)
            status = device.status()
            assert status["moving"] is False
            assert status["last_stop_reason"] == "no run started"
        finally:
            device.close()

    def test_arming_allows_movement(self, drive):
        assert drive.armed is True
        assert drive.command(1.0, 1.0) != (0.0, 0.0)
        assert drive.status()["moving"] is True

    def test_disarming_stops_the_motors_immediately(self, drive):
        drive.command(1.0, 1.0)
        assert drive.status()["moving"] is True

        drive.arm(False, reason="run ended")

        status = drive.status()
        assert status["moving"] is False
        assert status["armed"] is False
        assert "run ended" in status["last_stop_reason"]

    def test_a_held_key_cannot_drive_once_the_run_ends(self, drive):
        """The operator's finger is still on W when the run closes."""
        drive.command(1.0, 1.0)
        drive.arm(False, reason="run ended")

        for _ in range(10):
            assert drive.command(1.0, 1.0) == (0.0, 0.0)
        assert drive.status()["moving"] is False

    def test_stop_still_works_unarmed(self):
        """The one control that must never depend on state."""
        device = Drive()
        try:
            device.stop("panic")
            assert device.status()["last_stop_reason"] == "panic"
        finally:
            device.close()


class TestWatchdog:
    def test_trips_after_the_timeout(self, drive, monkeypatch):
        drive.command(1.0, 1.0)
        assert drive.status()["moving"] is True

        # Rewind the clock rather than sleeping half a second.
        monkeypatch.setattr(
            drive, "_last_command_at",
            time.monotonic() - drive_module.COMMAND_TIMEOUT_S - 0.01,
        )
        drive.tick()

        status = drive.status()
        assert status["moving"] is False
        assert "watchdog" in status["last_stop_reason"]

    def test_does_not_trip_while_commands_arrive(self, drive):
        drive.command(1.0, 1.0)
        drive.tick()
        assert drive.status()["moving"] is True

    def test_tick_is_harmless_when_stopped(self, drive):
        drive.tick()
        assert drive.status()["moving"] is False


class TestRunLimit:
    def test_latches_until_the_operator_lets_go(self, drive, monkeypatch):
        monkeypatch.setattr(drive_module, "MAX_CONTINUOUS_RUN_S", 1.0)
        drive.command(1.0, 1.0)
        monkeypatch.setattr(drive, "_moving_since", time.monotonic() - 1.5)
        drive.tick()

        assert drive.status()["run_limit_tripped"] is True

        # Holding the key down must not re-drive.
        drive.command(1.0, 1.0)
        assert drive.status()["moving"] is False
        assert drive.status()["run_limit_tripped"] is True

        # Releasing clears it.
        drive.command(0.0, 0.0)
        assert drive.status()["run_limit_tripped"] is False
        drive.command(1.0, 1.0)
        assert drive.status()["moving"] is True

    def test_is_off_by_default(self):
        assert drive_module.MAX_CONTINUOUS_RUN_S == 0.0


class TestStop:
    def test_stop_records_its_reason(self, drive):
        drive.command(1.0, 1.0)
        drive.stop("client disconnected")
        status = drive.status()
        assert status["moving"] is False
        assert status["left_duty"] == 0.0
        assert status["right_duty"] == 0.0
        assert status["last_stop_reason"] == "client disconnected"

    def test_close_is_idempotent(self):
        drive = Drive()
        drive.close()
        drive.close()
        assert drive.status()["moving"] is False

    def test_commands_are_ignored_after_close(self):
        drive = Drive()
        drive.close()
        assert drive.command(1.0, 1.0) == (0.0, 0.0)
