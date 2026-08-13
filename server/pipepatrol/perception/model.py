"""Real detector backends, behind the seam `detector.py` defines.

Two of them, because there are two honest answers to where inference runs.

`RFDetrDetector` loads the model in this process. Simple, no network, and the
right answer on a laptop. On a Pi it means installing torch and waiting several
seconds a frame, which the service is built to tolerate but nobody enjoys.

`RemoteDetector` posts the frame to an inference server and needs only
`requests`. The Pi stays light, the laptop does the work, and the robot keeps
driving while it waits. This is the same split PipePatrolML already makes.

Both report `available = False` rather than raising when their dependencies are
missing, so a console with no model installed starts and runs exactly as it
does today. A detector that cannot load must not stop the robot.

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

# The trained classes, in the console's own codes from web/src/constants/defects.ts.
# Change the right-hand side to change what the operator sees; nothing else
# depends on the model's own naming.
#
# Utility intrusion has no code of its own yet, so it lands on OB: another
# utility bored through the pipe is, literally, an object restricting the bore.
# Give it its own entry in defects.ts and change one line here when there is
# time, because "obstacle" undersells a gas line through a sewer.
LABELS = {
    1: "CR",   # crack
    2: "DE",   # deposition
    3: "EN",   # incrustation
    4: "JD",   # joint offset
    5: "OB",   # obstruction
    6: "RO",   # root intrusion
    7: "OB",   # utility intrusion, see above
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

    name = "rfdetr"

    def __init__(self, weights=None, anomaly_bank=None):
        self._weights = weights or os.environ.get("PIPEPATROL_WEIGHTS")
        self._model = None
        self._anomaly = AnomalyBank(anomaly_bank) if anomaly_bank else None
        self._failed = False

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

    def infer(self, jpeg):
        if self._model is None:
            try:
                self._load()
            except Exception as exc:  # noqa: BLE001 - unavailable, not fatal
                log.warning("detector unavailable: %s", exc)
                self._failed = True
                return []

        from PIL import Image

        image = Image.open(io.BytesIO(jpeg)).convert("RGB")
        width, height = image.size

        result = self._model.predict(image, threshold=CONF_THRESHOLD)

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

class RemoteDetector:
    """Inference on another machine. The Pi carries no model.

    The frame goes out as JPEG bytes and comes back as detections. Everything
    about the shape of a Detection stays here, so the server can change without
    the console caring.
    """

    name = "remote"

    def __init__(self, url=None, timeout=None):
        self._url = url or os.environ.get("PIPEPATROL_INFERENCE_URL")
        self._timeout = timeout or float(
            os.environ.get("PIPEPATROL_INFERENCE_TIMEOUT", "15")
        )

    @property
    def available(self):
        return bool(self._url)

    def infer(self, jpeg):
        import requests

        response = requests.post(
            self._url,
            files={"file": ("frame.jpg", jpeg, "image/jpeg")},
            timeout=self._timeout,
        )
        response.raise_for_status()
        payload = response.json()

        found = []
        for item in payload.get("detections", []):
            label = item.get("label") or LABELS.get(item.get("class_id"))
            if not label:
                continue
            box = item.get("box")
            # A server that classifies without localising sends no box, and
            # that is allowed: the console draws a chip instead of a rectangle.
            found.append(Detection(
                label=label,
                confidence=float(item.get("confidence", 0.0)),
                box=box,
            ))

        score = payload.get("anomaly_score")
        threshold = payload.get("anomaly_threshold")
        if score is not None and threshold is not None and score >= threshold and not found:
            found.append(Detection(label="UNKNOWN", confidence=float(score)))

        return found


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


# --------------------------------------------------------------------------

def build_detector():
    """Whichever backend the environment asks for.

    Nothing configured means NullDetector stays in place and the console
    behaves exactly as it does today.
    """
    if os.environ.get("PIPEPATROL_INFERENCE_URL"):
        return RemoteDetector()

    weights = os.environ.get("PIPEPATROL_WEIGHTS")
    if weights:
        return RFDetrDetector(
            weights=weights,
            anomaly_bank=os.environ.get("PIPEPATROL_ANOMALY_BANK"),
        )

    from pipepatrol.perception.detector import NullDetector

    return NullDetector()
