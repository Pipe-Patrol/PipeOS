"""Defect detection: the interface, and the models that fill it."""

from pipepatrol import config
from pipepatrol.perception.detector import Detection, DetectionService, NullDetector
from pipepatrol.perception.remote import RemoteDetector
from pipepatrol.perception.rfdetr import RfDetrDetector

__all__ = [
    "Detection",
    "DetectionService",
    "NullDetector",
    "RemoteDetector",
    "RfDetrDetector",
    "best_detector",
    "detector_for",
]

NO_HOST = (
    "no detection host configured — set one in Settings, and run "
    "server/detect-host.py on that machine"
)


def detector_for(url):
    """The backend for a configured host, or one that says why there is none.

    The console's settings screen retargets a running robot through this, so the
    "no host" case has to carry the same explanation `best_detector` would have
    given at boot. A backend that is merely absent tells an operator nothing.
    """
    return RemoteDetector(url) if url else NullDetector(note=NO_HOST)


def best_detector():
    """A detection host if one is configured, a local model if one is installed.

    Chosen here rather than in robot.py so there is one place that decides, and
    so the reason a model is absent survives into the telemetry the console
    shows -- "cannot reach 10.0.0.4:8600" is something an operator can act on,
    where a silently missing backend is not.

    REMOTE FIRST, and on the robot remote is the only one that ever hits: the
    ONNX graph is not deployed to the Pi and onnxruntime is not installed there.
    The local branch is what `detect-host.py` and a laptop dev server take, which
    is the same code path the robot used to take -- one detector class, still,
    just no longer on the robot.
    """
    url = config.detector_url()
    if url or not config.ALLOW_LOCAL_MODEL:
        return detector_for(url)

    detector = RfDetrDetector()
    if detector.available:
        return detector
    return NullDetector(note=detector.error)
