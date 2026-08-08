# The defect model

The checkpoint is `checkpoint_best_total.pth` — an **RF-DETR** (DINOv2 ViT
backbone, 12 layers, deformable-DETR head) trained for 20 epochs on the Roboflow
set `Pipe-Defects-Detection-sewe-etkz`. It ships EMA weights alongside the raw
ones; the EMA copy is the one to serve.

## What it detects

Seven classes. This list is the source of truth for the console: it is mirrored
in `web/src/constants/detection-classes.ts`, and the observation list an operator
logs by hand is derived from it so that a defect found by the model and a defect
logged by a person are the same seven things.

| id | model label         | shown as          |
| -- | ------------------- | ----------------- |
| 1  | `crack`             | Crack             |
| 2  | `deposition`        | Deposition        |
| 3  | `incrustation`      | Incrustation      |
| 4  | `joint offset`      | Joint offset      |
| 5  | `obstruction`       | Obstruction       |
| 6  | `root intrusion`    | Root intrusion    |
| 7  | `utility intrusion` | Utility intrusion |

### Index 0 is not a class

The classifier head has nine outputs. Index 0 holds the Roboflow project's own
name, `Pipe-Defects-Detection-sewe-etkz`, which is an artefact of how the dataset
was exported rather than anything the model can mean, and index 8 is the
no-object slot every DETR carries. **Only 1–7 are ever rendered.** Reading the
checkpoint's `class_names` list straight through will otherwise put the name of a
dataset on the video as if it were a defect.

## Colours

Each class is drawn in its own colour, everywhere in the console, by
`web/src/components/overlay/DefectBox.tsx`. The defaults live with the class
table; an operator can override any of them in settings, stored per device.

`deposition` and `incrustation` are far apart in hue on purpose. They are
adjacent in the list and look alike on camera, and near-identical colours there
would turn a misread into a confident one.

## Installing it on the robot

Two steps. The first is manual and happens once per trained model; the second is
the normal deploy.

**1. Export the checkpoint to ONNX — on a laptop, not the Pi.** This needs
PyTorch and the `rfdetr` package, several gigabytes of it, none of which is
needed to *run* the model.

```bash
python3 -m venv /tmp/export
/tmp/export/bin/pip install rfdetr onnx onnxruntime
/tmp/export/bin/python server/deploy/export-model.py ~/Downloads/checkpoint_best_total.pth
```

That writes `server/model/pipe-defects.onnx`. Deliberately not `server/data/`,
which `deploy.sh` excludes because it is where the robot keeps its own runs.

**2. Deploy as usual.**

```bash
./deploy.sh
```

`server/` is already in the rsync list so the model goes over with everything
else, and `onnxruntime` is in `requirements.txt` so the Pi installs it during
the venv step. Nothing extra to do. The deploy prints the model's size before
copying, and on the robot prints either `ready — pipe-defects.onnx at 560px` or
`NOT LOADED — <reason>`, so a missing model is something you find out during the
deploy rather than forty metres into a pipe.

The `.pth` file is never used on the robot. It is export input only.

### Checking it, and timing it

```bash
.venv/bin/python deploy/try-model.py some-pipe.jpg --save /tmp/boxed.jpg
```

Reports what it found and the median inference time. Run it on the Pi: every
decision about how the console behaves follows from that one number, and it can
only be measured on the machine that will run it. `--save` draws the boxes on
the image, which is the fastest way to spot transposed coordinates.

If it is too slow, the two levers are int8 quantisation (typically 2–3× on ARM,
some accuracy cost) and a smaller export resolution — cost is quadratic, so 392
is roughly half of 560.

## Serving it

`perception/rfdetr.py` runs the exported graph under onnxruntime, which has
wheels for both aarch64 Linux and macOS — the Pi runs the same file a laptop
tested. `best_detector()` picks it when it loads and falls back to a
`NullDetector` carrying the reason when it does not, so a robot with no model
still starts, drives and records.

Inference takes seconds per frame on a Pi. That is why the detector runs off the
video path entirely — the stream never waits on it — and why every detection is
stamped with the moment it was made rather than being drawn as if it described
the current frame.

It is an **image** model with no memory between frames, so the same crack in
three consecutive frames is three independent guesses and boxes may flicker.
That is inherent to running a still-image detector over video.

## Accuracy

Not recorded. The checkpoint stores weights, optimiser and training arguments
and no evaluation metrics, so there is no mAP or per-class AP to quote here.
The training arguments have `run_test` and `log_per_class_metrics` set, so
whoever trained it can produce both from the test split. Worth asking for:
`deposition` and `incrustation` are the pair most likely to be confused, and
per-class AP is the only thing that would say how badly.
