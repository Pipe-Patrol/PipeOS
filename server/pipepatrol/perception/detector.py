"""Defect detection: the seam the models drop into.

No model ships in this file, deliberately. A backend is anything with `name`,
`available`, `error` and `infer(jpeg, min_confidence=None) -> list[Detection]`,
and there are three: `remote.py` posts frames to a detection host and is the
only one the robot ever uses, while `rfdetr.py` (ONNX) and `model.py` (torch,
plus an anomaly bank) are what that host serves. `catalogue.py` picks between
the latter two, and an operator switches them from the console.

WHY THE SERVICE EXISTS AT ALL. If the video stream waited on inference, driving
would be unusable -- so the two are decoupled: video runs at full rate, this
samples whatever frame is current whenever the previous inference finished, and
every detection carries the moment it was made. That was written when inference
was seconds per frame on the Pi; it stays because it is the right shape, not
because it is still a workaround.

ONE FRAME AT A TIME. `active()` holds the last inference's findings and nothing
else. `_observations` is the opposite and is kept for the whole pass, because
the reasoning layer argues from everything a run has seen rather than from
what is on the glass now.
"""

import logging
import threading
import time
import uuid

log = logging.getLogger(__name__)

# A staleness guard, not a display duration.
#
# Each inference REPLACES the previous one, so in normal running a box lives
# exactly until the next result lands and no longer. This only covers the case
# where results stop arriving at all -- the detection host went away, the model
# threw, the thread wedged -- where the last frame's boxes would otherwise sit
# on the glass indefinitely, describing a stretch of pipe the robot left long
# ago. Past this, the overlay goes empty rather than confident and wrong.
DETECTION_STALE_S = 6.0

# Never start an inference more often than this, however fast the model is.
MIN_INFERENCE_INTERVAL_S = 0.2

# How long a supplied frame keeps the camera loop out of the way.
#
# WHY THIS EXISTS. In demo mode the console feeds recorded footage in through
# `infer_once`, and the camera is pointed at whatever the robot is sitting on --
# a table, usually. Left running, the sampling loop below would spend the Pi's
# cores inferring over a ceiling while the frames somebody is actually watching
# queue behind it. On hardware where one inference is seconds, that is the
# difference between a demo that responds and one that does not.
#
# A timeout rather than an explicit pause/resume pair: a browser that closes, a
# tab that crashes or a console that drops off the network all leave an explicit
# pause latched on forever, and the robot would come back from demo day with
# detection silently switched off.
DEMO_HOLDOFF_S = 5.0


class Detection:
    """One model output, stamped with where and when it was seen."""

    __slots__ = ("id", "label", "confidence", "box", "at", "chainage_m")

    def __init__(self, label, confidence, box=None, chainage_m=None):
        self.id = uuid.uuid4().hex[:12]
        self.label = label
        self.confidence = float(confidence)
        # Normalised xyxy against the whole frame, 0..1, or None when the model
        # classifies without localising.
        self.box = box
        self.at = time.time()
        self.chainage_m = chainage_m

    def as_dict(self):
        return {
            "id": self.id,
            "label": self.label,
            "confidence": round(self.confidence, 4),
            "box": self.box,
            "at": round(self.at, 3),
            "chainage_m": self.chainage_m,
        }


class NullDetector:
    """No model. Carries the reason, so the console can say which.

    `note` is why: no ONNX file, no runtime, a graph that would not load. An
    operator can do something about each of those, and "detection unavailable"
    on its own tells them nothing.
    """

    name = "none"
    available = False

    def __init__(self, note=None):
        self.error = note

    def infer(self, jpeg):  # noqa: ARG002 - the signature is the contract
        return []


class DetectionService:
    """Runs a detector against the live camera, off the video path.

    Swap the backend by passing a different object with `name`, `available` and
    `infer(jpeg) -> list[Detection]`.
    """

    def __init__(self, camera, detector=None, chainage_source=None):
        self._camera = camera
        self._detector = detector or NullDetector()
        # Called for each inference to stamp detections with where the robot was.
        self._chainage_source = chainage_source
        self._lock = threading.Lock()
        # The last inference's findings, whole, and when they were taken. Not an
        # accumulator: see active().
        self._detections = []
        self._detections_at = 0.0
        # The whole pass, kept. The opposite of _detections above, and
        # deliberately: the overlay wants the newest frame and nothing else,
        # the reasoning layer argues from everything the run has seen.
        self._observations = []
        self._stop = threading.Event()
        self._thread = None
        self._last_ms = None
        self._error = None
        # When a frame last arrived from somewhere other than the camera.
        self._supplied_at = 0.0

    @property
    def available(self):
        return self._detector.available

    @property
    def backend(self):
        """The detector itself, for callers that need more than the interface.

        The model-switching endpoints use this: asking a detection host which
        models it has is a question only the remote backend can answer, and
        widening the detector interface with it would put it on NullDetector
        and on the local model, where it means nothing.
        """
        return self._detector

    def forget(self):
        """Drop what is on the overlay, keeping the backend.

        For a model switch. The boxes were judged by a model that is no longer
        loaded, and leaving them up would attribute them to the new one.
        """
        with self._lock:
            self._detections = []
            self._detections_at = 0.0

    def set_backend(self, detector):
        """Swap the model behind the service while it is running.

        The console's settings screen retargets the detection host with this. It
        starts the sampling loop if the new backend has one to start and the old
        one did not -- a robot that booted with no host configured must begin
        detecting the moment one is entered, without a restart.

        The old backend's findings go with it. They describe frames judged by a
        different model on a different machine, and leaving them on the overlay
        would attribute them to the new one.
        """
        with self._lock:
            self._detector = detector
            self._detections = []
            self._detections_at = 0.0
            self._error = None
            self._last_ms = None
        self.start()

    def start(self):
        if self._thread is not None or not self._detector.available:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="detector", daemon=True)
        self._thread.start()

    def close(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5.0)
            self._thread = None

    def active(self, now=None):
        """The most recent frame's detections, or nothing if they have gone stale.

        The set is whole-frame: the model judges each image alone, so the answer
        for the newest frame is the complete answer, and mixing it with an older
        frame's would draw the same crack twice at two positions. It is dropped
        as a unit for the same reason -- half a frame's findings is not a
        smaller truth, it is a different one.
        """
        now = time.time() if now is None else now
        with self._lock:
            if self._detections and now - self._detections_at >= DETECTION_STALE_S:
                self._detections = []
            return list(self._detections)

    def observations(self):
        """Every detection of the pass, for reasoning rather than the overlay."""
        from pipepatrol.reasoning import Observation

        with self._lock:
            return [Observation.from_detection(d) for d in self._observations]

    def clear_observations(self):
        """Start a fresh pass."""
        with self._lock:
            self._observations = []

    def _run(self):
        while not self._stop.is_set():
            started = time.monotonic()

            # Something else is feeding this model. Stay out of its way.
            if started - self._supplied_at < DEMO_HOLDOFF_S:
                self._stop.wait(0.25)
                continue

            jpeg = self._camera.latest_jpeg()
            if jpeg is None:
                self._stop.wait(0.5)
                continue

            chainage = self._chainage_source() if self._chainage_source else None
            try:
                found = self._detector.infer(jpeg)
                self._error = None
            except Exception as exc:  # noqa: BLE001 - a model fault must not stop driving
                log.warning("inference failed: %s", exc)
                self._error = f"{type(exc).__name__}: {exc}"
                self._stop.wait(1.0)
                continue

            elapsed = time.monotonic() - started
            self._last_ms = round(elapsed * 1000, 1)

            for detection in found:
                if detection.chainage_m is None:
                    detection.chainage_m = chainage

            # Replaced, not appended -- including when the model found nothing,
            # which is the case that matters. A frame with no defects is an
            # answer, and letting the previous frame's boxes survive it is what
            # turns the overlay into a pile of stale rectangles.
            with self._lock:
                self._detections = found
                self._detections_at = time.time()
                self._observations.extend(found)

            self._stop.wait(max(0.0, MIN_INFERENCE_INTERVAL_S - elapsed))

    def infer_once(self, jpeg, min_confidence=None):
        """Run the detector against a frame from somewhere other than the camera.

        Used by demo mode, which feeds recorded footage in from the console. It
        goes straight to the backend rather than through the sampling loop
        above: there is no video to hold up, and the caller wants the answer for
        the frame it just sent rather than for whatever the camera saw last.
        """
        # Marked before the inference, not after: a slow model must not let the
        # camera loop start a second one while this is still running.
        self._supplied_at = time.monotonic()
        # Not every backend takes a floor -- NullDetector does not -- so it is
        # only passed when asked for.
        found = (
            self._detector.infer(jpeg, min_confidence)
            if min_confidence is not None
            else self._detector.infer(jpeg)
        )
        self._supplied_at = time.monotonic()
        chainage = self._chainage_source() if self._chainage_source else None
        for detection in found:
            if detection.chainage_m is None:
                detection.chainage_m = chainage
        return found

    def status(self):
        return {
            "backend": self._detector.name,
            "available": self._detector.available,
            "last_inference_ms": self._last_ms,
            # A fault raised while running outranks the reason the backend gave
            # for being absent: the first is happening now.
            "error": self._error or getattr(self._detector, "error", None),
        }
