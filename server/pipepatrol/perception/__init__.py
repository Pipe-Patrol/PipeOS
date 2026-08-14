"""Defect detection: the interface, and the models that fill it."""

from pipepatrol import config
from pipepatrol.perception import discover, remote
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

def rediscover_detector():
    """A backend for a model found elsewhere on the robot's network, or None.

    Handed to DetectionService so a robot whose configured host has gone
    unreachable can find the laptop that actually has the model. None means
    "nothing better out there" and leaves the current backend alone, errors and
    all -- an unreachable host the operator configured is still information.
    """
    url = discover.find_detector()
    return detector_for(url) if url else None


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

    # Nothing configured, or what is configured is not answering: look for a
    # machine on the robot's own network that is serving the model. This is what
    # makes detection work after joining the hotspot without anyone redeploying
    # or typing an address -- see perception/discover.py for why an address
    # baked in at deploy time is wrong so often.
    #
    # A configured address that IS answering is never second-guessed.
    if not url or not discover._serves_model(remote.normalise_url(url)):
        found = discover.find_detector()
        if found:
            url = found

    if url or not config.ALLOW_LOCAL_MODEL:
        return detector_for(url)

    detector = RfDetrDetector()
    if detector.available:
        return detector
    return NullDetector(note=detector.error)
