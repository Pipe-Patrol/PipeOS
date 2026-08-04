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
controls, or V4L2 controls -- so they cost nothing per frame. Dehaze cannot be:
it is a pixel operation, so enabling it starts a worker that decodes, processes
and re-encodes every frame. That is real CPU on a Pi that is also running flow
and inference, so it is off by default and the cost is the reason.

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

log = logging.getLogger(__name__)

RESOLUTION = (640, 480)
JPEG_QUALITY = 75
FRAME_WAIT_TIMEOUT_S = 5.0
USB_MAX_DEVICE_INDEX = 9  # scan /dev/video0 .. /dev/video9
BOUNDARY = "frame"

# Dehaze is CLAHE on the luminance channel. Pipes are low-contrast and hazy
# under LED light, and local histogram equalisation is what actually recovers
# texture there -- a global curve just clips the highlights off the pipe crown.
DEHAZE_CLIP_LIMIT = 2.5
DEHAZE_TILE_GRID = (8, 8)

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

    def update(self, brightness=None, contrast=None, dehaze=None):
        if brightness is not None:
            self.brightness = _clamp_unit(brightness)
        if contrast is not None:
            self.contrast = _clamp_unit(contrast)
        if dehaze is not None:
            self.dehaze = bool(dehaze)
        return self

    def as_dict(self):
        return {
            "brightness": round(self.brightness, 3),
            "contrast": round(self.contrast, 3),
            "dehaze": self.dehaze,
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
        return f"{RESOLUTION[0]}x{RESOLUTION[1]}"

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

    def start(self):
        import cv2

        self._cv2 = cv2
        capture, index = None, None
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
                capture, index = probe, candidate
                break
            probe.release()

        if capture is None:
            raise RuntimeError(
                f"no readable USB camera on /dev/video0..{USB_MAX_DEVICE_INDEX}"
            )

        self._capture = capture
        self._index = index
        # Ask the driver what these controls actually expect, once, at start.
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

        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="usb-camera", daemon=True)
        self._thread.start()

        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)) or RESOLUTION[0]
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)) or RESOLUTION[1]
        return f"{width}x{height} on /dev/video{index}"

    def apply_tuning(self, tuning):
        """Map -1..1 onto each control's real range, queried from the driver.

        `VideoCapture.set` returns False rather than raising when a camera
        refuses a control, so check the return value -- otherwise a rejected
        setting is indistinguishable from an applied one, which is exactly how
        "the image settings do nothing" goes unnoticed.
        """
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


class _Dehazer:
    """Decodes, equalises and re-encodes frames. Only runs while dehaze is on.

    Deliberately a separate stream rather than an inline filter on the client
    generator: with two consoles open, an inline filter would do the work twice.
    """

    def __init__(self, source, sink):
        self._source = source
        self._sink = sink
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="dehaze", daemon=True)
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
            log.warning("dehaze needs OpenCV, which is not installed: %s", exc)
            return

        clahe = cv2.createCLAHE(clipLimit=DEHAZE_CLIP_LIMIT, tileGridSize=DEHAZE_TILE_GRID)
        params = [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]
        seen = None

        while not self._stop.is_set():
            frame, seen = self._source.wait_for_frame(timeout=1.0, since=seen)
            if frame is None:
                continue
            try:
                image = cv2.imdecode(np.frombuffer(frame, np.uint8), cv2.IMREAD_COLOR)
                if image is None:
                    continue
                lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
                lab[:, :, 0] = clahe.apply(lab[:, :, 0])
                image = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
                encoded, buf = cv2.imencode(".jpg", image, params)
            except Exception as exc:  # noqa: BLE001 - never kill the stream over a filter
                log.warning("dehaze failed on a frame: %s", exc)
                continue
            if encoded:
                self._sink.write(buf.tobytes())


class Camera:
    def __init__(self, autostart=True):
        self._lock = threading.Lock()
        self._raw = None
        self._processed = None
        self._dehazer = None
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

    def set_tuning(self, brightness=None, contrast=None, dehaze=None):
        """Apply tuning. Returns the tuning actually in force."""
        with self._lock:
            self.tuning.update(brightness, contrast, dehaze)
            if self._backend is not None:
                self._backend.apply_tuning(self.tuning)
            self._sync_dehazer()
            return self.tuning.as_dict()

    def _sync_dehazer(self):
        """Start or stop the pixel worker to match the tuning. Holds _lock."""
        wanted = self.tuning.dehaze and self._streaming
        if wanted and self._dehazer is None:
            self._dehazer = _Dehazer(self._raw, self._processed)
            self._dehazer.start()
        elif not wanted and self._dehazer is not None:
            self._dehazer.stop()
            self._dehazer = None

    def _client_output(self):
        """The stream clients should read: processed when dehaze is on, else raw."""
        return self._processed if self._dehazer is not None else self._raw

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
        output = self._client_output()
        if not self._streaming or output is None:
            return

        seen = None
        while self._streaming:
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
            "resolution": self._detail,
            "tuning": self.tuning.as_dict(),
            "error": self._error,
        }

    def close(self):
        with self._lock:
            if not self._streaming:
                return
            self._streaming = False
            if self._dehazer is not None:
                self._dehazer.stop()
                self._dehazer = None
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
