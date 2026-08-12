"""GPIO that was not ready at boot has to be picked up later, without a restart.

The failure these cover is the one that made the robot feel like a prototype:
the service starts before lgpio's chip node exists, claiming a pin raises, and
the motors and the LED ring stay dead for the life of the process. Redeploying
appeared to fix it because redeploying restarts the service.

No hardware here. gpiozero is absent on a laptop, which is exactly the failed
state under test; a stub module standing in for it is the recovery.
"""

import sys
import time

import pytest

from pipepatrol.hardware import drive as drive_module
from pipepatrol.hardware import lights as lights_module
from pipepatrol.hardware.drive import Drive
from pipepatrol.hardware.lights import Lights


class FakePin:
    """The slice of a gpiozero device these two modules actually touch."""

    def __init__(self, pin, frequency=None, initial_value=0.0):
        self.pin = pin
        self.frequency = frequency
        self.value = initial_value
        self.closed = False

    def close(self):
        self.closed = True


@pytest.fixture
def gpiozero_arrives(monkeypatch):
    """Call this to make `from gpiozero import ...` start succeeding.

    Deliberately not installed up front. Every test here begins in the failed
    state -- gpiozero missing, which is what a laptop really has and what the
    Pi looks like before the chip node appears -- and calling this is the
    moment the hardware shows up.
    """

    def arrive():
        module = type(sys)("gpiozero")
        module.PWMOutputDevice = FakePin
        module.DigitalOutputDevice = FakePin
        monkeypatch.setitem(sys.modules, "gpiozero", module)
        return module

    return arrive


class TestDriveRecovery:
    def test_a_failed_claim_is_not_permanent(self, gpiozero_arrives):
        """The whole point: no restart needed once the GPIO shows up."""
        drive = Drive()
        assert not drive.hardware_available, "gpiozero should be absent to start"

        try:
            # The pins arrive. Nothing else changes, and nobody restarts anything.
            gpiozero_arrives()
            drive._backend._last_attempt_at -= drive_module.GPIO_RETRY_BACKOFF_S
            drive.tick()

            assert drive.hardware_available
            assert drive.status()["hardware_error"] is None
        finally:
            drive.close()

    def test_retries_wait_for_the_backoff(self):
        """Retrying at tick rate would mean 20 failed claims a second."""
        drive = Drive()
        try:
            attempts = drive._backend._attempts
            for _ in range(50):
                drive.tick()
            assert drive._backend._attempts == attempts, "tick() retried too eagerly"

            drive._backend._last_attempt_at -= drive_module.GPIO_RETRY_BACKOFF_S
            drive.tick()
            assert drive._backend._attempts == attempts + 1
        finally:
            drive.close()

    def test_the_reason_is_reported_while_it_is_down(self):
        """The console shows this instead of the operator reading the journal."""
        drive = Drive()
        try:
            status = drive.status()
            assert status["hardware"] is False
            assert "gpiozero" in status["hardware_error"]
        finally:
            drive.close()

    def test_recovery_drives_the_pins_to_a_known_state(self, gpiozero_arrives):
        """Never inherit whatever the last process left on the direction pins."""
        drive = Drive()
        try:
            gpiozero_arrives()
            drive._backend._last_attempt_at -= drive_module.GPIO_RETRY_BACKOFF_S
            drive.tick()

            assert drive._backend.pwm_left.value == 0.0
            assert drive._backend.pwm_right.value == 0.0
        finally:
            drive.close()

    def test_a_closed_drive_stays_closed(self, gpiozero_arrives):
        """close() is teardown. It must not be undone by the retry."""
        drive = Drive()
        drive.close()

        gpiozero_arrives()
        drive.tick()
        assert not drive.hardware_available

    def test_recovery_does_not_move_the_motors(self, gpiozero_arrives):
        """A robot that has been sitting dead must not lurch when the pins arrive."""
        drive = Drive()
        drive.arm(True, reason="test")
        try:
            drive.command(1.0, 1.0)  # refused: no hardware to write to
            gpiozero_arrives()
            drive._backend._last_attempt_at -= drive_module.GPIO_RETRY_BACKOFF_S
            drive.tick()

            assert drive.hardware_available
            assert drive._backend.pwm_left.value == 0.0
            assert drive._backend.pwm_right.value == 0.0
        finally:
            drive.close()


class TestLightsRecovery:
    def test_status_picks_the_ring_up(self, gpiozero_arrives):
        """Telemetry polls status(), so the ring recovers with nothing else running."""
        ring = Lights()
        assert not ring.available

        try:
            gpiozero_arrives()
            ring._last_attempt_at -= lights_module.GPIO_RETRY_BACKOFF_S
            ring.status()
            assert ring.available
        finally:
            ring.close()

    def test_a_recovered_ring_comes_up_at_the_commanded_level(self, gpiozero_arrives):
        """Otherwise the slider says 40 percent and the pipe stays dark."""
        ring = Lights()
        try:
            ring.set_level(0.8)  # accepted and remembered, with nothing to write to
            assert not ring.available

            gpiozero_arrives()
            ring._last_attempt_at -= lights_module.GPIO_RETRY_BACKOFF_S
            ring.status()

            assert ring.available
            assert ring._device.value == pytest.approx(0.8 * lights_module.MAX_BRIGHTNESS)
        finally:
            ring.close()

    def test_retries_wait_for_the_backoff(self):
        ring = Lights()
        try:
            attempts = ring._attempts
            for _ in range(50):
                ring.status()
            assert ring._attempts == attempts

            ring._last_attempt_at -= lights_module.GPIO_RETRY_BACKOFF_S
            ring.status()
            assert ring._attempts == attempts + 1
        finally:
            ring.close()

    def test_a_closed_ring_stays_closed(self, gpiozero_arrives):
        ring = Lights()
        ring.close()

        gpiozero_arrives()
        ring.status()
        assert not ring.available

    def test_the_reason_is_reported_while_it_is_down(self):
        ring = Lights()
        try:
            assert "gpiozero" in ring.status()["error"]
        finally:
            ring.close()


def test_the_backoff_is_long_enough_to_not_thrash():
    """Both retries are on the same clock as the IMU's, deliberately."""
    assert drive_module.GPIO_RETRY_BACKOFF_S >= 1.0
    assert lights_module.GPIO_RETRY_BACKOFF_S >= 1.0
