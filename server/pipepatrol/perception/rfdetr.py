"""The defect model, running on whatever this is installed on.

ONE BACKEND, TWO MACHINES. onnxruntime ships wheels for both aarch64 Linux and
macOS, and the graph is the same file on each, so the Pi runs exactly what was
tested on a laptop. Nothing here is conditional on the platform except the
thread count.

WHAT THE MODEL IS. RF-DETR: an object detector, not a classifier. One pass over
one still image gives a fixed set of candidate objects, each with a box and a
score per class. Being DETR-family it needs no NMS -- the set is already
de-duplicated by the decoder -- so the post-processing here is a threshold and a
coordinate conversion, and that is all.

IT HAS NO MEMORY. Every frame is judged alone; nothing tracks a crack from one
frame to the next. That is why DetectionService stamps each detection with the
moment it was made and the console fades them rather than implying they describe
what is on screen now.

SPEED, HONESTLY. On a Pi 5 this is seconds per frame, not frames per second. It
is not on the video path and it is not on the safety path -- the stream runs at
full rate whatever this is doing, and a slow model means detections arrive late,
never that driving stutters. See detector.py.
"""

import logging
import os
import time
from pathlib import Path

from pipepatrol.perception.detector import Detection

log = logging.getLogger(__name__)

# Where deploy.sh puts the exported graph. Overridable so a laptop can point at
# a file somewhere else without editing anything.
DEFAULT_MODEL_PATH = Path(
    os.environ.get(
        "PIPEPATROL_MODEL",
        Path(__file__).resolve().parents[2] / "model" / "pipe-defects.onnx",
    )
)

# Below this a detection is a guess, and a guess in an inspection report is worse
# than a gap. The console can raise it further per operator; it cannot lower it
# past here, because anything under this was not worth the bytes.
MIN_CONFIDENCE = 0.30

# At most this many per frame. The decoder always emits its full query set, and
# without a cap a confusing frame produces three hundred overlapping boxes.
MAX_DETECTIONS = 20

# ImageNet statistics, which is what the DINOv2 backbone was normalised with.
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)

# Index 0 of the classifier is the Roboflow project name rather than a class, and
# the last slot is no-object. See MODEL.md.
CLASS_NAMES = {
    1: "crack",
    2: "deposition",
    3: "incrustation",
    4: "joint offset",
    5: "obstruction",
    6: "root intrusion",
    7: "utility intrusion",
}


class RfDetrDetector:
    """Runs the exported ONNX graph over a JPEG and returns Detections.

    Constructed at startup. If anything is missing -- the runtime, the model
    file, a graph that will not load -- it reports `available = False` and says
    why, and the console shows that rather than failing to start. A robot with
    no model is a robot you can still drive out of a pipe.
    """

    name = "rf-detr"

    def __init__(self, model_path=None, threads=None):
        self.model_path = Path(model_path or DEFAULT_MODEL_PATH)
        self.available = False
        self.error = None
        self._session = None
        self._np = None
        self._cv2 = None
        self._size = None

        # The file first, and deliberately: on a deployed robot the runtime is
        # always installed, so a missing graph is the failure that actually
        # happens -- somebody forgot to run the export. "no model at <path>" is
        # something an operator can act on; "onnxruntime missing" sends them
        # looking in the wrong place.
        if not self.model_path.is_file():
            self.error = f"no model at {self.model_path} — run server/deploy/export-model.py"
            log.warning("defect model disabled: %s", self.error)
            return

        try:
            import cv2
            import numpy as np
            import onnxruntime
        except ImportError as exc:
            self.error = f"onnxruntime or OpenCV missing: {exc}"
            log.warning("defect model disabled: %s", self.error)
            return

        options = onnxruntime.SessionOptions()
        # Leave a core for the video stream and the control loop. A Pi 5 has
        # four, and an inference that saturates all of them makes driving feel
        # like the link has gone -- which is the one thing this must never do.
        options.intra_op_num_threads = threads or max(1, (os.cpu_count() or 4) - 1)
        options.graph_optimization_level = (
            onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL
        )

        try:
            self._session = onnxruntime.InferenceSession(
                str(self.model_path),
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
        except Exception as exc:  # noqa: BLE001 - a bad graph must not stop the server
            self.error = f"could not load the model: {exc}"
            log.error("defect model disabled: %s", self.error)
            return

        self._np = np
        self._cv2 = cv2
        self._input = self._session.get_inputs()[0].name

        # The graph states its own input size, so the letterboxing below follows
        # whatever the export was done at rather than a number copied here.
        shape = self._session.get_inputs()[0].shape
        self._size = int(shape[2]) if isinstance(shape[2], int) else 560

        self.available = True
        log.info(
            "defect model ready: %s at %dx%d, %d threads",
            self.model_path.name,
            self._size,
            self._size,
            options.intra_op_num_threads,
        )

    def infer(self, jpeg, min_confidence=None):
        """One frame in, a list of Detections out. Boxes are normalised xyxy.

        `min_confidence` overrides the floor, and exists for one reason: on a
        frame where the model finds nothing, the top score it *did* reach is the
        only thing that distinguishes "looked and was not convinced" from
        "broken and returns nothing for everything". The lab asks for zero.
        """
        if not self.available:
            return []

        np = self._np
        image = self._cv2.imdecode(
            np.frombuffer(jpeg, np.uint8), self._cv2.IMREAD_COLOR
        )
        if image is None:
            return []

        started = time.monotonic()
        tensor = self._prepare(image)
        outputs = self._session.run(None, {self._input: tensor})
        found = self._decode(outputs, min_confidence)
        log.debug(
            "inference %.0f ms, %d detections", (time.monotonic() - started) * 1000, len(found)
        )
        return found

    # --- internals ---

    def _prepare(self, image):
        """Square, normalised, NCHW.

        STRETCHED, NOT LETTERBOXED, and that is not a shortcut -- it is what the
        model was trained on. RF-DETR resizes straight to a square
        (`F.resize(t, [res, res])`, and `square_resize_div_64` in this
        checkpoint's training args), so a 4:3 frame is squashed to 1:1 on the
        way in. Letterboxing instead would present the model with black bars and
        a different aspect ratio than every image it learned from, which shows
        up as confidence collapsing across the board rather than as an error.

        Bilinear without antialiasing, to match the Albumentations resize used
        in training -- cv2.INTER_LINEAR is exactly that.

        Because the whole frame maps to the whole square, boxes come back
        already normalised to the original frame and need no correction.
        """
        np, cv2 = self._np, self._cv2
        size = self._size

        resized = cv2.resize(image, (size, size), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        rgb = (rgb - np.array(MEAN, dtype=np.float32)) / np.array(STD, dtype=np.float32)
        return np.transpose(rgb, (2, 0, 1))[None, ...].astype(np.float32)

    def _decode(self, outputs, min_confidence=None):
        """Model output to Detections, in the original frame's coordinates.

        RF-DETR emits `boxes` as cxcywh normalised to the padded square and
        `logits` as a per-query score for every class. Scores go through a
        sigmoid rather than a softmax -- the classes are independent, so one
        query may legitimately be a crack and nothing else at once.
        """
        np = self._np
        logits, boxes = self._pick_outputs(outputs)
        if logits is None:
            return []

        scores = 1.0 / (1.0 + np.exp(-logits[0]))  # (queries, classes)
        boxes = boxes[0]  # (queries, 4) cxcywh

        # The best class per query, ignoring index 0 -- it is the dataset's own
        # name, exported as if it were a class, and it must never be drawn.
        usable = scores[:, 1 : len(CLASS_NAMES) + 1]
        best_class = usable.argmax(axis=1) + 1
        best_score = usable.max(axis=1)

        keep = np.argsort(-best_score)[:MAX_DETECTIONS]
        floor = MIN_CONFIDENCE if min_confidence is None else float(min_confidence)

        found = []
        for index in keep:
            score = float(best_score[index])
            if score < floor:
                break  # sorted, so everything after this is worse

            # cxcywh, already normalised to the whole frame because the input
            # was stretched to fill the square rather than padded into it.
            cx, cy, w, h = (float(v) for v in boxes[index])
            x1, y1 = cx - w / 2, cy - h / 2
            x2, y2 = cx + w / 2, cy + h / 2

            box = [
                max(0.0, min(1.0, x1)),
                max(0.0, min(1.0, y1)),
                max(0.0, min(1.0, x2)),
                max(0.0, min(1.0, y2)),
            ]
            if box[2] - box[0] <= 0 or box[3] - box[1] <= 0:
                continue

            label = CLASS_NAMES.get(int(best_class[index]))
            if label is None:
                continue

            found.append(Detection(label=label, confidence=score, box=box))

        return found

    def _pick_outputs(self, outputs):
        """Which output is which, by shape rather than by position.

        Exporters do not agree on the order, and getting it backwards produces
        boxes made of logits -- which renders, in the wrong places, without
        raising anything.
        """
        logits = boxes = None
        for array in outputs:
            if array.ndim != 3:
                continue
            if array.shape[-1] == 4 and boxes is None:
                boxes = array
            elif array.shape[-1] >= len(CLASS_NAMES) + 1 and logits is None:
                logits = array
        return logits, boxes

    def status(self):
        return {
            "backend": self.name,
            "available": self.available,
            "error": self.error,
            "model": str(self.model_path),
            "input_size": self._size,
        }
