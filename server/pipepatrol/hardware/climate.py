"""Air temperature and relative humidity, from the DHT22 on GPIO14 (physical pin 8).

The part fitted is a DFRobot Gravity DHT22 (AM2302 inside, with the pull-up
already on the module, so no resistor is needed on the Pi side).

READ THROUGH THE KERNEL, NOT BY BIT-BANGING. The DHT protocol is a single wire
carrying pulses 26 to 70 microseconds apart, and telling those apart from
userspace on a preemptible kernel is a losing game. Everything that tries is
either broken or unavailable on a Pi 5:

    adafruit_dht     needs the SoC peripheral base, which on a Pi 5 is behind
                     the RP1 southbridge -- "Cannot determine SOC peripheral
                     base address"
    pigpio           does not support the Pi 5 at all
    lgpio alerts     works, but edge events reach userspace late under load and
                     a late edge is a wrong bit, not a failed read

Linux already ships a driver that does the timing in kernel space, in an
interrupt handler, with the checksum verified before anything is published.
Enable it and the readings appear as ordinary files:

    dtoverlay=dht11,gpiopin=14       # in /boot/firmware/config.txt, then reboot

    /sys/bus/iio/devices/iio:deviceN/name                        dht11
    /sys/bus/iio/devices/iio:deviceN/in_temp_input               millidegrees C
    /sys/bus/iio/devices/iio:deviceN/in_humidityrelative_input   milli-percent

The overlay is named for the DHT11 but the driver decodes the DHT22/AM2302
frame too -- it tells the two formats apart by their fractional bytes. There is
no separate dht22 overlay to look for.

`server/deploy/enable-dht.sh` does that edit and checks the result. Until it has
been run and the Pi rebooted there is no IIO device and this reports absent,
which is a supported state like every other missing device here.

POLLED ON A THREAD, because reading is not free: the driver holds interrupts
through the exchange, and the sensor will not answer more than once every two
seconds. Telemetry goes out ten times a second and must never block on a
sensor, so the loop keeps the last good reading and the envelope serves that --
until it goes stale, at which point it is withdrawn rather than shown. A stale
humidity looks exactly like a current one, and this is a number an operator can
be asked to put in a report.
"""

import errno
import logging
import threading
import time
from pathlib import Path

log = logging.getLogger(__name__)

IIO_ROOT = Path("/sys/bus/iio/devices")
# What the driver calls itself. The dht11 overlay drives the DHT22 as well, so
# that is the name to expect even though a DHT22 is what is fitted.
DEVICE_NAMES = ("dht11", "dht22", "am2302")
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
# Enough consecutive failures to call it degraded rather than unlucky. At a 3 s
# poll this is about fifteen seconds of silence.
FAILURES_BEFORE_DEGRADED = 5
# Only complain once per this many consecutive failures, or a disconnected
# sensor fills the journal.
LOG_EVERY_FAILURES = 20

# AM2302 datasheet range. A frame can pass its checksum and still be nonsense if
# the line is marginal, and a number that ends up in a report has to be refused
# rather than rounded.
TEMPERATURE_RANGE_C = (-40.0, 80.0)
HUMIDITY_RANGE_PCT = (0.0, 100.0)


def _find_device():
    """The IIO directory for the sensor, or None if the overlay is not loaded."""
    try:
        candidates = sorted(IIO_ROOT.glob("iio:device*"))
    except OSError:
        return None
    for directory in candidates:
        try:
            name = (directory / "name").read_text().strip().lower()
        except OSError:
            continue
        if any(name.startswith(known) for known in DEVICE_NAMES):
            return directory
    return None


def _describe(exc):
    """Turn the driver's errno into something an operator can act on.

    The two failures mean different things and get confused constantly:
    ETIMEDOUT is nobody answering, EIO is somebody answering badly.
    """
    if exc.errno == errno.ETIMEDOUT:
        return "sensor did not answer -- check power and the GPIO14 wire"
    if exc.errno == errno.EIO:
        return "checksum failed -- the data line is noisy or the wire is long"
    return f"{type(exc).__name__}: {exc}"


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
        """Start polling. Returns whether the sensor was there to begin with.

        The thread starts either way. The overlay only appears at boot, but a
        module can be plugged back in while the robot is running, and having to
        restart the service to pick that up is a worse answer than looking
        again every few seconds.
        """
        with self._lock:
            if self._thread is not None:
                return self._device is not None
            self._device = _find_device()
            found = self._device is not None
            if not found:
                self._error = "no DHT found -- is dtoverlay=dht11 in config.txt?"
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._run, name="climate", daemon=True
            )
            self._thread.start()

        if found:
            log.info("climate sensor found at %s", self._device)
        else:
            log.info(
                "climate sensor absent (no IIO device; continuing without it). "
                "Run server/deploy/enable-dht.sh on the Pi and reboot."
            )
        return found

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

    def _read_channel(self, device, filename):
        return int((device / filename).read_text().strip())

    def _read_once(self, device):
        """One exchange, as two channel reads. Raises OSError or ValueError.

        Temperature first, then humidity: the driver caches one exchange for
        both channels for two seconds, so the second read costs nothing as long
        as it follows immediately.
        """
        temperature = self._read_channel(device, TEMPERATURE_FILE) / MILLI
        humidity = self._read_channel(device, HUMIDITY_FILE) / MILLI
        low, high = TEMPERATURE_RANGE_C
        if not low <= temperature <= high:
            raise ValueError(f"temperature {temperature} C is outside the sensor range")
        low, high = HUMIDITY_RANGE_PCT
        if not low <= humidity <= high:
            raise ValueError(f"humidity {humidity} % is outside the sensor range")
        return temperature, humidity

    def _fail(self, message):
        with self._lock:
            self._failures += 1
            self._error = message
            failures = self._failures
        if failures % LOG_EVERY_FAILURES == 1:
            log.warning("climate sensor not reading (%s)", message)

    def _run(self):
        while not self._stop.is_set():
            device = self._device
            if device is None:
                # Nothing to read yet. Look again, cheaply -- a glob over a
                # directory with a handful of entries in it.
                device = _find_device()
                if device is None:
                    self._stop.wait(POLL_INTERVAL_S)
                    continue
                with self._lock:
                    self._device = device
                log.info("climate sensor appeared at %s", device)

            try:
                temperature, humidity = self._read_once(device)
            except OSError as exc:
                if exc.errno == errno.ENOENT:
                    # The device went away -- overlay unbound, or the sysfs
                    # entry was renumbered. Go back to looking for it.
                    with self._lock:
                        self._device = None
                    self._fail("the IIO device disappeared")
                else:
                    self._fail(_describe(exc))
                self._stop.wait(POLL_INTERVAL_S)
                continue
            except ValueError as exc:
                self._fail(f"unusable reading: {exc}")
                self._stop.wait(POLL_INTERVAL_S)
                continue

            with self._lock:
                recovered = self._failures >= FAILURES_BEFORE_DEGRADED
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
        """Never raises, never blocks on the sensor. Returns cached values."""
        with self._lock:
            fresh = self._fresh()
            failing = self._failures >= FAILURES_BEFORE_DEGRADED
            if self._device is None and self._read_at is None:
                state = "absent"
            elif self._read_at is None and not failing:
                # Found, but the first exchange has not landed yet. Distinct
                # from degraded: the server logs this line within a second of
                # starting and a healthy DHT takes a few to answer.
                state = "starting"
            elif not fresh or failing:
                state = "degraded"
            else:
                state = "ok"

            return {
                "state": state,
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


def main():
    """`python -m pipepatrol.hardware.climate` -- watch the sensor on the Pi.

    The one thing worth having when the console says unavailable and you need
    to know whether that is the sensor, the wiring or the server.
    """
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    device = _find_device()
    if device is None:
        print(f"No DHT IIO device under {IIO_ROOT}.")
        print("The overlay is not loaded. On the Pi:")
        print("    sudo ~/PipeOS/server/deploy/enable-dht.sh && sudo reboot")
        return 1

    print(f"Found {device} (name: {(device / 'name').read_text().strip()})")
    print("Reading every few seconds. Ctrl-C to stop.\n")
    sensor = Climate()
    try:
        while True:
            time.sleep(POLL_INTERVAL_S)
            status = sensor.status()
            if status["available"]:
                print(
                    f"  {status['temperature_c']:5.1f} C   "
                    f"{status['humidity_pct']:5.1f} %   "
                    f"({status['state']})"
                )
            else:
                print(f"  --      --      ({status['state']}: {status['error']})")
    except KeyboardInterrupt:
        return 0
    finally:
        sensor.close()


if __name__ == "__main__":
    raise SystemExit(main())
