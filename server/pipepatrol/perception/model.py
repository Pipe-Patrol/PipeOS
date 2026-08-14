"""RF-DETR from the torch checkpoint, with an optional anomaly bank.

The newer of the two models the catalogue can serve. `rfdetr.py` holds the
other -- the same architecture exported to ONNX, which needs no torch and is
what has actually been down a pipe. An operator picks between them from the
console; see catalogue.py.

WHERE IT RUNS. On a laptop, via detect-host.py. Loading it needs torch and the
`rfdetr` package, several gigabytes of it, and inference is slow enough that
putting it on the Pi is the thing that got the model taken off the Pi in the
first place. The robot never imports this.

Loading is deferred to the first inference, and a missing dependency reports
`available = False` rather than raising, so a host with no checkpoint still
starts and says why.

ANOMALY. Optionally, a memory bank of clean-pipe patches runs alongside the
detector and emits an UNKNOWN detection when a frame looks unlike anything in
it. The classifier knows seven conditions; a pipe contains more than seven
things. Without this the console stays silent on everything outside that list,
which is indistinguishable from healthy pipe.
"""

import io
import logging
import os

from pipepatrol.perception.detector import Detection

log = logging.getLogger(__name__)

# The trained classes, in the model's own words.
#
# NOT short codes. The console matches an incoming detection by this string --
# `detectionClassOf` in web/src/constants/detection-classes.ts, which keys on
# `crack`, `deposition` and so on -- and everything hangs off that match: the
# box colour, the per-class mute, the auto-flag rules, and whether a defect the
# model found counts as the same thing as a defect an operator logged by hand.
# A code like "CR" matches nothing, so the box still draws, in the fallback
# grey, with no way to mute it and no rule that can fire on it.
#
# The codes live in defects.ts and are derived FROM these names, which is the
# direction that keeps one vocabulary rather than two.
#
# Utility intrusion gets its own entry rather than being folded into
# obstruction: the console has had a class for it since the seven landed, and
# "obstruction" undersells a gas line bored through a sewer.
LABELS = {
    1: "crack",
    2: "deposition",
    3: "incrustation",
    4: "joint offset",
    5: "obstruction",
    6: "root intrusion",
    7: "utility intrusion",
}

CONF_THRESHOLD = float(os.environ.get("PIPEPATROL_CONF_THRESHOLD", "0.30"))

# Fraction of the frame the anomaly bank sees, centred. Inspection footage
# carries fixed hardware and overlays near the edges, and those score high in
# every frame, which says nothing about any particular one.
ANOMALY_CROP = float(os.environ.get("PIPEPATROL_ANOMALY_CROP", "0.9"))


def _normalise(x1, y1, x2, y2, width, height):
    """Pixel box to the 0..1 xyxy the console expects."""
    return [
        round(max(0.0, min(1.0, x1 / width)), 4),
        round(max(0.0, min(1.0, y1 / height)), 4),
        round(max(0.0, min(1.0, x2 / width)), 4),
        round(max(0.0, min(1.0, y2 / height)), 4),
    ]


# --------------------------------------------------------------------------

class RFDetrDetector:
    """RF-DETR in this process.

    Loading is deferred to the first inference. Import time is not the place to
    spend thirty seconds on a checkpoint, and a missing torch should show up as
    an unavailable backend rather than an ImportError at startup.
    """

    # Distinct from rfdetr.py's "rf-detr": the console shows this, and "which
    # of the two is loaded" is the whole question it is answering.
    name = "rfdetr-torch"

    def __init__(self, weights=None, anomaly_bank=None):
        self._weights = weights or os.environ.get("PIPEPATROL_WEIGHTS")
        self._model = None
        self._anomaly = AnomalyBank(anomaly_bank) if anomaly_bank else None
        self._failed = False
        # Part of the backend contract, alongside `name` and `available`. The
        # console shows it, the catalogue reads it, and a backend without one
        # takes them both down with an AttributeError the moment it becomes
        # available -- which is to say, the moment somebody installs the model.
        self.error = None

    @property
    def available(self):
        if self._failed or not self._weights:
            return False
        return os.path.exists(self._weights)

    def _load(self):
        from PIL import Image  # noqa: F401 - checked here so infer can assume it
        from rfdetr import RFDETRLarge

        log.info("loading detector from %s", self._weights)
        self._model = RFDETRLarge(pretrain_weights=self._weights)

    def infer(self, jpeg, min_confidence=None):
        """`min_confidence` overrides the floor, and the signature has to carry it.

        Every backend takes it: the model lab drops the floor to zero to tell
        "looked and was not convinced" apart from "returns nothing for
        everything", and DetectionService passes it straight through. A backend
        that omits the argument raises TypeError the first time somebody opens
        the lab against it, which is a long way from where the mistake was made.
        """
        if self._model is None:
            try:
                self._load()
            except Exception as exc:  # noqa: BLE001 - unavailable, not fatal
                log.warning("detector unavailable: %s", exc)
                self._failed = True
                # torch or the rfdetr package missing is the usual one, and
                # "unavailable" on its own sends somebody to the checkpoint
                # rather than to pip.
                self.error = f"could not load the checkpoint: {exc}"
                return []

        from PIL import Image

        image = Image.open(io.BytesIO(jpeg)).convert("RGB")
        width, height = image.size

        floor = CONF_THRESHOLD if min_confidence is None else float(min_confidence)
        result = self._model.predict(image, threshold=floor)

        found = []
        for box, confidence, class_id in zip(
            result.xyxy, result.confidence, result.class_id
        ):
            label = LABELS.get(int(class_id))
            if label is None:
                continue
            x1, y1, x2, y2 = box
            found.append(Detection(
                label=label,
                confidence=float(confidence),
                box=_normalise(x1, y1, x2, y2, width, height),
            ))

        if self._anomaly is not None:
            unknown = self._anomaly.check(image, silent=bool(found))
            if unknown is not None:
                found.append(unknown)

        return found


# --------------------------------------------------------------------------

# Remote inference lives in remote.py, not here.
#
# There were two RemoteDetectors for a while -- this module grew one at the same
# time as remote.py did, independently -- and two classes of the same name in
# sibling modules is the kind of thing that gets debugged twice. remote.py is
# the one that is wired: it posts the raw JPEG body rather than a multipart
# upload, needs no `requests` on the Pi, and treats a configured-but-unreachable
# host as still available so a laptop that wakes up resumes on its own.


# --------------------------------------------------------------------------

class AnomalyBank:
    """How far a frame sits from healthy pipe.

    A pretrained network turns each patch of an image into a list of numbers,
    and patches that look alike produce similar lists. The bank holds those
    lists for clean pipe; scoring measures how far a new patch is from the
    closest thing in it. Nothing is trained and no weights change, which is why
    a few hundred photographs of the pipe are enough.

    It has no vocabulary, so it says only that something is unlike healthy
    pipe, never what it is. That is the point: it covers the conditions the
    classifier has no class for.
    """

    def __init__(self, path):
        self._path = path
        self._bank = None
        self._model = None
        self._threshold = None
        self._crop = ANOMALY_CROP
        self._failed = False

    def _load(self):
        import numpy as np
        import torch

        from pipepatrol.perception.patchcore import PatchFeatures

        data = np.load(self._path)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self._bank = torch.from_numpy(data["bank"]).to(device)
        self._model = PatchFeatures().to(device)
        self._threshold = float(data["threshold"])
        if "crop" in data:
            self._crop = float(data["crop"][0])

    def check(self, image, silent):
        """An UNKNOWN detection, or None.

        Only fires when the classifier found nothing. A frame it already has a
        name for does not also need flagging as unnameable, and a second chip
        on a defect the operator can already see is noise.
        """
        if self._failed or silent:
            return None
        if self._bank is None:
            try:
                self._load()
            except Exception as exc:  # noqa: BLE001
                log.warning("anomaly bank unavailable: %s", exc)
                self._failed = True
                return None

        from pipepatrol.perception.patchcore import score_image

        score = score_image(self._model, self._bank, image, self._crop)
        if score < self._threshold:
            return None

        # Report it on the same 0..1 scale as a confidence, so the console can
        # render it with the machinery it already has.
        confidence = min(1.0, score / (self._threshold * 2))
        return Detection(label="UNKNOWN", confidence=confidence)
