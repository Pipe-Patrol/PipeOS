"""The temperature/humidity sensor.

A DHT times out constantly even when it is healthy, so the interesting cases are
all about what gets shown when a read fails: a stale humidity looks exactly like
a current one, and this is a number that can end up in an inspection report.
"""

import time

import pytest

from pipepatrol.hardware import climate as climate_module
from pipepatrol.hardware.climate import Climate


@pytest.fixture
def sensor(tmp_path, monkeypatch):
    """A fake IIO device, so nothing here needs a Pi or a sensor."""
    device = tmp_path / "iio:device0"
    device.mkdir()
    (device / "name").write_text("dht11@4\n")

    def write(temperature_c, humidity_pct):
        (device / climate_module.TEMPERATURE_FILE).write_text(
            f"{int(temperature_c * 1000)}\n"
        )
        (device / climate_module.HUMIDITY_FILE).write_text(
            f"{int(humidity_pct * 1000)}\n"
        )

    def unplug():
        for name in (climate_module.TEMPERATURE_FILE, climate_module.HUMIDITY_FILE):
            path = device / name
            if path.exists():
                path.unlink()

    monkeypatch.setattr(climate_module, "IIO_ROOT", tmp_path)
    write(21.5, 48.0)
    return type("Fake", (), {"write": staticmethod(write), "unplug": staticmethod(unplug), "path": device})


def _settled(sensor_obj, predicate, timeout=3.0):
    """Wait for the polling thread to reach a state, rather than sleeping blind."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate(sensor_obj.status()):
            return True
        time.sleep(0.02)
    return False


def test_the_overlays_units_are_converted(sensor, monkeypatch):
    """IIO reports thousandths. 21500 is 21.5 C, not 21500 degrees."""
    monkeypatch.setattr(climate_module, "POLL_INTERVAL_S", 0.01)
    device = Climate()
    try:
        assert _settled(device, lambda s: s["available"])
        status = device.status()
        assert status["temperature_c"] == 21.5
        assert status["humidity_pct"] == 48.0
    finally:
        device.close()


def test_an_absent_sensor_is_a_supported_state(tmp_path, monkeypatch):
    """No overlay loaded: report it and carry on, never raise."""
    monkeypatch.setattr(climate_module, "IIO_ROOT", tmp_path)
    device = Climate()
    try:
        assert device.start() is False
        status = device.status()
        assert status["available"] is False
        assert status["temperature_c"] is None
        assert "dtoverlay" in status["error"]
    finally:
        device.close()


def test_a_timing_out_sensor_keeps_serving_the_last_reading(sensor, monkeypatch):
    """One failed read is normal for a DHT and must not blank the display."""
    monkeypatch.setattr(climate_module, "POLL_INTERVAL_S", 0.01)
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


def test_a_reading_that_goes_stale_is_withdrawn(sensor, monkeypatch):
    """The one that matters: an old humidity must not pass for a current one."""
    monkeypatch.setattr(climate_module, "POLL_INTERVAL_S", 0.01)
    monkeypatch.setattr(climate_module, "STALE_AFTER_S", 0.05)
    device = Climate()
    try:
        assert _settled(device, lambda s: s["available"])
        sensor.unplug()
        assert _settled(device, lambda s: not s["available"])
        status = device.status()
        assert status["temperature_c"] is None
        assert status["humidity_pct"] is None
    finally:
        device.close()


def test_it_recovers_when_the_sensor_answers_again(sensor, monkeypatch):
    monkeypatch.setattr(climate_module, "POLL_INTERVAL_S", 0.01)
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


def test_garbage_in_the_file_does_not_kill_the_thread(sensor, monkeypatch):
    monkeypatch.setattr(climate_module, "POLL_INTERVAL_S", 0.01)
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
    (ours / "name").write_text("dht11@4\n")

    monkeypatch.setattr(climate_module, "IIO_ROOT", tmp_path)
    assert climate_module._find_device() == ours


def test_close_is_safe_without_a_sensor(tmp_path, monkeypatch):
    monkeypatch.setattr(climate_module, "IIO_ROOT", tmp_path)
    device = Climate()
    device.close()
    device.close()
