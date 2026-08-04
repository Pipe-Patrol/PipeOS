"""MJPEG streaming, from either a USB camera or a CSI ribbon camera.

Two different worlds, so two backends:

  * CSI ribbon camera -> picamera2, which encodes JPEG for us in its own thread
  * USB camera        -> V4L2 via OpenCV, which we read and encode ourselves

CSI is tried first, but only after asking libcamera what it can actually see.
That check is the whole ballgame, so it is worth stating plainly:

    libcamera ships a `uvcvideo` pipeline handler. Picamera2 will therefore
    happily open a USB webcam and report success. When it does, it holds the
    real /dev/video node, OpenCV is locked out of it ("can't open camera by
    index"), and the USB backend falls through onto whatever leftover node it
    can still read -- a metadata node, or one that vanishes on the next replug.
    The stream then dies every few seconds as libcamera re-binds the device.

    That is not hypothetical; it is what the previous version did. The fix is
    not to release the device faster, because that only turns it into a race the
    USB backend usually wins and sometimes loses. The fix is not to open it.

So `_csi_sensor_present` looks before touching. A real CSI sensor sits on the
I2C/CSI bus and its libcamera Id is a platform path; a webcam's Id carries the
USB bus in it. If the only camera libcamera can see is USB, the CSI backend
declines and OpenCV drives the device properly.

Both backends push finished JPEGs into the same StreamingOutput, so readers
block on one condition variable and a slow client falls behind by dropping
frames rather than by backing up a queue.

Like every other subsystem here, an absent camera is a supported state: the
server keeps running and the stream endpoint reports it as unavailable.

TUNING. Brightness and contrast are pushed down to the sensor -- picamera2
controls, or V4L2 controls -- so they cost nothing per frame. Dehaze and
sharpening cannot be: they are pixel operations, so switching either on starts a
worker that decodes, reworks and re-encodes every frame. That is real CPU on a
Pi already running flow and inference, so both are off by default and the cost
is the reason. They share one worker, because the JPEG round trip dwarfs either
operation and paying for it twice would be the actual expense.

MOUNTING. The camera is bolted into the chassis upside down, so every frame is
turned 180 degrees. That is deliberately a constant and not an operator control:
it describes how the hardware is fitted, not how anyone prefers to look at it,
and a picture that is upright only because somebody remembered to set a toggle
is a picture that will be upside down in somebody's recording. If the camera is
ever remounted, change MOUNT_ROTATION and nothing else.

It is applied at the source, so the live stream, snapshots, the recording,
optical flow and the detector all see the same upright picture. A CSS transform
in the console would have been free, but it would have turned only what the
operator sees and left the recorded video on its head.

The cost is near zero on the USB path: that loop already has a decoded frame in
hand and already re-encodes it, so this is a rotate added to work that was
happening anyway, not a second decode.
"""

import array
import fcntl
import io
import logging
import struct
import threading
import time

log = logging.getLogger(__name__)

RESOLUTION = (640, 480)
JPEG_QUALITY = 75
FRAME_WAIT_TIMEOUT_S = 5.0
USB_MAX_DEVICE_INDEX = 9  # scan /dev/video0 .. /dev/video9
BOUNDARY = "frame"

# A USB camera that stops delivering is usually gone rather than slow: a knocked
# cable, a brown-out on the bus. Reads then fail forever and nothing upstream
# notices, because the backend is still "streaming" -- it just never produces a
# frame again. So the capture thread gives it about two seconds and then goes and
# opens the device again itself.
RECONNECT_AFTER_FAILURES = 20  # x the 0.1 s read-failure sleep
RECONNECT_INTERVAL_S = 2.0

# --- dehaze ---------------------------------------------------------------
#
# The physical model, rather than a contrast trick. Light reaching the camera
# through a scattering medium is
#
#     I(x) = J(x)·t(x) + A·(1 − t(x))
#
# where I is what the sensor sees, J the scene we want, A the airlight (here:
# the robot's own LED backscattered off suspended muck), and t the transmission,
# falling off with distance. Inverting it gives J = (I − A)/t + A, so the whole
# problem is estimating A and t.
#
# t comes from the dark channel prior (He, Sun & Tang, CVPR 2009): in any
# haze-free outdoor patch some colour channel is nearly black, so however bright
# the darkest channel of a patch is, that brightness is the haze. It holds well
# in a pipe -- wet brick and joints are full of genuinely dark pixels, and where
# it fails is exactly where there is nothing to see anyway.
#
# This replaces CLAHE, which equalised the histogram and called it dehazing. It
# lifted contrast everywhere including where the haze was thickest, so it
# amplified backscatter as readily as pipe wall and made distance disappear.
DEHAZE_OMEGA = 0.95  # leave 5% of haze; removing all of it looks synthetic
DEHAZE_PATCH = 15  # dark-channel window in pixels, at full resolution
DEHAZE_T_FLOOR = 0.1  # never divide by less than this or noise explodes
# Transmission is smooth, so it is estimated small and scaled back up. This is
# the difference between a filter that keeps up with the camera and one that
# does not.
DEHAZE_ESTIMATE_SCALE = 0.25
DEHAZE_GUIDE_RADIUS = 20  # guided-filter window, on the small image
DEHAZE_GUIDE_EPS = 1e-3
DEHAZE_AIRLIGHT_FRACTION = 0.001  # top 0.1% of the dark channel is the airlight
# A lamp is not airlight. Uncapped, a light source in frame is taken as the haze
# colour and the whole picture is corrected against it.
DEHAZE_MAX_AIRLIGHT = 0.95
# How much haze counts as "fully hazy". The mean of the dark channel is the
# prior's own estimate of haze thickness, and correcting in proportion to it is
# what keeps this from mangling a clear frame: measured on this robot, a clear
# lab frame reads about 0.19 and a properly hazy one about 0.51. Without the
# scaling the model assumes every bright pixel is haze and crushes the shadows.
DEHAZE_FULL_HAZE_DENSITY = 0.5

# --- sharpening -----------------------------------------------------------
#
# Unsharp mask: subtract a blurred copy to get the detail, then add it back
# amplified. sharp = image + amount·(image − blur(image)).
#
# A blur is a low-pass filter, so image − blur is precisely the high-frequency
# part, and this is a high-boost filter written in the cheapest possible terms.
# It is the right tool here because it does not invent edges: it only re-weights
# detail the lens already resolved, which matters when an operator is deciding
# whether a hairline mark is a crack.
SHARPEN_SIGMA = 1.4  # px; roughly the scale of detail worth lifting at 640x480
SHARPEN_MAX_AMOUNT = 1.5  # what a slider at 1.0 means; beyond this it haloes

# --- V4L2 control queries -------------------------------------------------
#
# OpenCV can set a control but cannot tell you what range it expects, and the
# answer differs per camera (0..255 on one webcam, -64..64 on the next). Guessing
# is what broke tuning before: a 0..1 float went straight through, so the whole
# -1..1 slider collapsed onto integer 0 and pinned the sensor at its floor. So
# ask the driver directly. This is stdlib ioctl -- no extra dependency.
V4L2_CID_BRIGHTNESS = 0x00980900
V4L2_CID_CONTRAST = 0x00980901
# _IOWR('V', 36, struct v4l2_queryctrl), where the struct is 68 bytes.
VIDIOC_QUERYCTRL = 0xC0445624
_QUERYCTRL_STRUCT = "II32siiiiI2I"
_V4L2_CTRL_FLAG_DISABLED = 0x0001


def _v4l2_control_range(device_index, control_id):
    """(minimum, maximum, default) for a V4L2 control, or None if unavailable."""
    try:
        buf = array.array(
            "B",
            struct.pack(_QUERYCTRL_STRUCT, control_id, 0, b"", 0, 0, 0, 0, 0, 0, 0),
        )
        with open(f"/dev/video{device_index}", "rb", buffering=0) as node:
            fcntl.ioctl(node, VIDIOC_QUERYCTRL, buf, True)
        _, _, _, minimum, maximum, _, default, flags, _, _ = struct.unpack(
            _QUERYCTRL_STRUCT, buf.tobytes()
        )
    except Exception as exc:  # noqa: BLE001 - an unsupported control is not fatal
        log.debug("V4L2 control 0x%x not queryable: %s", control_id, exc)
        return None
    if maximum <= minimum or flags & _V4L2_CTRL_FLAG_DISABLED:
        return None
    return minimum, maximum, default


def _scale_to_range(value, bounds):
    """Map -1..1 onto a V4L2 control range, with 0 landing on the driver default.

    Centring on the default rather than the midpoint is what makes 0 mean
    "untouched" -- most webcams do not default to the middle of their range.
    """
    minimum, maximum, default = bounds
    if value >= 0:
        return int(round(default + value * (maximum - default)))
    return int(round(default + value * (default - minimum)))


class StreamingOutput(io.BufferedIOBase):
    """Holds exactly one frame: the most recent one."""

    def __init__(self):
        self.frame = None
        self.sequence = 0
        self.condition = threading.Condition()

    def write(self, buf):
        with self.condition:
            self.frame = buf
            self.sequence += 1
            self.condition.notify_all()
        return len(buf)

    def wait_for_frame(self, timeout=FRAME_WAIT_TIMEOUT_S, since=None):
        """Block for the next frame. `since` waits for something newer than a sequence."""
        with self.condition:
            if since is not None and self.sequence > since:
                return self.frame, self.sequence
            if not self.condition.wait(timeout=timeout):
                return None, self.sequence
            return self.frame, self.sequence

    def latest(self):
        with self.condition:
            return self.frame, self.sequence


# How the camera is fitted, in degrees clockwise. Not a preference -- see the
# MOUNTING note in the module docstring. This is the only place to change it.
MOUNT_ROTATION = 180


class Tuning:
    """Image adjustments the operator can reach. Clamped, never rejected."""

    def __init__(self):
        self.brightness = 0.0  # -1..1, 0 = untouched
        self.contrast = 0.0  # -1..1, 0 = untouched
        self.dehaze = False
        self.sharpness = 0.0  # 0..1, 0 = off

    def update(self, brightness=None, contrast=None, dehaze=None, sharpness=None):
        if brightness is not None:
            self.brightness = _clamp_unit(brightness)
        if contrast is not None:
            self.contrast = _clamp_unit(contrast)
        if dehaze is not None:
            self.dehaze = bool(dehaze)
        if sharpness is not None:
            self.sharpness = max(0.0, _clamp_unit(sharpness))
        return self

    @property
    def needs_pixels(self):
        """True when a frame has to be decoded and reworked to satisfy this.

        Brightness and contrast never appear here: they go to the sensor and
        cost nothing. These two are what start the worker.
        """
        return self.dehaze or self.sharpness > 0

    def as_dict(self):
        return {
            "brightness": round(self.brightness, 3),
            "contrast": round(self.contrast, 3),
            "dehaze": self.dehaze,
            "sharpness": round(self.sharpness, 3),
        }


# Kept as a lookup rather than a hardcoded call so MOUNT_ROTATION stays the one
# thing to edit if the camera is ever refitted at some other angle.
_ROTATION_CODES = {
    90: "ROTATE_90_CLOCKWISE",
    180: "ROTATE_180",
    270: "ROTATE_90_COUNTERCLOCKWISE",
}


def _apply_mount_rotation(cv2, frame):
    """Turn a decoded frame to match how the camera is bolted in."""
    code = _ROTATION_CODES.get(MOUNT_ROTATION)
    if code is None:
        return frame
    return cv2.rotate(frame, getattr(cv2, code))


def _dark_channel(cv2, image, patch):
    """min over colour, then min over a patch. Erosion *is* a min filter."""
    darkest_channel = image.min(axis=2)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (patch, patch))
    return cv2.erode(darkest_channel, kernel)


def _estimate_airlight(np, image, dark):
    """The airlight A, read off the haziest pixels in the picture.

    Haziest means brightest in the dark channel. Among those, the brightest
    pixel in the image itself is taken rather than the per-channel maximum,
    which would invent a colour that appears nowhere in the frame.
    """
    flat = dark.ravel()
    count = max(1, int(flat.size * DEHAZE_AIRLIGHT_FRACTION))
    haziest = np.argpartition(flat, -count)[-count:]
    candidates = image.reshape(-1, 3)[haziest]
    return candidates[candidates.sum(axis=1).argmax()]


def _guided_filter(cv2, np, guide, target, radius, eps):
    """Edge-preserving smoothing of `target` under `guide` (He et al., 2010).

    The raw transmission map is blocky, because it is built from patch minima.
    Smoothing it naively would bleed haze across the edges of anything in the
    frame and leave halos around every joint; a guided filter follows the
    picture's own edges instead.
    """
    window = (radius, radius)
    mean_guide = cv2.blur(guide, window)
    mean_target = cv2.blur(target, window)
    mean_product = cv2.blur(guide * target, window)
    mean_square = cv2.blur(guide * guide, window)

    covariance = mean_product - mean_guide * mean_target
    variance = mean_square - mean_guide * mean_guide

    a = covariance / (variance + eps)
    b = mean_target - a * mean_guide
    return cv2.blur(a, window) * guide + cv2.blur(b, window)


def dehaze_bgr(cv2, np, frame):
    """Invert the scattering model on one BGR frame. Returns a new uint8 frame."""
    height, width = frame.shape[:2]
    small = cv2.resize(
        frame, None,
        fx=DEHAZE_ESTIMATE_SCALE, fy=DEHAZE_ESTIMATE_SCALE,
        interpolation=cv2.INTER_AREA,
    )
    normalised = small.astype(np.float32) / 255.0
    patch = max(3, int(DEHAZE_PATCH * DEHAZE_ESTIMATE_SCALE) | 1)

    dark = _dark_channel(cv2, normalised, patch)
    airlight = _estimate_airlight(np, normalised, dark)
    # Floor: a near-black airlight means there is no haze to model, and dividing
    # by it would manufacture one. Ceiling: see DEHAZE_MAX_AIRLIGHT.
    airlight = np.clip(airlight, 1e-3, DEHAZE_MAX_AIRLIGHT)

    # Correct in proportion to how much haze the prior actually finds, so a
    # clear frame is left nearly alone instead of having its shadows crushed.
    density = float(dark.mean())
    omega = DEHAZE_OMEGA * min(1.0, density / DEHAZE_FULL_HAZE_DENSITY)

    # The prior, on the image normalised by the airlight.
    transmission = 1.0 - omega * _dark_channel(cv2, normalised / airlight, patch)
    guide = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    transmission = _guided_filter(
        cv2, np, guide, transmission, DEHAZE_GUIDE_RADIUS, DEHAZE_GUIDE_EPS
    )

    transmission = cv2.resize(
        transmission, (width, height), interpolation=cv2.INTER_LINEAR
    )
    transmission = np.clip(transmission, DEHAZE_T_FLOOR, 1.0)[:, :, None]

    scene = (frame.astype(np.float32) / 255.0 - airlight) / transmission + airlight
    return np.clip(scene * 255.0, 0, 255).astype(np.uint8)


def sharpen_bgr(cv2, frame, amount):
    """Unsharp mask. `amount` is 0..1 from the slider; 0 returns the frame."""
    if amount <= 0:
        return frame
    gain = amount * SHARPEN_MAX_AMOUNT
    blurred = cv2.GaussianBlur(frame, (0, 0), SHARPEN_SIGMA)
    # addWeighted rather than raw arithmetic: it saturates at 0 and 255 instead
    # of wrapping, and a wrapped highlight is a white speck that looks like a
    # defect.
    return cv2.addWeighted(frame, 1.0 + gain, blurred, -gain, 0)


def _clamp_unit(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 0.0
    if value != value:  # NaN
        return 0.0
    return max(-1.0, min(1.0, value))


def _csi_sensor_present():
    """True only when libcamera can see a genuine CSI sensor.

    A USB webcam reached through libcamera's uvcvideo pipeline handler has the
    USB bus in its Id; a ribbon sensor on the CSI bus does not. Returning False
    here is what keeps picamera2 from taking the USB camera away from OpenCV --
    see the module docstring.
    """
    from picamera2 import Picamera2

    cameras = Picamera2.global_camera_info()
    for info in cameras:
        identifier = str(info.get("Id", "")).lower()
        if "usb" not in identifier:
            log.info("CSI sensor detected: %s", info.get("Id"))
            return True
    if cameras:
        log.info(
            "libcamera sees only USB cameras (%s); leaving them to OpenCV",
            ", ".join(str(c.get("Id")) for c in cameras),
        )
    return False


class _CsiBackend:
    """Raspberry Pi ribbon camera through picamera2."""

    name = "csi"

    def __init__(self, output):
        self._output = output
        self._picam = None
        self.detail = None

    def _video_config(self, picam):
        """Stream config, with the mounting rotation folded into the ISP transform.

        Free here, unlike on the USB path: the ISP mirrors on the way out, so
        nothing has to be decoded. 180 degrees is both mirrors at once, which is
        the one rotation the ISP can express -- it cannot stand a frame on its
        side. If MOUNT_ROTATION ever becomes 90 or 270 this backend needs a real
        pixel rotation, so it says so rather than quietly streaming sideways.
        """
        main = {"size": RESOLUTION}
        if MOUNT_ROTATION not in (0, 180):
            log.warning(
                "MOUNT_ROTATION of %d deg cannot be applied on the CSI path",
                MOUNT_ROTATION,
            )
            return picam.create_video_configuration(main=main)

        mirrored = MOUNT_ROTATION == 180
        try:
            from libcamera import Transform
        except ImportError:  # pragma: no cover - only on a Pi without libcamera
            if mirrored:
                log.warning("libcamera has no Transform here; frame not rotated")
            return picam.create_video_configuration(main=main)
        return picam.create_video_configuration(
            main=main, transform=Transform(hflip=mirrored, vflip=mirrored)
        )

    def start(self):
        # Check before constructing Picamera2: constructing it is what acquires
        # the device, and acquiring a USB camera here is the bug this avoids.
        if not _csi_sensor_present():
            raise RuntimeError("no CSI ribbon camera present")

        from picamera2 import Picamera2
        from picamera2.encoders import JpegEncoder
        from picamera2.outputs import FileOutput

        picam = Picamera2()
        picam.configure(self._video_config(picam))
        picam.start_recording(JpegEncoder(q=JPEG_QUALITY), FileOutput(self._output))
        self._picam = picam
        self.detail = f"{RESOLUTION[0]}x{RESOLUTION[1]}"
        return self.detail

    def apply_tuning(self, tuning):
        """picamera2 takes brightness as -1..1 and contrast as a 0..n multiplier."""
        if self._picam is None:
            return
        try:
            self._picam.set_controls(
                {
                    "Brightness": tuning.brightness,
                    "Contrast": 1.0 + tuning.contrast,
                }
            )
        except Exception as exc:  # noqa: BLE001 - an unsupported control is not fatal
            log.warning("camera tuning not applied: %s", exc)

    def close(self):
        if self._picam is None:
            return
        for method in ("stop_recording", "close"):
            try:
                getattr(self._picam, method)()
            except Exception:  # noqa: BLE001 - already tearing down
                pass
        self._picam = None


class _UsbBackend:
    """USB camera through V4L2. OpenCV hands us raw frames, so we encode them."""

    name = "usb"

    def __init__(self, output):
        self._output = output
        self._capture = None
        self._thread = None
        self._stop = threading.Event()
        self._cv2 = None
        self._index = None
        self._ranges = {}
        self.detail = None
        # Remembered so it can be re-applied to a device that came back.
        self._tuning = None

    def _scan(self):
        """Find a readable capture device. Returns (capture, index) or (None, None).

        Always a fresh scan, never a remembered index: a camera that is unplugged
        and plugged back in typically returns on a different /dev/video node, so
        reopening the old one would fail for as long as the robot is up.
        """
        cv2 = self._cv2
        for candidate in range(USB_MAX_DEVICE_INDEX + 1):
            probe = cv2.VideoCapture(candidate, cv2.CAP_V4L2)
            if not probe.isOpened():
                probe.release()
                continue
            # Ask the camera for MJPEG. Most USB webcams compress on-device, so
            # this avoids decoding and re-encoding every frame on the Pi's CPU.
            probe.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
            probe.set(cv2.CAP_PROP_FRAME_WIDTH, RESOLUTION[0])
            probe.set(cv2.CAP_PROP_FRAME_HEIGHT, RESOLUTION[1])
            probe.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # newest frame, not a backlog

            ok, _ = probe.read()
            if ok:
                return probe, candidate
            probe.release()
        return None, None

    def _adopt(self, capture, index):
        """Take a freshly opened device as the live one, and re-learn its controls."""
        cv2 = self._cv2
        self._capture = capture
        self._index = index
        self._ranges = {}
        for key, cid in (
            ("brightness", V4L2_CID_BRIGHTNESS),
            ("contrast", V4L2_CID_CONTRAST),
        ):
            bounds = _v4l2_control_range(index, cid)
            if bounds is None:
                log.info("camera has no adjustable %s", key)
            else:
                log.info("camera %s range: min=%d max=%d default=%d", key, *bounds)
                self._ranges[key] = bounds

        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)) or RESOLUTION[0]
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)) or RESOLUTION[1]
        self.detail = f"{width}x{height} on /dev/video{index}"

    def start(self):
        import cv2

        self._cv2 = cv2
        capture, index = self._scan()
        if capture is None:
            raise RuntimeError(
                f"no readable USB camera on /dev/video0..{USB_MAX_DEVICE_INDEX}"
            )

        self._adopt(capture, index)
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="usb-camera", daemon=True)
        self._thread.start()
        return self.detail

    def _reconnect(self):
        """Drop the dead handle and go looking for the camera again.

        Whatever tuning was in force is re-applied, because a re-enumerated
        device comes back at the driver's defaults and the operator did not ask
        for their brightness to be forgotten by a loose cable.
        """
        if self._capture is not None:
            try:
                self._capture.release()
            except Exception:  # noqa: BLE001 - it is already gone
                pass
            self._capture = None

        capture, index = self._scan()
        if capture is None:
            return False

        self._adopt(capture, index)
        if self._tuning is not None:
            self.apply_tuning(self._tuning)
        log.info("USB camera reconnected: %s", self.detail)
        return True

    def apply_tuning(self, tuning):
        """Map -1..1 onto each control's real range, queried from the driver.

        `VideoCapture.set` returns False rather than raising when a camera
        refuses a control, so check the return value -- otherwise a rejected
        setting is indistinguishable from an applied one, which is exactly how
        "the image settings do nothing" goes unnoticed.
        """
        self._tuning = tuning
        if self._capture is None or self._cv2 is None:
            return
        cv2 = self._cv2
        for key, prop, value in (
            ("brightness", cv2.CAP_PROP_BRIGHTNESS, tuning.brightness),
            ("contrast", cv2.CAP_PROP_CONTRAST, tuning.contrast),
        ):
            bounds = self._ranges.get(key)
            if bounds is None:
                continue
            native = _scale_to_range(value, bounds)
            try:
                applied = self._capture.set(prop, native)
            except Exception as exc:  # noqa: BLE001 - many webcams ignore these
                log.warning("camera %s not applied: %s", key, exc)
                continue
            if not applied:
                log.warning("camera refused %s=%d", key, native)

    def _run(self):
        cv2 = self._cv2
        params = [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]
        failures = 0
        while not self._stop.is_set():
            try:
                ok, frame = self._capture.read()
            except Exception as exc:  # noqa: BLE001 - a USB unplug must not crash us
                log.warning("USB camera read failed: %s", exc)
                ok = False

            if not ok:
                failures += 1
                if failures == 10:
                    log.warning("USB camera stopped returning frames")
                if failures >= RECONNECT_AFTER_FAILURES:
                    # Reads are not coming back on their own. Go and find the
                    # device again rather than spinning here until someone
                    # restarts the service.
                    if self._reconnect():
                        failures = 0
                    else:
                        self._stop.wait(RECONNECT_INTERVAL_S)
                    continue
                self._stop.wait(0.1)
                continue

            failures = 0
            try:
                # Cheap here and nowhere else: the frame is already decoded and
                # about to be re-encoded, so this is a rotate on work that was
                # happening anyway rather than a decode of its own.
                frame = _apply_mount_rotation(cv2, frame)
                encoded, buf = cv2.imencode(".jpg", frame, params)
            except Exception as exc:  # noqa: BLE001
                log.warning("JPEG encode failed: %s", exc)
                continue
            if encoded:
                self._output.write(buf.tobytes())

    def close(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
        if self._capture is not None:
            try:
                self._capture.release()
            except Exception:  # noqa: BLE001 - already tearing down
                pass
            self._capture = None


class _PixelWorker:
    """Decodes, reworks and re-encodes frames. Runs only while it has a job.

    Deliberately a separate stream rather than an inline filter on the client
    generator: with two consoles open, an inline filter would do the work twice.

    Dehaze and sharpening share this one decode/encode. Doing them in separate
    workers would pay the expensive part -- the JPEG round trip -- twice to run
    two operations that each take a fraction of it. Order matters: dehaze first,
    because sharpening the veil before removing it amplifies the haze's own
    texture and then subtracts a picture that no longer matches.
    """

    def __init__(self, source, sink, tuning):
        self._source = source
        self._sink = sink
        self._tuning = tuning
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="pixel-worker", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None

    def _run(self):
        try:
            import cv2
            import numpy as np
        except ImportError as exc:
            log.warning("image processing needs OpenCV, which is absent: %s", exc)
            return

        params = [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]
        seen = None
        processed = 0
        spent = 0.0

        while not self._stop.is_set():
            frame, seen = self._source.wait_for_frame(timeout=1.0, since=seen)
            if frame is None:
                continue
            began = time.monotonic()
            try:
                image = cv2.imdecode(np.frombuffer(frame, np.uint8), cv2.IMREAD_COLOR)
                if image is None:
                    continue
                if self._tuning.dehaze:
                    image = dehaze_bgr(cv2, np, image)
                image = sharpen_bgr(cv2, image, self._tuning.sharpness)
                encoded, buf = cv2.imencode(".jpg", image, params)
            except Exception as exc:  # noqa: BLE001 - never kill the stream over a filter
                log.warning("image processing failed on a frame: %s", exc)
                continue
            if encoded:
                self._sink.write(buf.tobytes())

            # The docstring claims this costs real CPU. Say how much, so the
            # claim can be checked on the robot rather than taken on trust.
            spent += time.monotonic() - began
            processed += 1
            if processed % 100 == 0:
                log.info("image processing: %.0f ms per frame", 1000.0 * spent / processed)
                processed, spent = 0, 0.0


class Camera:
    def __init__(self, autostart=True):
        self._lock = threading.Lock()
        self._raw = None
        self._processed = None
        self._worker = None
        self._backend = None
        self._error = None
        self._detail = None
        self._streaming = False
        self.tuning = Tuning()

        if autostart:
            self.start()

    @property
    def available(self):
        return self._streaming

    def start(self):
        with self._lock:
            if self._streaming:
                return True

            output = StreamingOutput()
            errors = []
            for factory in (_CsiBackend, _UsbBackend):
                backend = factory(output)
                try:
                    detail = backend.start()
                except Exception as exc:  # noqa: BLE001 - absent camera is supported
                    errors.append(f"{backend.name}: {type(exc).__name__}: {exc}")
                    # Log as we go. Previously these were only surfaced if every
                    # backend failed, so a CSI failure that still damaged the USB
                    # path left no trace at all.
                    log.info("%s backend unavailable: %s", backend.name, exc)
                    backend.close()
                    continue

                self._raw = output
                self._processed = StreamingOutput()
                self._backend = backend
                self._detail = detail
                self._streaming = True
                self._error = None
                backend.apply_tuning(self.tuning)
                log.info("camera streaming (%s): %s", backend.name, detail)
                return True

            self._error = " | ".join(errors)
            log.warning("camera unavailable (continuing without it): %s", self._error)
            return False

    # --- tuning ---

    def set_tuning(self, brightness=None, contrast=None, dehaze=None, sharpness=None):
        """Apply tuning. Returns the tuning actually in force."""
        with self._lock:
            self.tuning.update(brightness, contrast, dehaze, sharpness)
            if self._backend is not None:
                self._backend.apply_tuning(self.tuning)
            self._sync_worker()
            return self.tuning.as_dict()

    def _sync_worker(self):
        """Start or stop the pixel worker to match the tuning. Holds _lock."""
        wanted = self.tuning.needs_pixels and self._streaming
        if wanted and self._worker is None:
            self._worker = _PixelWorker(self._raw, self._processed, self.tuning)
            self._worker.start()
        elif not wanted and self._worker is not None:
            self._worker.stop()
            self._worker = None

    def _client_output(self):
        """What clients read: the reworked stream when anything is on, else raw."""
        return self._processed if self._worker is not None else self._raw

    # --- frame access ---

    def latest_jpeg(self):
        """The frame the operator is looking at. For snapshots."""
        output = self._client_output()
        if output is None:
            return None
        frame, _ = output.latest()
        return frame

    def raw_output(self):
        """The unprocessed stream. For the estimators, which want it stable."""
        return self._raw

    def frames(self):
        """Yield multipart MJPEG chunks. Ends cleanly if the camera goes away."""
        if not self._streaming:
            return

        output = None
        seen = None
        while self._streaming:
            # Re-read the source each time round rather than binding it once.
            # An MJPEG <img> holds one connection for as long as the console is
            # open, so a generator that picked its output at the start could
            # never show a dehaze toggle: the operator flipped the switch and
            # nothing happened, for the lifetime of the page.
            current = self._client_output()
            if current is None:
                return
            if current is not output:
                # Sequence numbers are per-output, so a carried-over `seen` from
                # the other stream would either skip frames or block.
                output, seen = current, None

            frame, seen = output.wait_for_frame(since=seen)
            if frame is None:
                log.warning(
                    "no camera frame for %.0f s, ending stream", FRAME_WAIT_TIMEOUT_S
                )
                return
            yield (
                b"--" + BOUNDARY.encode() + b"\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
                + frame + b"\r\n"
            )

    def status(self):
        return {
            "available": self._streaming,
            "source": self._backend.name if self._backend else None,
            # Read off the backend, not remembered from start: a camera that
            # reconnected may be on a different node, and a status line naming
            # the node it used to be on is worse than none.
            "resolution": self._backend.detail if self._backend else None,
            "tuning": self.tuning.as_dict(),
            "error": self._error,
        }

    def close(self):
        with self._lock:
            if not self._streaming:
                return
            self._streaming = False
            if self._worker is not None:
                self._worker.stop()
                self._worker = None
            # Wake any reader blocked on the condition so generators can exit.
            for output in (self._raw, self._processed):
                if output is not None:
                    with output.condition:
                        output.condition.notify_all()
            if self._backend is not None:
                self._backend.close()
                self._backend = None
            self._raw = None
            self._processed = None
            log.info("camera closed")
