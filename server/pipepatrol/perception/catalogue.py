"""The models that can be served, and how to build one by name.

WHY A CATALOGUE. There are now two trained things that can look at a frame, and
they are not interchangeable enough to pick automatically:

- `rfdetr-onnx` is the exported graph. Seven classes, no torch, quick, and the
  one that has been driven down a pipe.
- `rfdetr-torch` is the same architecture loaded from the checkpoint under
  torch, optionally with a clean-pipe memory bank alongside it that raises
  UNKNOWN for things outside those seven classes. Heavier, newer, and at time of
  writing not QC'd.

Which one is right depends on what the run is for, so an operator chooses, from
the console, with a button -- see api/system.py and the console's settings
screen. This module is only the list and the constructor.

WHERE THIS RUNS. Not on the robot. The Pi holds no graph and no runtime; it
posts frames to a detection host and that host is what consults this. The
robot's own choice is one thing -- which host -- and its backend is always
`RemoteDetector`. See remote.py.
"""

import logging
import os

log = logging.getLogger(__name__)

# The id the console sends, in order of preference. First available wins when
# nothing has been chosen.
DEFAULT_ORDER = ("rfdetr-onnx", "rfdetr-torch")

CATALOGUE = (
    {
        "id": "rfdetr-onnx",
        "label": "RF-DETR",
        "note": "The exported graph. Seven classes, quick, and the one that has been down a pipe.",
    },
    {
        "id": "rfdetr-torch",
        "label": "RF-DETR + anomaly",
        # Said plainly on the button, because it is the honest state of it and
        # an operator choosing a model mid-survey deserves to know.
        "note": "The checkpoint under torch, plus a clean-pipe bank that flags UNKNOWN. Not yet QC'd.",
    },
)


def build(model_id):
    """A detector for an id, or a NullDetector carrying why not.

    Never raises. Choosing a model that turns out not to be installed has to
    leave a working console reporting an honest reason, not a stack trace --
    this is reachable from a button an operator presses mid-run.
    """
    from pipepatrol.perception.detector import NullDetector

    if model_id == "rfdetr-onnx":
        from pipepatrol.perception.rfdetr import RfDetrDetector

        return RfDetrDetector()

    if model_id == "rfdetr-torch":
        from pipepatrol.perception.model import RFDetrDetector

        weights = os.environ.get("PIPEPATROL_WEIGHTS")
        if not weights:
            return NullDetector(
                note="rfdetr-torch needs PIPEPATROL_WEIGHTS pointing at the .pth checkpoint"
            )
        detector = RFDetrDetector(
            weights=weights, anomaly_bank=os.environ.get("PIPEPATROL_ANOMALY_BANK")
        )
        if not detector.available:
            return NullDetector(note=f"no checkpoint at {weights}")
        return detector

    return NullDetector(note=f"unknown model {model_id!r}")


def build_default():
    """The first model in the catalogue that is actually installed."""
    from pipepatrol.perception.detector import NullDetector

    reasons = []
    for model_id in DEFAULT_ORDER:
        detector = build(model_id)
        if detector.available:
            log.info("serving %s", model_id)
            return model_id, detector
        reasons.append(f"{model_id}: {detector.error}")

    return None, NullDetector(note="no model installed — " + "; ".join(reasons))


def describe(model_id, detector):
    """The catalogue, with each entry's availability filled in.

    Availability is asked of a freshly built backend rather than cached, because
    the answer changes when somebody drops a checkpoint next to the server and
    the point of the button is that they do not then have to restart it.
    """
    entries = []
    for entry in CATALOGUE:
        if entry["id"] == model_id:
            available, error = detector.available, detector.error
        else:
            candidate = build(entry["id"])
            available, error = candidate.available, candidate.error
        entries.append(
            {**entry, "available": available, "error": error, "selected": entry["id"] == model_id}
        )
    return entries
