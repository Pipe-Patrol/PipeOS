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

log = logging.getLogger(__name__)

PIN_LED = 18
MAX_BRIGHTNESS = 0.5
PWM_FREQUENCY_HZ = 1000


class Lights:
    def __init__(self):
        self._lock = threading.RLock()
        self._closed = False
        self._brightness = 0.0
        self._device = None

        try:
            from gpiozero import PWMOutputDevice

            self._device = PWMOutputDevice(
                PIN_LED, frequency=PWM_FREQUENCY_HZ, initial_value=0.0
            )
        except Exception as exc:  # noqa: BLE001 - missing library or busy pin
            log.error("LED ring unavailable: %s", exc)
            self._device = None

        atexit.register(self.close)

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
            return {
                "duty": round(self._brightness, 3),
                "level": round(self._brightness / MAX_BRIGHTNESS, 3),
                "available": self._device is not None,
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
