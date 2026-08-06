"""The DHT22 air temperature/humidity sensor.

A DHT times out constantly even when it is healthy, so the interesting cases are
all about what gets shown when a read fails: a stale humidity looks exactly like
a current one, and this is a number that can end up in an inspection report.

Nothing here needs a Pi or a sensor -- the kernel driver publishes plain files,
so a temp directory stands in for it exactly.
"""

import errno
import time

import pytest

from pipepatrol.hardware import climate as climate_module
from pipepatrol.hardware.climate import Climate


@pytest.fixture
def sensor(tmp_path, monkeypatch):
    """A fake IIO device, standing in for the one the dht11 overlay creates."""
    device = tmp_path / "iio:device0"
    device.mkdir()
    (device / "name").write_text("dht11\n")

    def write(temperature_c, humidity_pct):
        (device / climate_module.TEMPERATURE_FILE).write_text(
            f"{int(temperature_c * 1000)}\n"
        )
        (device / climate_module.HUMIDITY_FILE).write_text(
            f"{int(humidity_pct * 1000)}\n"
        )

    def unplug():
        """The sensor stops answering. The driver's files stay put."""
        for name in (climate_module.TEMPERATURE_FILE, climate_module.HUMIDITY_FILE):
            path = device / name
            if path.exists():
                path.unlink()

    monkeypatch.setattr(climate_module, "IIO_ROOT", tmp_path)
    write(21.5, 48.0)
    return type(
        "Fake",
        (),
        {
            "write": staticmethod(write),
            "unplug": staticmethod(unplug),
            "path": device,
        },
    )


@pytest.fixture
def fast(monkeypatch):
    """Poll fast enough that the tests are not mostly sleeping."""
    monkeypatch.setattr(climate_module, "POLL_INTERVAL_S", 0.01)


def _settled(sensor_obj, predicate, timeout=3.0):
    """Wait for the polling thread to reach a state, rather than sleeping blind."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate(sensor_obj.status()):
            return True
        time.sleep(0.02)
    return False


def test_the_overlays_units_are_converted(sensor, fast):
    """IIO reports thousandths. 21500 is 21.5 C, not 21500 degrees."""
    device = Climate()
    try:
        assert _settled(device, lambda s: s["available"])
        status = device.status()
        assert status["temperature_c"] == 21.5
        assert status["humidity_pct"] == 48.0
        assert status["state"] == "ok"
    finally:
        device.close()


def test_a_dht22_reports_below_zero(sensor, fast):
    """The DHT11 the overlay is named for cannot; the DHT22 fitted here can."""
    sensor.write(-12.3, 71.0)
    device = Climate()
    try:
        assert _settled(device, lambda s: s["available"])
        assert device.status()["temperature_c"] == -12.3
    finally:
        device.close()


def test_an_absent_sensor_is_a_supported_state(tmp_path, monkeypatch, fast):
    """No overlay loaded: report it, say what to do about it, never raise."""
    monkeypatch.setattr(climate_module, "IIO_ROOT", tmp_path)
    device = Climate()
    try:
        assert device.start() is False
        status = device.status()
        assert status["state"] == "absent"
        assert status["available"] is False
        assert status["temperature_c"] is None
        assert "dtoverlay" in status["error"]
    finally:
        device.close()


def test_a_found_sensor_is_starting_not_degraded_before_its_first_reading(
    sensor, monkeypatch
):
    """`robot up` is logged within a second of boot and a DHT takes a few
    seconds to answer. Calling that degraded sends people after a fault that is
    not there."""
    monkeypatch.setattr(climate_module, "POLL_INTERVAL_S", 5.0)
    device = Climate()
    try:
        status = device.status()
        assert status["state"] == "starting"
        assert status["available"] is False
    finally:
        device.close()


def test_a_sensor_plugged_in_later_is_picked_up(tmp_path, monkeypatch, fast):
    """Without this, enabling the overlay means restarting the service."""
    monkeypatch.setattr(climate_module, "IIO_ROOT", tmp_path)
    device = Climate()
    try:
        assert device.status()["state"] == "absent"

        appeared = tmp_path / "iio:device0"
        appeared.mkdir()
        (appeared / "name").write_text("dht11\n")
        (appeared / climate_module.TEMPERATURE_FILE).write_text("18000\n")
        (appeared / climate_module.HUMIDITY_FILE).write_text("62000\n")

        assert _settled(device, lambda s: s["available"])
        assert device.status()["temperature_c"] == 18.0
    finally:
        device.close()


def test_a_timing_out_sensor_keeps_serving_the_last_reading(sensor, fast):
    """One failed read is normal for a DHT and must not blank the display."""
    device = Climate()
    try:
        assert _settled(device, lambda s: s["available"])
        sensor.unplug()
        time.sleep(0.1)
        status = device.status()
        assert status["available"] is True, "a brief timeout must not blank it"
        assert status["temperature_c"] == 21.5
    finally:
        device.close()


def test_a_reading_that_goes_stale_is_withdrawn(sensor, fast, monkeypatch):
    """The one that matters: an old humidity must not pass for a current one."""
    monkeypatch.setattr(climate_module, "STALE_AFTER_S", 0.05)
    device = Climate()
    try:
        assert _settled(device, lambda s: s["available"])
        sensor.unplug()
        assert _settled(device, lambda s: not s["available"])
        status = device.status()
        assert status["temperature_c"] is None
        assert status["humidity_pct"] is None
        assert status["state"] == "degraded", "it was found once, so it is not absent"
    finally:
        device.close()


def test_it_recovers_when_the_sensor_answers_again(sensor, fast, monkeypatch):
    monkeypatch.setattr(climate_module, "STALE_AFTER_S", 0.05)
    device = Climate()
    try:
        assert _settled(device, lambda s: s["available"])
        sensor.unplug()
        assert _settled(device, lambda s: not s["available"])
        sensor.write(19.0, 55.5)
        assert _settled(device, lambda s: s["available"])
        assert device.status()["temperature_c"] == 19.0
    finally:
        device.close()


@pytest.mark.parametrize(
    "temperature_c, humidity_pct",
    [
        (999.0, 48.0),  # past the sensor's 80 C ceiling
        (-99.0, 48.0),  # past its -40 C floor
        (21.5, 128.0),  # humidity cannot exceed 100 %
    ],
)
def test_an_impossible_reading_is_refused(sensor, fast, temperature_c, humidity_pct):
    """A frame can pass its checksum and still be nonsense on a marginal line."""
    sensor.write(temperature_c, humidity_pct)
    device = Climate()
    try:
        assert not _settled(device, lambda s: s["available"], timeout=0.3)
        assert "outside the sensor range" in device.status()["error"]
    finally:
        device.close()


def test_garbage_in_the_file_does_not_kill_the_thread(sensor, fast):
    device = Climate()
    try:
        assert _settled(device, lambda s: s["available"])
        (sensor.path / climate_module.TEMPERATURE_FILE).write_text("not a number\n")
        time.sleep(0.1)
        sensor.write(20.0, 50.0)
        assert _settled(device, lambda s: s["temperature_c"] == 20.0)
    finally:
        device.close()


def test_the_device_is_found_by_name_not_by_index(tmp_path, monkeypatch):
    """iio:device0 is whatever probed first; the sensor may not be it."""
    other = tmp_path / "iio:device0"
    other.mkdir()
    (other / "name").write_text("something-else\n")
    ours = tmp_path / "iio:device1"
    ours.mkdir()
    (ours / "name").write_text("dht11\n")

    monkeypatch.setattr(climate_module, "IIO_ROOT", tmp_path)
    assert climate_module._find_device() == ours


def test_the_two_failures_are_told_apart():
    """ETIMEDOUT is nobody answering; EIO is somebody answering badly. An
    operator chasing one of these should not be sent after the other."""
    silent = climate_module._describe(OSError(errno.ETIMEDOUT, "timed out"))
    noisy = climate_module._describe(OSError(errno.EIO, "io error"))
    assert "did not answer" in silent
    assert "checksum" in noisy


def test_close_is_safe_without_a_sensor(tmp_path, monkeypatch):
    monkeypatch.setattr(climate_module, "IIO_ROOT", tmp_path)
    device = Climate()
    device.close()
    device.close()
