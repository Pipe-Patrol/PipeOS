"""The camera's two historical failure modes, pinned down.

Both of these shipped once, both were invisible from the console, and both are
cheap to assert. Neither test needs a camera, picamera2 or OpenCV.
"""

import sys
import types

import pytest

from pipepatrol.hardware import camera as camera_module


def _fake_picamera2(camera_info):
    """A stand-in picamera2 module whose global_camera_info we control."""
    module = types.ModuleType("picamera2")

    class Picamera2:
        @staticmethod
        def global_camera_info():
            return camera_info

        def __init__(self):
            raise AssertionError(
                "Picamera2 was constructed; constructing it is what acquires the "
                "device, so the USB camera has just been taken from OpenCV."
            )

    module.Picamera2 = Picamera2
    return module


@pytest.fixture
def picamera2(monkeypatch):
    """Install a fake picamera2 for the duration of a test."""

    def install(camera_info):
        monkeypatch.setitem(sys.modules, "picamera2", _fake_picamera2(camera_info))

    return install


# --- the device-stealing bug ----------------------------------------------
#
# libcamera's uvcvideo pipeline handler makes a USB webcam look like a libcamera
# camera. Opening it here locked OpenCV out of the real /dev/video node and left
# the stream on a node that disappeared on the next replug.

# The Id libcamera actually reported for the Arducam on this robot.
USB_CAMERA = {
    "Id": "/base/axi/pcie@1000120000/rp1/usb@200000-2:1.0-0c45:0261",
    "Model": "Arducam 1080P Low Light",
}
CSI_CAMERA = {
    "Id": "/base/axi/pcie@120000/rp1/i2c@88000/imx708@1a",
    "Model": "imx708",
}


def test_usb_only_camera_is_not_claimed_as_csi(picamera2):
    """A webcam behind libcamera must not be mistaken for a ribbon camera."""
    picamera2([USB_CAMERA])
    assert camera_module._csi_sensor_present() is False


def test_csi_backend_declines_when_only_usb_is_present(picamera2):
    """The backend must refuse *before* constructing Picamera2.

    The fake raises if constructed, so this fails loudly if the check is ever
    moved below the acquire.
    """
    picamera2([USB_CAMERA])
    backend = camera_module._CsiBackend(camera_module.StreamingOutput())
    with pytest.raises(RuntimeError, match="no CSI ribbon camera"):
        backend.start()


def test_real_csi_sensor_is_still_detected(picamera2):
    """The guard must not lock out the ribbon camera it exists to protect."""
    picamera2([CSI_CAMERA])
    assert camera_module._csi_sensor_present() is True


def test_csi_wins_when_both_are_attached(picamera2):
    """A ribbon camera alongside a webcam still goes to picamera2."""
    picamera2([USB_CAMERA, CSI_CAMERA])
    assert camera_module._csi_sensor_present() is True


def test_no_cameras_at_all(picamera2):
    picamera2([])
    assert camera_module._csi_sensor_present() is False


# --- the silent-tuning bug ------------------------------------------------
#
# A 0..1 float was passed to a control whose real range was 0..255, so every
# slider position rounded to 0 and the sensor sat at its floor.


@pytest.mark.parametrize(
    "bounds",
    [
        (0, 255, 128),  # the common UVC brightness range
        (-64, 64, 0),  # and the other common one
        (0, 95, 50),  # a contrast range with an off-centre default
    ],
)
def test_zero_means_the_driver_default(bounds):
    """0 is documented as "untouched", so it must land exactly on the default."""
    assert camera_module._scale_to_range(0.0, bounds) == bounds[2]


@pytest.mark.parametrize("bounds", [(0, 255, 128), (-64, 64, 0), (0, 95, 50)])
def test_extremes_reach_the_real_limits(bounds):
    minimum, maximum, _ = bounds
    assert camera_module._scale_to_range(1.0, bounds) == maximum
    assert camera_module._scale_to_range(-1.0, bounds) == minimum


def test_the_slider_range_does_not_collapse():
    """The regression itself: distinct slider positions must stay distinct.

    The old code mapped -1..1 onto 0.0..1.0 and handed that to a 0..255 control,
    so everything below the very top rounded to 0.
    """
    bounds = (0, 255, 128)
    values = [
        camera_module._scale_to_range(v / 10.0, bounds) for v in range(-10, 11)
    ]
    assert len(set(values)) == len(values), f"positions collapsed onto: {values}"
    assert values == sorted(values)


def test_scaling_stays_inside_the_range():
    bounds = (0, 255, 128)
    for step in range(-10, 11):
        native = camera_module._scale_to_range(step / 10.0, bounds)
        assert bounds[0] <= native <= bounds[1]


def test_tuning_clamps_rather_than_rejecting():
    tuning = camera_module.Tuning()
    tuning.update(brightness=5.0, contrast=-5.0)
    assert tuning.brightness == 1.0
    assert tuning.contrast == -1.0
    tuning.update(brightness="not a number")
    assert tuning.brightness == 0.0


def test_status_reports_tuning():
    """The console's CameraStatus type requires these keys, and only these."""
    camera = camera_module.Camera(autostart=False)
    status = camera.status()
    assert status["tuning"] == {"brightness": 0.0, "contrast": 0.0, "dehaze": False}
    assert status["available"] is False


# --- the mounting rotation ------------------------------------------------
#
# The camera is bolted in upside down. This is a fixed correction rather than an
# operator control, so what needs pinning is that it is always applied and never
# reachable from the API.


class _FakeCv2:
    """Records the calls the frame loop would make to OpenCV."""

    ROTATE_90_CLOCKWISE = "cw"
    ROTATE_180 = "180"
    ROTATE_90_COUNTERCLOCKWISE = "ccw"

    def __init__(self):
        self.calls = []

    def rotate(self, frame, code):
        self.calls.append(("rotate", code))
        return frame


def test_the_camera_is_mounted_upside_down():
    """If someone remounts the camera, this is the line that should fail."""
    assert camera_module.MOUNT_ROTATION == 180


def test_every_frame_is_turned():
    cv2 = _FakeCv2()
    camera_module._apply_mount_rotation(cv2, object())
    assert cv2.calls == [("rotate", "180")]


@pytest.mark.parametrize(
    ("degrees", "code"),
    [(90, "cw"), (180, "180"), (270, "ccw")],
)
def test_each_angle_maps_to_its_opencv_code(monkeypatch, degrees, code):
    """MOUNT_ROTATION is the single knob, so it has to work at every angle."""
    monkeypatch.setattr(camera_module, "MOUNT_ROTATION", degrees)
    cv2 = _FakeCv2()
    camera_module._apply_mount_rotation(cv2, object())
    assert cv2.calls == [("rotate", code)]


def test_an_unmounted_rotation_touches_no_pixels(monkeypatch):
    monkeypatch.setattr(camera_module, "MOUNT_ROTATION", 0)
    cv2 = _FakeCv2()
    camera_module._apply_mount_rotation(cv2, object())
    assert cv2.calls == []


def test_orientation_is_not_reachable_through_tuning():
    """The whole point of making it fixed: no request can turn it off."""
    tuning = camera_module.Tuning()
    tuning.update(brightness=0.5)
    assert set(tuning.as_dict()) == {"brightness", "contrast", "dehaze"}
    for absent in ("rotate", "flip_h", "flip_v"):
        assert not hasattr(tuning, absent)
