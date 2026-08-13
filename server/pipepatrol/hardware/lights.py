"""LED ring control.

MOSFET module gate on GPIO18 (physical pin 12), module GND on physical pin 14.

HARD CAP: never drive above 50 percent duty. The ring is not rated for continuous
full power on this supply and there is no thermal cutout. MAX_BRIGHTNESS is the
one place that limit lives.

The console works in 0..1 of the *usable* range and never sees MAX_BRIGHTNESS --
a slider that stops at half is a slider that looks broken. `status()` reports
both the raw duty and the 0..1 fraction so the UI can show a full-scale control
without anyone having to remember the conversion.
"""

import atexit
import logging
import threading
import time

log = logging.getLogger(__name__)

PIN_LED = 18
MAX_BRIGHTNESS = 0.5
PWM_FREQUENCY_HZ = 1000

# Same reasoning as the drivetrain's retry -- see hardware/drive.py. The gate
# pin can be unclaimable at boot, and without a retry the ring stays dark for
# the life of the process.
GPIO_RETRY_BACKOFF_S = 5.0


class Lights:
    def __init__(self):
        self._lock = threading.RLock()
        self._closed = False
        self._brightness = 0.0
        self._device = None
        self._error = None
        self._attempts = 0
        self._last_attempt_at = None

        self._ensure_device()
        atexit.register(self.close)

    def _ensure_device(self):
        """Claim the gate pin if it is not claimed yet. Holds _lock, or is in __init__.

        Called from the paths the console already exercises -- status() at
        telemetry rate and set_brightness() on operator input -- so a ring that
        was not ready at boot comes back on its own within the backoff.
        """
        if self._device is not None or self._closed:
            return

        now = time.monotonic()
        if self._last_attempt_at is not None and (
            now - self._last_attempt_at < GPIO_RETRY_BACKOFF_S
        ):
            return

        self._attempts += 1
        self._last_attempt_at = now
        try:
            from gpiozero import PWMOutputDevice

            # Opens at whatever brightness is currently commanded, so a ring
            # recovered mid-run comes up matching the console rather than dark.
            self._device = PWMOutputDevice(
                PIN_LED, frequency=PWM_FREQUENCY_HZ, initial_value=self._brightness
            )
        except Exception as exc:  # noqa: BLE001 - missing library or busy pin
            if str(exc) != self._error:
                log.error("LED ring unavailable: %s -- will keep retrying", exc)
            self._error = str(exc)
            self._device = None
            return

        if self._attempts > 1:
            log.info("LED ring claimed after %d attempts", self._attempts)
        self._error = None

    @property
    def available(self):
        return self._device is not None

    def set_level(self, fraction):
        """Set brightness as 0..1 of the usable range. Returns the fraction applied."""
        try:
            fraction = float(fraction)
        except (TypeError, ValueError):
            fraction = 0.0
        if fraction != fraction:  # NaN
            fraction = 0.0
        fraction = max(0.0, min(1.0, fraction))
        self.set_brightness(fraction * MAX_BRIGHTNESS)
        return fraction

    def set_brightness(self, value):
        """Set raw duty. Anything above MAX_BRIGHTNESS is clamped, not rejected."""
        with self._lock:
            if self._closed:
                return 0.0
            self._ensure_device()
            try:
                value = float(value)
            except (TypeError, ValueError):
                value = 0.0
            if value != value:  # NaN
                value = 0.0

            value = max(0.0, min(MAX_BRIGHTNESS, value))
            self._brightness = value
            if self._device is not None:
                try:
                    self._device.value = value
                except Exception as exc:  # noqa: BLE001
                    log.error("LED write failed: %s", exc)
            return value

    def off(self):
        return self.set_brightness(0.0)

    def status(self):
        with self._lock:
            self._ensure_device()
            return {
                "duty": round(self._brightness, 3),
                "level": round(self._brightness / MAX_BRIGHTNESS, 3),
                "available": self._device is not None,
                "error": self._error,
            }

    def close(self):
        with self._lock:
            if self._closed:
                return
            self._closed = True
            if self._device is not None:
                try:
                    self._device.value = 0.0
                    self._device.close()
                except Exception:  # noqa: BLE001 - already tearing down
                    pass
                self._device = None
            log.info("lights closed")
