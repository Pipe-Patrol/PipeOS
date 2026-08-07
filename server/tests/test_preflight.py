"""The probes that exercise the hardware.

Every test here breaks something real and checks the probe noticed. The point of
the module is that it does not take a subsystem's word for anything, so a test
that only checked it reports what `status()` said would be testing the opposite
of what it is for.
"""

import pytest

from pipepatrol import config, preflight


class FakeCamera:
    """Counts frames like the real one. `stalled` freezes the counter."""

    def __init__(self, available=True, stalled=False, jpeg=b"\xff\xd8jpeg"):
        self.available = available
        self.stalled = stalled
        self.jpeg = jpeg
        self._sequence = 10

    def status(self):
        return {"available": self.available}

    def frame_sequence(self):
        if not self.available:
            return None
        if not self.stalled:
            self._sequence += 1
        return self._sequence

    def latest_jpeg(self):
        return self.jpeg


class FakeLights:
    def __init__(self, available=True, accepts=True):
        self.available = available
        self.accepts = accepts
        self.duty = 0.0
        self.writes = []

    def status(self):
        return {"available": self.available, "duty": self.duty}

    def set_level(self, fraction):
        self.writes.append(fraction)
        if self.accepts:
            self.duty = fraction
        return fraction

    def set_brightness(self, value):
        self.duty = value
        return value


class FakeIMU:
    def __init__(self, state="ok", age=0.1, accel=9.81, yaw=0.0):
        self.state = state
        self.age = age
        self.accel = accel
        self.yaw = yaw

    def status(self):
        return {
            "state": self.state,
            "reading_age_s": self.age,
            "accel_raw_m_s2": self.accel,
            "yaw": self.yaw,
        }


class FakeDrive:
    """Turns `yaw_gain` degrees per self test. Zero means the wheels never move."""

    def __init__(self, hardware=True, imu=None, yaw_gain=12.0, ran=True):
        self.hardware_available = hardware
        self.tested = 0
        self._imu = imu
        self._yaw_gain = yaw_gain
        self._ran = ran

    def self_test(self, seconds=None):
        self.tested += 1
        if not self._ran:
            return False, "no motor hardware"
        if self._imu is not None:
            self._imu.yaw += self._yaw_gain
        return True, ""


class FakeRobot:
    def __init__(self, camera=None, lights=None, imu=None, drive=None, run_id=None):
        self.imu = imu or FakeIMU()
        self.camera = camera or FakeCamera()
        self.lights = lights or FakeLights()
        self.drive = drive or FakeDrive(imu=self.imu)
        self.active_run_id = run_id


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    return tmp_path


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    """The probes sleep to let hardware respond. Tests should not."""
    monkeypatch.setattr(preflight.time, "sleep", lambda _seconds: None)


class TestStorage:
    def test_writes_reads_back_and_passes(self, data_dir):
        result = preflight.storage_probe()

        assert result["ok"] is True
        assert result["confirmed"] is True
        assert result["evidence"]["bytes_written"] == preflight.PROBE_BYTES

    def test_leaves_nothing_behind(self, data_dir):
        preflight.storage_probe()

        assert not (data_dir / preflight.PROBE_FILENAME).exists()

    def test_fails_when_the_card_refuses_the_write(self, monkeypatch):
        # What a read-only or full card looks like from here. Free bytes can
        # still read healthy at this point, which is the whole point of writing.
        def refuse(*args, **kwargs):
            raise OSError(30, "Read-only file system")

        monkeypatch.setattr("builtins.open", refuse)
        result = preflight.storage_probe()

        assert result["ran"] is True
        assert result["ok"] is False
        assert "Read-only" in result["reason"]

    def test_fails_when_what_comes_back_is_not_what_went_in(self, monkeypatch):
        real_open = open

        class Corrupting:
            def __init__(self, path, mode):
                self._handle = real_open(path, mode)
                self._reading = "r" in mode

            def read(self):
                self._handle.read()
                return b"not what was written"

            def __getattr__(self, name):
                return getattr(self._handle, name)

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                self._handle.close()

        monkeypatch.setattr("builtins.open", Corrupting)
        result = preflight.storage_probe()

        assert result["ok"] is False
        assert "did not match" in result["reason"]


class TestCamera:
    def test_passes_when_frames_are_arriving(self):
        result = preflight.camera_probe(FakeRobot())

        assert result["ok"] is True
        assert result["confirmed"] is True
        assert result["evidence"]["frames"] >= 1

    def test_fails_a_camera_that_reports_available_but_has_stopped(self):
        # The failure the passive check cannot see: opened at boot, dead since.
        robot = FakeRobot(camera=FakeCamera(available=True, stalled=True))
        result = preflight.camera_probe(robot)

        assert result["ran"] is True
        assert result["ok"] is False
        assert "no new frame" in result["reason"]

    def test_fails_when_frames_count_but_cannot_be_read(self):
        robot = FakeRobot(camera=FakeCamera(jpeg=b""))
        result = preflight.camera_probe(robot)

        assert result["ok"] is False

    def test_does_not_run_without_a_camera(self):
        robot = FakeRobot(camera=FakeCamera(available=False))
        result = preflight.camera_probe(robot)

        assert result["ran"] is False


class TestLights:
    def test_fails_when_the_channel_will_not_take_the_value(self):
        robot = FakeRobot(lights=FakeLights(accepts=False))
        result = preflight.lights_probe(robot, camera_live=False)

        assert result["ok"] is False
        assert "did not take the value" in result["reason"]

    def test_passes_unconfirmed_when_there_is_no_camera_to_look(self):
        robot = FakeRobot()
        result = preflight.lights_probe(robot, camera_live=False)

        assert result["ok"] is True
        assert result["confirmed"] is False

    def test_confirms_when_the_picture_gets_brighter(self, monkeypatch):
        levels = iter([90.0, 40.0])
        monkeypatch.setattr(preflight, "_mean_luminance", lambda _robot: next(levels))
        result = preflight.lights_probe(FakeRobot(), camera_live=True)

        assert result["ok"] is True
        assert result["confirmed"] is True
        assert result["evidence"]["luminance_delta"] == 50.0

    def test_does_not_fail_a_light_the_camera_could_not_measure(self, monkeypatch):
        # Auto-exposure can cancel the change entirely. Unconfirmed, not failed:
        # the cost of a false failure here is an operator ignoring the list.
        monkeypatch.setattr(preflight, "_mean_luminance", lambda _robot: 50.0)
        result = preflight.lights_probe(FakeRobot(), camera_live=True)

        assert result["ok"] is True
        assert result["confirmed"] is False

    def test_puts_the_brightness_back(self):
        lights = FakeLights()
        lights.duty = 0.4
        preflight.lights_probe(FakeRobot(lights=lights), camera_live=False)

        assert lights.duty == 0.4


class TestIMU:
    def test_passes_on_a_fresh_reading(self):
        result = preflight.imu_probe(FakeRobot())

        assert result["ok"] is True
        assert result["confirmed"] is True

    def test_fails_a_cache_that_has_stopped_updating(self):
        # A wedged I2C bus still returns the last good numbers forever.
        robot = FakeRobot(imu=FakeIMU(age=9.0))
        result = preflight.imu_probe(robot)

        assert result["ok"] is False
        assert "old" in result["reason"]

    def test_fails_when_there_is_no_acceleration_channel(self):
        robot = FakeRobot(imu=FakeIMU(accel=None))
        result = preflight.imu_probe(robot)

        assert result["ok"] is False


class TestMotors:
    def test_passes_when_the_chassis_actually_turns(self):
        imu = FakeIMU()
        robot = FakeRobot(imu=imu, drive=FakeDrive(imu=imu, yaw_gain=14.0))
        result = preflight.motor_probe(robot)

        assert result["ok"] is True
        assert result["confirmed"] is True
        assert result["evidence"]["yaw_change_deg"] == 14.0

    def test_fails_when_the_motors_were_driven_and_nothing_moved(self):
        # A stripped gearbox or an unplugged lead. The PWM pin is perfectly
        # healthy in both cases, which is why commanding it proves nothing.
        imu = FakeIMU()
        robot = FakeRobot(imu=imu, drive=FakeDrive(imu=imu, yaw_gain=0.0))
        result = preflight.motor_probe(robot)

        assert result["ran"] is True
        assert result["ok"] is False
        assert "did not turn" in result["reason"]

    def test_passes_unconfirmed_with_no_imu_to_check_against(self):
        imu = FakeIMU(yaw=None)
        robot = FakeRobot(imu=imu, drive=FakeDrive(imu=None))
        result = preflight.motor_probe(robot)

        assert result["ok"] is True
        assert result["confirmed"] is False

    def test_measures_the_short_way_around_the_compass(self):
        imu = FakeIMU(yaw=355.0)
        robot = FakeRobot(imu=imu, drive=FakeDrive(imu=imu, yaw_gain=10.0))
        result = preflight.motor_probe(robot)

        # 355 -> 365 is 10 degrees of turn, not 355 the other way.
        assert result["evidence"]["yaw_change_deg"] == 10.0

    def test_refuses_to_move_a_robot_that_is_already_on_a_run(self):
        drive = FakeDrive()
        robot = FakeRobot(drive=drive, run_id="abc123")
        result = preflight.motor_probe(robot)

        assert result["ran"] is False
        assert drive.tested == 0

    def test_does_not_run_without_motor_hardware(self):
        robot = FakeRobot(drive=FakeDrive(hardware=False))
        result = preflight.motor_probe(robot)

        assert result["ran"] is False


class TestRun:
    def test_never_moves_the_motors_unless_asked(self):
        drive = FakeDrive()
        robot = FakeRobot(drive=drive)

        preflight.run(robot)

        assert drive.tested == 0

    def test_covers_every_probe(self):
        probes = preflight.run(FakeRobot())["probes"]

        assert set(probes) == {"storage", "camera", "imu", "lights"}

    def test_includes_the_motors_when_asked(self):
        imu = FakeIMU()
        robot = FakeRobot(imu=imu, drive=FakeDrive(imu=imu))
        probes = preflight.run(robot, include_motors=True)["probes"]

        assert probes["motors"]["ok"] is True
