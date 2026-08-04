"""Air temperature and humidity, from a DHT-family sensor on a GPIO pin.

READ THROUGH THE KERNEL, NOT BY BIT-BANGING. The DHT protocol is a single wire
carrying pulses 26 to 70 microseconds apart, and telling those apart from
userspace on a preemptible kernel is a losing game. The usual Python libraries
do it with a C extension that reads the SoC peripheral base directly, which does
not exist on a Pi 5 -- its GPIO lives behind the RP1 southbridge, and
`adafruit_dht` fails there with "Cannot determine SOC peripheral base address".

Linux already ships a driver that does the timing in kernel space. Enable it and
the readings appear as ordinary files:

    dtoverlay=dht11,gpiopin=4        # in /boot/firmware/config.txt

    /sys/bus/iio/devices/iio:deviceN/in_temp_input           millidegrees C
    /sys/bus/iio/devices/iio:deviceN/in_humidityrelative_input   milli-percent

The overlay is named for the DHT11 but drives the DHT21 and DHT22/AM2302 too.

POLLED ON A THREAD, because reading is not free: each read holds a kernel
timer open for the length of the exchange, and the sensor itself will not answer
more than about once every two seconds. Telemetry goes out ten times a second
and must never block on a sensor, so the loop keeps the last good reading and
the envelope serves that.

A missing or silent sensor is a supported state, like every other subsystem
here. It reports unavailable and the console draws a blank rather than a number.
"""

import logging
import threading
import time
from pathlib import Path

log = logging.getLogger(__name__)

IIO_ROOT = Path("/sys/bus/iio/devices")
DEVICE_NAME_PREFIX = "dht11"  # what the overlay calls itself, whichever part is fitted
TEMPERATURE_FILE = "in_temp_input"
HUMIDITY_FILE = "in_humidityrelative_input"

# The sensor will not answer faster than this; asking anyway just returns
# timeouts and holds the line for nothing.
POLL_INTERVAL_S = 3.0
# Both channels are reported in thousandths by the IIO convention.
MILLI = 1000.0
# A DHT times out often even when healthy -- a run of failures is normal, a long
# one is not. Past this the last reading stops being worth showing.
STALE_AFTER_S = 30.0
# Only complain once per this many consecutive failures, or a disconnected
# sensor fills the journal.
LOG_EVERY_FAILURES = 20


def _find_device():
    """The IIO directory for the sensor, or None if the overlay is not loaded."""
    try:
        candidates = sorted(IIO_ROOT.glob("iio:device*"))
    except OSError:
        return None
    for directory in candidates:
        try:
            name = (directory / "name").read_text().strip()
        except OSError:
            continue
        if name.startswith(DEVICE_NAME_PREFIX):
            return directory
    return None


class Climate:
    """Air temperature and relative humidity. Absent is a supported state."""

    def __init__(self, autostart=True):
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self._device = None
        self._temperature_c = None
        self._humidity_pct = None
        self._read_at = None
        self._error = None
        self._failures = 0

        if autostart:
            self.start()

    def start(self):
        with self._lock:
            if self._thread is not None:
                return True
            self._device = _find_device()
            if self._device is None:
                self._error = (
                    "no dht sensor found -- is dtoverlay=dht11 in config.txt?"
                )
                log.info("climate sensor absent (continuing without it)")
                return False
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._run, name="climate", daemon=True
            )
            self._thread.start()
            log.info("climate sensor found at %s", self._device)
            return True

    @property
    def available(self):
        """True only when there is a reading recent enough to show."""
        with self._lock:
            return self._fresh()

    def _fresh(self):
        """Holds _lock."""
        if self._read_at is None:
            return False
        return (time.monotonic() - self._read_at) <= STALE_AFTER_S

    def _read_channel(self, filename):
        return int((self._device / filename).read_text().strip())

    def _run(self):
        while not self._stop.is_set():
            try:
                # Temperature first, then humidity: the driver caches one
                # exchange for both channels, so the second read is free as long
                # as it follows immediately.
                temperature = self._read_channel(TEMPERATURE_FILE) / MILLI
                humidity = self._read_channel(HUMIDITY_FILE) / MILLI
            except OSError as exc:
                # ETIMEDOUT is the normal failure: the sensor did not answer.
                with self._lock:
                    self._failures += 1
                    self._error = f"{type(exc).__name__}: {exc}"
                    failures = self._failures
                if failures % LOG_EVERY_FAILURES == 1:
                    log.warning("climate sensor not responding (%s)", exc)
                self._stop.wait(POLL_INTERVAL_S)
                continue
            except ValueError as exc:
                with self._lock:
                    self._error = f"unreadable value: {exc}"
                self._stop.wait(POLL_INTERVAL_S)
                continue

            with self._lock:
                recovered = self._failures > 0
                self._temperature_c = round(temperature, 1)
                self._humidity_pct = round(humidity, 1)
                self._read_at = time.monotonic()
                self._error = None
                self._failures = 0
            if recovered:
                log.info(
                    "climate sensor reading again: %.1f C, %.1f %%",
                    temperature,
                    humidity,
                )
            self._stop.wait(POLL_INTERVAL_S)

    def status(self):
        with self._lock:
            fresh = self._fresh()
            return {
                "available": fresh,
                "temperature_c": self._temperature_c if fresh else None,
                "humidity_pct": self._humidity_pct if fresh else None,
                "age_s": (
                    round(time.monotonic() - self._read_at, 1)
                    if self._read_at is not None
                    else None
                ),
                "error": self._error,
            }

    def close(self):
        self._stop.set()
        thread = self._thread
        self._thread = None
        if thread is not None:
            thread.join(timeout=POLL_INTERVAL_S + 1.0)
