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

## Serving it

The console renders detections, fades them by age and files them against
chainage already; the server-side seam is `NullDetector` in
`server/pipepatrol/perception/detector.py`. Landing the model means replacing
that one class with an RF-DETR backend exposing the same
`infer(jpeg) -> list[Detection]`.

Inference is expected to take seconds per frame on a Pi. That is why the detector
runs off the video path entirely — the stream never waits on it — and why every
detection is stamped with the moment it was made rather than being drawn as if it
described the current frame.
