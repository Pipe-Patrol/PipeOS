# Models

The detector and the anomaly bank are trained artifacts, not code. They live
outside the repo because each is around 130 MB and GitHub rejects files over
100 MB. Ask Newton for the current copies.

Nothing here is required to run PipeOS. With no environment variables set, the
console keeps `NullDetector` and behaves exactly as it did before any of this
landed.

---

## What the files are

| File | What it does | Which pipe |
|---|---|---|
| `sewer_rfdetr.pth` | seven-class defect detector | real sewer footage |
| `cardboard_rfdetr.pth` | same architecture, retrained | the demo pipe |
| `pc_cardboard.npz` | anomaly bank, "what healthy pipe looks like" | the demo pipe |
| `pc_crop.npz` | anomaly bank | real sewer footage |

Pair them by pipe. A detector trained on sewer concrete and an anomaly bank
built from white cardboard describe different worlds, and mixing them flags
every frame.

---

## Install

The checkpoints were written by rfdetr 1.9.0 and will not load under a
different version, so pin it:

```
pip install "rfdetr==1.9.0" torch torchvision pillow numpy
```

Put the files anywhere readable and point at them:

```
export PIPEPATROL_WEIGHTS=/path/to/cardboard_rfdetr.pth
export PIPEPATROL_ANOMALY_BANK=/path/to/pc_cardboard.npz
```

That is the whole configuration. `build_detector()` in
`perception/model.py` reads those two variables and picks the backend; set
neither and it returns `NullDetector`.

To run inference on another machine instead, set `PIPEPATROL_INFERENCE_URL` and
the Pi carries no model at all. That path needs only `requests`.

---

## What it outputs

Seven classes. `LABELS` in `perception/model.py` maps them to the console's own
codes, so changing what the operator sees is a one-line edit there and nothing
else depends on the model's naming.

| Model class | Console code |
|---|---|
| crack | CR |
| deposition | DE |
| incrustation | EN |
| joint offset | JD |
| obstruction | OB |
| root intrusion | RO |
| utility intrusion | UT |

`UT` is grouped Structural in `defects.ts` rather than Service, because the
defining fact is that something pierced the wall, not that the bore is
narrower, and that is the part that matters when someone puts a cutter down the
line.

The checkpoint reports eight classes on load, not seven. The extra one is a
dummy category the export tool writes at index 0 and it never predicts. The
warning is expected.

---

## What to expect when it runs

Inference is one to two seconds per frame on a laptop CPU, slower on a Pi.
`DetectionService` is built for that: video runs at full rate, inference
samples whatever frame is current when the last one finished, and detections
carry the moment they were made.

Confidence is thresholded at 0.30 rather than the usual 0.50, a constant in
`perception/model.py`. Cracks are thin and the model is cautious about
them, so a normal threshold misses most of them while a lower one costs little,
since precision on cracks stays around 0.70 either way.

The anomaly bank emits `UNKNOWN` detections, and only on frames where the
detector found nothing. A condition it already has a name for does not also
need flagging as unnameable. Those `UNKNOWN` rows are what the reasoning layer
picks up as conditions outside the trained classes.

---

## Checking it loaded

```
python -c "
from pipepatrol.perception.model import build_detector
d = build_detector()
print(d.name, d.available)
"
```

`rfdetr True` means it found the weights. `none False` means the environment
variables are not set, or the paths are wrong.

The first inference loads the checkpoint and takes about thirty seconds. That
is deliberate: import time is not the place to spend it, and a missing torch
should surface as an unavailable backend rather than a crash at startup.
