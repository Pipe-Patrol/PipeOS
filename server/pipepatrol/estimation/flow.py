"""Optical flow over the camera feed.

The camera looks down the pipe, so forward motion shows up as features sliding
*outward* from the centre of the image rather than sideways. That radial
expansion is the signal this module extracts.

Two numbers come out of it, and they answer different questions:

    divergence   1/s.  Rate of radial expansion. Relates forward speed `v` to
                       distance-to-surface `Z` by  divergence = v / Z.
    magnitude    px/s. Mean flow speed, regardless of direction. Answers "is
                       anything on screen moving at all", which is how a stall
                       is told from a slow crawl.

Divergence is the useful one twice over:

  * Multiplied by a calibrated scale it becomes a speed that notices wheel slip,
    because slipping wheels move the odometer and not the picture.
  * Inverted it is time-to-contact -- 1 / divergence -- with no scale factor and
    no camera calibration needed at all. That is what the obstacle warning uses.

Runs on its own thread at a fraction of the video rate. Video stays at full
speed; this is an estimator, not a viewer.
"""

import logging
import math
import threading
import time

log = logging.getLogger(__name__)

SAMPLE_HZ = 10.0
# Flow is computed on a downscaled copy. Pipe walls are low-texture and the
# features worth tracking are large, so resolution buys very little here and
# costs CPU that inference will want.
WORK_WIDTH = 160
MAX_FEATURES = 120
FEATURE_QUALITY = 0.05
FEATURE_MIN_DISTANCE = 6

# Features nearer the centre than this (as a fraction of the half-diagonal) are
# dropped from the divergence estimate: close to the focus of expansion the
# radial direction is ill-defined and dividing by a tiny radius amplifies noise.
MIN_RADIUS_FRACTION = 0.15

# Below this many surviving features the frame is not trustworthy. A dark or
# blank pipe wall genuinely has nothing to track, and inventing a number there
# is how a robot drives confidently into a wall.
MIN_TRACKED_FEATURES = 12

# Re-detect features when tracking has thinned out. Cheaper than detecting every
# frame, and LK holds on for a good while in a slowly-changing scene.
REDETECT_BELOW = 40


class FlowSample:
    """One flow measurement. `valid` false means the scene gave us nothing."""

    __slots__ = ("divergence", "magnitude", "features", "valid", "at")

    def __init__(self, divergence=0.0, magnitude=0.0, features=0, valid=False, at=0.0):
        self.divergence = divergence
        self.magnitude = magnitude
        self.features = features
        self.valid = valid
        self.at = at

    def as_dict(self):
        return {
            "divergence_per_s": round(self.divergence, 4),
            "magnitude_px_s": round(self.magnitude, 2),
            "features": self.features,
            "valid": self.valid,
        }


class OpticalFlow:
    """Samples the camera and publishes the most recent FlowSample.

    Absent OpenCV is a supported state: `available` goes false, samples stay
    invalid, and every consumer falls back to its non-visual path.
    """

    def __init__(self, camera, sample_hz=SAMPLE_HZ):
        self._camera = camera
        self._interval = 1.0 / sample_hz
        self._lock = threading.Lock()
        self._sample = FlowSample()
        self._stop = threading.Event()
        self._thread = None
        self._cv2 = None
        self._np = None
        self.available = False
        self.error = None

    def start(self):
        if self._thread is not None:
            return
        try:
            import cv2
            import numpy as np
        except ImportError as exc:
            self.error = f"OpenCV unavailable: {exc}"
            log.warning("optical flow disabled, distance falls back to duty: %s", exc)
            return
        self._cv2 = cv2
        self._np = np
        self.available = True
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="optical-flow", daemon=True)
        self._thread.start()

    def close(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None

    def latest(self):
        with self._lock:
            return self._sample

    # --- internals ---

    def _prepare(self, jpeg):
        """JPEG bytes -> small grayscale array, or None."""
        cv2, np = self._cv2, self._np
        image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_GRAYSCALE)
        if image is None:
            return None
        height, width = image.shape[:2]
        if width > WORK_WIDTH:
            scale = WORK_WIDTH / width
            image = cv2.resize(
                image, (WORK_WIDTH, max(1, int(height * scale))),
                interpolation=cv2.INTER_AREA,
            )
        return image

    def _detect(self, image):
        return self._cv2.goodFeaturesToTrack(
            image,
            maxCorners=MAX_FEATURES,
            qualityLevel=FEATURE_QUALITY,
            minDistance=FEATURE_MIN_DISTANCE,
        )

    def _run(self):
        cv2, np = self._cv2, self._np
        previous = None
        points = None
        previous_at = None
        seen = None

        while not self._stop.is_set():
            output = self._camera.raw_output()
            if output is None:
                self._publish(FlowSample(at=time.monotonic()))
                self._stop.wait(self._interval)
                continue

            jpeg, seen = output.wait_for_frame(timeout=1.0, since=seen)
            if jpeg is None:
                previous = None
                self._publish(FlowSample(at=time.monotonic()))
                continue

            now = time.monotonic()
            try:
                image = self._prepare(jpeg)
            except Exception as exc:  # noqa: BLE001 - a bad frame is not fatal
                log.debug("flow decode failed: %s", exc)
                image = None

            if image is None:
                previous = None
                self._stop.wait(self._interval)
                continue

            if previous is None or points is None or len(points) < REDETECT_BELOW:
                points = self._detect(image)
                previous, previous_at = image, now
                self._publish(FlowSample(at=now))
                self._stop.wait(self._interval)
                continue

            dt = now - previous_at
            if dt <= 0:
                self._stop.wait(self._interval)
                continue

            try:
                moved, status, _ = cv2.calcOpticalFlowPyrLK(previous, image, points, None)
            except Exception as exc:  # noqa: BLE001
                log.debug("flow tracking failed: %s", exc)
                previous, points = None, None
                continue

            sample = self._measure(points, moved, status, image.shape, dt, now)
            self._publish(sample)

            previous, previous_at = image, now
            points = moved[status.flatten() == 1].reshape(-1, 1, 2) if moved is not None else None

            self._stop.wait(self._interval)

    def _measure(self, before, after, status, shape, dt, now):
        """Radial expansion and mean speed over the surviving features."""
        np = self._np
        if after is None or status is None:
            return FlowSample(at=now)

        keep = status.flatten() == 1
        start = before.reshape(-1, 2)[keep]
        end = after.reshape(-1, 2)[keep]
        if len(start) < MIN_TRACKED_FEATURES:
            return FlowSample(features=int(len(start)), at=now)

        height, width = shape[:2]
        centre = np.array([width / 2.0, height / 2.0], dtype=np.float32)
        half_diagonal = math.hypot(width, height) / 2.0

        offsets = start - centre
        radii = np.linalg.norm(offsets, axis=1)
        near_centre = radii < MIN_RADIUS_FRACTION * half_diagonal

        displacement = end - start
        magnitude = float(np.mean(np.linalg.norm(displacement, axis=1))) / dt

        usable = ~near_centre
        if int(np.count_nonzero(usable)) < MIN_TRACKED_FEATURES:
            return FlowSample(magnitude=magnitude, features=int(len(start)), at=now)

        # Radial component of each feature's motion, divided by its radius. For
        # pure forward translation every feature gives the same answer, so the
        # median is a strong estimate and shrugs off a few bad tracks.
        radial = np.sum(displacement[usable] * offsets[usable], axis=1) / radii[usable]
        divergence = float(np.median(radial / radii[usable])) / dt

        return FlowSample(
            divergence=divergence,
            magnitude=magnitude,
            features=int(len(start)),
            valid=True,
            at=now,
        )

    def _publish(self, sample):
        with self._lock:
            self._sample = sample

    def status(self):
        sample = self.latest()
        return {"available": self.available, "error": self.error, **sample.as_dict()}
