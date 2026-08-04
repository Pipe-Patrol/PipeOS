"""Host telemetry: the Pi's own vitals.

Separate from the sensor modules because none of this comes off the I2C bus --
it is read straight from the kernel, so it cannot fail the way the IMU does.

Everything here is cached. All of it is polled at telemetry rate and none of it
changes fast enough to justify reopening sysfs ten times a second.
"""

import logging
import shutil
import subprocess
import time
from pathlib import Path

log = logging.getLogger(__name__)

THERMAL_ZONE = Path("/sys/class/thermal/thermal_zone0/temp")
WIRELESS_PROC = Path("/proc/net/wireless")
UPTIME_PROC = Path("/proc/uptime")

# The Pi 5 starts pulling its clocks back around 80 C and hard-throttles at 85.
TEMP_WARN_C = 70.0
TEMP_CRITICAL_C = 80.0

# Where runs are written, and therefore the filesystem whose free space matters.
STORAGE_PATH = Path(__file__).resolve().parents[2] / "data"

TEMP_CACHE_S = 1.0
WIFI_CACHE_S = 2.0
STORAGE_CACHE_S = 30.0  # a run writes slowly; polling this often is pointless


class _Cached:
    """A value refreshed no more often than every `ttl` seconds."""

    def __init__(self, ttl, produce):
        self._ttl = ttl
        self._produce = produce
        self._value = None
        self._read_at = 0.0

    def get(self):
        now = time.monotonic()
        if self._value is not None and now - self._read_at < self._ttl:
            return self._value
        self._read_at = now
        try:
            self._value = self._produce()
        except Exception as exc:  # noqa: BLE001 - host telemetry is never fatal
            log.debug("host telemetry read failed: %s", exc)
            self._value = None
        return self._value


def _read_cpu_temperature():
    # sysfs reports millidegrees.
    return int(THERMAL_ZONE.read_text().strip()) / 1000.0


def _read_wifi():
    """Signal quality from /proc/net/wireless.

    The `link` column is the driver's own 0..70 quality figure. It is reported
    as a percentage because "42 of 70" means nothing to an operator, and the
    dBm column it sits next to is only meaningful to someone holding an antenna.
    """
    text = WIRELESS_PROC.read_text()
    for line in text.splitlines()[2:]:  # two header rows
        fields = line.split()
        if len(fields) < 4:
            continue
        interface = fields[0].rstrip(":")
        # Values carry a trailing '.' in this file, e.g. "58.".
        link = float(fields[2].rstrip("."))
        signal_dbm = float(fields[3].rstrip("."))
        return {
            "interface": interface,
            "quality_pct": round(min(100.0, max(0.0, link / 70.0 * 100.0))),
            "signal_dbm": round(signal_dbm),
        }
    return None


def _read_storage():
    target = STORAGE_PATH if STORAGE_PATH.exists() else Path.home()
    usage = shutil.disk_usage(target)
    return {
        "total_bytes": usage.total,
        "free_bytes": usage.free,
        "used_pct": round(usage.used / usage.total * 100) if usage.total else None,
    }


def _read_uptime():
    return float(UPTIME_PROC.read_text().split()[0])


def _read_hostname():
    try:
        return subprocess.run(
            ["hostname"], capture_output=True, text=True, timeout=1.0
        ).stdout.strip() or None
    except Exception:  # noqa: BLE001 - a nameless host is not an error
        return None


_temperature = _Cached(TEMP_CACHE_S, _read_cpu_temperature)
_wifi = _Cached(WIFI_CACHE_S, _read_wifi)
_storage = _Cached(STORAGE_CACHE_S, _read_storage)
_hostname = _Cached(3600.0, _read_hostname)


def hostname():
    return _hostname.get()


def battery():
    """Battery telemetry, which does not exist yet.

    TODO(hardware): there is no voltage sensor wired to the 3S pack. Until one
    is, this reports nothing rather than guessing -- a fabricated percentage on
    the console is worse than an honest blank, because it would be trusted.

    docs/HARDWARE.md has the part number, where it goes, and the two gotchas
    (sample voltage only while stopped; the current channel is the valuable half).
    """
    return {
        "available": False,
        "volts": None,
        "percent": None,
        "note": "no voltage sensor wired",
    }


def motor_current():
    """Motor current, which does not exist yet. Same sensor as battery()."""
    return {
        "available": False,
        "amps": None,
        "note": "no current sensor wired",
    }


def status():
    temp = _temperature.get()
    if temp is None:
        state = "unknown"
    elif temp >= TEMP_CRITICAL_C:
        state = "critical"
    elif temp >= TEMP_WARN_C:
        state = "warm"
    else:
        state = "ok"

    uptime = _read_uptime_safe()
    return {
        "cpu_temp_c": round(temp, 1) if temp is not None else None,
        "temp_state": state,
        "uptime_s": round(uptime) if uptime is not None else None,
        "wifi": _wifi.get(),
        "storage": _storage.get(),
    }


def _read_uptime_safe():
    try:
        return _read_uptime()
    except Exception:  # noqa: BLE001 - absent on a dev machine
        return None
