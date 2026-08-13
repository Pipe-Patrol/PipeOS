"""Defect detection: the seam a model drops into.

No model ships here. The one that will is not written yet and will not be
PipePatrolML, so this file defines the shape of the hole rather than filling it.
`NullDetector` is the backend in use today; the console renders detections,
filters them by confidence and ages them out against this interface, so landing
a real model is one class and a config line.

WHY THE SERVICE EXISTS AT ALL. Inference on a Pi is slow -- seconds per frame is
the expectation. If the video stream waited on it, driving would be unusable. So
the two are decoupled: video runs at full rate, this samples whatever frame is
current whenever the previous inference finished, and every detection carries
the moment it was made. The console fades them out rather than implying they
describe what is on screen right now.
"""

import logging
import threading
import time
import uuid

log = logging.getLogger(__name__)

# How long a detection stays on the overlay after the frame it came from. Long
# enough to read at a crawl, short enough that it cannot describe a different
# stretch of pipe.
DETECTION_TTL_S = 6.0

# Never start an inference more often than this, however fast the model is.
MIN_INFERENCE_INTERVAL_S = 0.2


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
    """The backend in use until a model exists. Reports itself as absent."""

    name = "none"
    available = False

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
        self._detections = []
        self._observations = []
        self._stop = threading.Event()
        self._thread = None
        self._last_ms = None
        self._error = None

    @property
    def available(self):
        return self._detector.available

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
        """Detections young enough to still describe what is on screen."""
        now = time.time() if now is None else now
        with self._lock:
            self._detections = [
                d for d in self._detections if now - d.at < DETECTION_TTL_S
            ]
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
            with self._lock:
                self._detections.extend(found)
                self._observations.extend(found)

            self._stop.wait(max(0.0, MIN_INFERENCE_INTERVAL_S - elapsed))

    def status(self):
        return {
            "backend": self._detector.name,
            "available": self._detector.available,
            "last_inference_ms": self._last_ms,
            "error": self._error,
        }
