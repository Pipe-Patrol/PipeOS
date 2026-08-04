"""The camera's historical failure modes, pinned down.

Each of these shipped once and each was invisible from the console. No test here
needs a camera or picamera2; the dehaze ones need OpenCV and numpy, and skip
without them, because checking a physical model against a synthetic hazy frame
is worth more than asserting which functions got called.
"""

import sys
import types

import pytest

from pipepatrol.hardware import camera as camera_module
from pipepatrol.hardware.camera import (
    _dark_channel as _dark_channel_fn,
    _estimate_airlight as _estimate_airlight_fn,
    dehaze_bgr,
)


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
    assert status["tuning"] == {
        "brightness": 0.0,
        "contrast": 0.0,
        "dehaze": False,
        "sharpness": 0.0,
    }
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


# --- losing the camera mid-run -------------------------------------------
#
# A knocked USB cable used to be terminal: reads failed forever, the backend
# still called itself streaming so nothing retried, and only a service restart
# brought the picture back.


class _FlakyCapture:
    """A capture that dies after N frames, and can be revived on a new node."""

    def __init__(self, alive_for):
        self.remaining = alive_for
        self.released = False

    def read(self):
        if self.remaining <= 0:
            return False, None
        self.remaining -= 1
        return True, object()

    def get(self, _prop):
        return 640

    def set(self, _prop, _value):
        return True

    def release(self):
        self.released = True


class _CaptureCv2(_FakeCv2):
    """_FakeCv2 plus the capture-property constants the USB backend reads."""

    CAP_PROP_FRAME_WIDTH = "w"
    CAP_PROP_FRAME_HEIGHT = "h"
    CAP_PROP_BRIGHTNESS = "brightness"
    CAP_PROP_CONTRAST = "contrast"


def _usb_backend_with(monkeypatch, scans):
    """A USB backend whose _scan returns each queued (capture, index) in turn."""
    backend = camera_module._UsbBackend(camera_module.StreamingOutput())
    backend._cv2 = _CaptureCv2()
    queue = list(scans)
    monkeypatch.setattr(
        camera_module, "_v4l2_control_range", lambda *_: (0, 255, 128)
    )
    backend._scan = lambda: queue.pop(0) if queue else (None, None)
    return backend


def test_a_dead_camera_is_reopened_on_whatever_node_it_returns_on(monkeypatch):
    """The regression: unplug and replug must recover without a restart."""
    revived = _FlakyCapture(alive_for=5)
    backend = _usb_backend_with(monkeypatch, [(revived, 2)])
    backend._capture = _FlakyCapture(alive_for=0)

    assert backend._reconnect() is True
    assert backend._capture is revived
    assert backend._index == 2, "must adopt the new node, not the old one"
    assert backend.detail.endswith("/dev/video2")


def test_reconnect_releases_the_dead_handle(monkeypatch):
    dead = _FlakyCapture(alive_for=0)
    backend = _usb_backend_with(monkeypatch, [(_FlakyCapture(alive_for=5), 0)])
    backend._capture = dead

    backend._reconnect()
    assert dead.released is True, "leaking the old fd would exhaust the device"


def test_reconnect_reports_failure_when_the_camera_is_still_gone(monkeypatch):
    backend = _usb_backend_with(monkeypatch, [])  # scan finds nothing
    backend._capture = _FlakyCapture(alive_for=0)
    assert backend._reconnect() is False


def test_tuning_survives_a_reconnect(monkeypatch):
    """A loose cable must not silently reset the operator's brightness."""
    backend = _usb_backend_with(monkeypatch, [(_FlakyCapture(alive_for=5), 1)])
    backend._capture = _FlakyCapture(alive_for=0)

    tuning = camera_module.Tuning()
    tuning.update(brightness=0.5, contrast=-0.25)
    backend.apply_tuning(tuning)

    backend._reconnect()
    assert backend._tuning is tuning


def test_the_scan_is_fresh_rather_than_the_remembered_index(monkeypatch):
    """Pinning the mechanism: recovery must not reuse the old node number."""
    backend = _usb_backend_with(monkeypatch, [(_FlakyCapture(alive_for=5), 7)])
    backend._capture = _FlakyCapture(alive_for=0)
    backend._index = 0

    backend._reconnect()
    assert backend._index == 7


# --- dehaze ---------------------------------------------------------------
#
# The model is I = J·t + A·(1−t), so the honest test is to synthesise a hazy
# frame from a known clean one and check the filter moves it back.

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")


def _scene(size=240):
    """A clean frame with real structure and genuinely dark pixels.

    Blurred on purpose. Per-pixel noise is not what a camera produces, and the
    dark channel prior is a statement about *patches* — testing it against
    salt-and-pepper would be testing it on input it never sees and tuning the
    constants against a fiction.
    """
    rng = np.random.default_rng(7)
    image = rng.integers(0, 60, (size, size, 3), dtype=np.uint8)
    image[:, size // 2 :] = rng.integers(150, 255, (size, size // 2, 3))
    image[size // 3 : size // 2, :] = 10
    return cv2.GaussianBlur(image, (0, 0), 4)


def _add_haze(clean, transmission, airlight=(200, 200, 200)):
    """Apply the forward model, so the test knows the true answer."""
    j = clean.astype(np.float32)
    a = np.array(airlight, dtype=np.float32)
    hazy = j * transmission + a * (1.0 - transmission)
    return np.clip(hazy, 0, 255).astype(np.uint8)


def _contrast(image):
    return float(image.astype(np.float32).std())


def test_haze_destroys_contrast_and_dehazing_gives_it_back():
    """The whole point, stated as a number."""
    clean = _scene()
    hazy = _add_haze(clean, transmission=0.4)

    assert _contrast(hazy) < _contrast(clean), "the synthetic haze must flatten it"

    recovered = dehaze_bgr(cv2, np, hazy)
    assert _contrast(recovered) > _contrast(hazy) * 1.2


def test_dehazing_moves_the_frame_back_towards_the_original():
    """Not just 'more contrast' — closer to the actual scene."""
    clean = _scene()
    hazy = _add_haze(clean, transmission=0.5)

    before = np.abs(hazy.astype(np.float32) - clean.astype(np.float32)).mean()
    after = np.abs(
        dehaze_bgr(cv2, np, hazy).astype(np.float32) - clean.astype(np.float32)
    ).mean()
    assert after < before, f"error rose: {before:.1f} -> {after:.1f}"


def test_thicker_haze_is_lifted_further():
    """Transmission is estimated, not assumed — heavier haze, bigger correction."""
    clean = _scene()
    light = _add_haze(clean, transmission=0.8)
    heavy = _add_haze(clean, transmission=0.3)

    def lift(hazy):
        return _contrast(dehaze_bgr(cv2, np, hazy)) - _contrast(hazy)

    assert lift(heavy) > lift(light)


def test_a_clear_frame_is_left_close_to_alone():
    """No haze to remove means little to do. CLAHE could not tell the difference."""
    clean = _scene()
    out = dehaze_bgr(cv2, np, clean)
    shift = np.abs(out.astype(np.float32) - clean.astype(np.float32)).mean()
    # Half this scene is near-white, which reads as thick haze to the prior, so
    # it is a harder case than real footage: the same measurement on a frame off
    # the robot moved by about 4 levels. 15 catches a regression without pinning
    # the constants to a fixture.
    assert shift < 15, f"a clear frame was altered by {shift:.1f} levels"


def test_a_clear_frame_does_not_have_its_shadows_crushed():
    """The failure that made this unusable on real footage.

    Uncorrected, the prior reads every bright pixel as haze, so a frame with a
    window or a lamp in it gets corrected against that and the dark end is
    pushed below black. Measured on the robot it took 5% of pixels to 11%.
    """
    clean = _scene()
    before = float((clean == 0).mean())
    after = float((dehaze_bgr(cv2, np, clean) == 0).mean())
    assert after <= before + 0.05, f"clipped to black {before:.1%} -> {after:.1%}"


def test_the_correction_scales_with_how_much_haze_there_is():
    """Haze density is measured, not assumed — that is what protects clear frames."""
    clean = _scene()

    def shift(image):
        out = dehaze_bgr(cv2, np, image)
        return float(np.abs(out.astype(np.float32) - image.astype(np.float32)).mean())

    assert shift(_add_haze(clean, 0.35)) > shift(clean) * 3


def test_a_lamp_in_frame_is_not_taken_as_airlight():
    """Airlight is capped: a light source is not the colour of the haze."""
    scene = _scene()
    scene[:12, :12] = 255  # a small blown-out highlight
    out = dehaze_bgr(cv2, np, scene)
    assert np.isfinite(out.astype(np.float32)).all()
    assert out.mean() > scene.mean() * 0.6, "one highlight must not darken everything"


def test_output_is_a_valid_frame():
    out = dehaze_bgr(cv2, np, _add_haze(_scene(), 0.5))
    assert out.dtype == np.uint8
    assert out.shape == (240, 240, 3)
    assert out.min() >= 0 and out.max() <= 255


def test_transmission_floor_survives_an_all_white_frame():
    """Pure white is t -> 0; without the floor this divides by ~0 and blows up."""
    white = np.full((120, 120, 3), 255, dtype=np.uint8)
    out = dehaze_bgr(cv2, np, white)
    assert np.isfinite(out.astype(np.float32)).all()


def test_dark_channel_is_the_patch_minimum():
    image = np.ones((40, 40, 3), dtype=np.float32)
    image[20, 20] = [0.0, 0.5, 0.5]  # one dark pixel in the blue channel
    dark = _dark_channel_fn(cv2, image, 5)
    assert dark[20, 20] == pytest.approx(0.0)
    assert dark[0, 0] == pytest.approx(1.0), "far from it, nothing is dark"


def test_airlight_comes_from_the_haziest_region():
    """A is read off the haze, not off a bright object in the clear."""
    image = np.zeros((60, 60, 3), dtype=np.float32)
    image[:30] = 0.85  # a hazy band: bright in every channel
    dark = _dark_channel_fn(cv2, image, 5)
    airlight = _estimate_airlight_fn(np, image, dark)
    assert airlight == pytest.approx([0.85, 0.85, 0.85], abs=0.02)


def test_sharpening_only_starts_the_worker_when_asked():
    """Brightness must never drag in a decode; sharpening and dehaze must."""
    tuning = camera_module.Tuning()
    assert tuning.needs_pixels is False
    tuning.update(brightness=1.0, contrast=-1.0)
    assert tuning.needs_pixels is False, "sensor controls must stay free"
    tuning.update(sharpness=0.5)
    assert tuning.needs_pixels is True


def test_sharpness_is_zero_to_one():
    """Negative would be a blur, which nobody asked for and nothing exposes."""
    tuning = camera_module.Tuning()
    tuning.update(sharpness=-3.0)
    assert tuning.sharpness == 0.0
    tuning.update(sharpness=9.0)
    assert tuning.sharpness == 1.0


def test_sharpening_at_zero_returns_the_frame_untouched():
    frame = _scene()
    assert camera_module.sharpen_bgr(cv2, frame, 0.0) is frame


def test_sharpening_lifts_detail():
    """More local contrast, and monotonically with the slider."""
    soft = cv2.GaussianBlur(_scene(), (0, 0), 3)

    def detail(image):
        return float(cv2.Laplacian(image, cv2.CV_32F).var())

    gentle = camera_module.sharpen_bgr(cv2, soft, 0.4)
    strong = camera_module.sharpen_bgr(cv2, soft, 1.0)
    assert detail(gentle) > detail(soft)
    assert detail(strong) > detail(gentle)


def test_sharpening_saturates_rather_than_wrapping():
    """A wrapped highlight is a white speck that reads as a defect."""
    frame = np.full((60, 60, 3), 250, dtype=np.uint8)
    frame[20:40, 20:40] = 5
    out = camera_module.sharpen_bgr(cv2, frame, 1.0)
    assert out.dtype == np.uint8
    assert out.max() <= 255 and out.min() >= 0


def test_orientation_is_not_reachable_through_tuning():
    """The whole point of making it fixed: no request can turn it off."""
    tuning = camera_module.Tuning()
    tuning.update(brightness=0.5)
    assert set(tuning.as_dict()) == {"brightness", "contrast", "dehaze", "sharpness"}
    for absent in ("rotate", "flip_h", "flip_v"):
        assert not hasattr(tuning, absent)
