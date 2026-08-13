# The defect model

## Two of them, and a button

There are two trained things that can look at a frame, and the console picks
between them in **Settings → Detection host → Model**:

| id | what it is | needs |
| -- | ---------- | ----- |
| `rfdetr-onnx` | The exported graph. Seven classes, quick, no torch. **The one that has been down a pipe.** | `onnxruntime`, `server/model/*.onnx` |
| `rfdetr-torch` | The same checkpoint under torch, plus an optional clean-pipe memory bank that raises `UNKNOWN` for conditions outside the seven. **Not yet QC'd.** | `rfdetr`, `torch`, `PIPEPATROL_WEIGHTS` |

They are not interchangeable enough to choose automatically — which is right
depends on what the run is for — so an operator chooses. The catalogue lives in
`perception/catalogue.py`; the button switches the **detection host**, not the
robot, because the robot holds no model at all.

A model that is not installed is shown greyed with the reason rather than
hidden: a checkpoint somebody forgot to copy should not look like a model that
does not exist. Switching to one that will not load is refused and the running
model is kept, so a survey never loses detection to a mis-click.

### The anomaly bank

`rfdetr-torch` can carry a PatchCore memory bank of clean-pipe patches
(`PIPEPATROL_ANOMALY_BANK`, an `.npz`). It scores how far a frame sits from
healthy pipe and raises a single `UNKNOWN` detection when nothing in the bank
resembles it — and only when the classifier found nothing, since a defect that
already has a name does not also need flagging as unnameable. It has no
vocabulary: it says *something is wrong here*, never what. That is the point,
because the classifier knows seven conditions and a pipe contains more.

The console has no class for `UNKNOWN`, so it draws in the neutral fallback
colour. That is correct and deliberate — an unnamed finding should not borrow a
named one's colour.

## The classifier

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

## Where it runs: not on the robot

**The Pi does no inference.** RF-DETR on a Pi 5 is seconds per frame with three
of its four cores saturated, and the board gets hot enough doing it that a long
inspection is a thermal problem before it is an accuracy one — for a graph and a
runtime that between them cost most of a gigabyte of SD card.

So the model runs on a laptop. The robot posts the JPEG it already encoded for
the video stream to that laptop, and the laptop answers with boxes. The Pi's
share of the work is one HTTP POST of a frame it was going to encode anyway.

The deploy enforces this rather than trusting it. Every `./deploy.sh`:

- excludes `server/model` from the copy — no graph crosses;
- **deletes** `server/model` on the Pi if an older deploy left one there
  (`rsync --delete` does not remove excluded paths, so this is explicit);
- **uninstalls** `onnxruntime` from the Pi's venv (dropping a line from
  `requirements.txt` never uninstalls anything);
- sets `PIPEPATROL_LOCAL_MODEL=0` in the systemd unit, so a graph that
  reappears — restored from a backup, copied by hand — still cannot put the Pi
  back to work.

### Setting it up

**1. Export the checkpoint to ONNX.** Once per trained model. Needs PyTorch and
`rfdetr`, several gigabytes of it, none of which is needed to *run* the model.

```bash
python3 -m venv /tmp/export
/tmp/export/bin/pip install rfdetr onnx onnxruntime
/tmp/export/bin/python server/deploy/export-model.py ~/Downloads/checkpoint_best_total.pth
```

That writes `server/model/pipe-defects.onnx`, which stays on your machine. The
`.pth` file is never used at inference; it is export input only.

**2. Install what serves it, on your machine only.**

```bash
cd server
.venv/bin/pip install -r requirements-detect.txt
```

**3. Run the detection host.**

```bash
.venv/bin/python detect-host.py
```

It serves `POST /api/detect` and `GET /api/health` on port 8600 — 8600 rather
than 8000 so it coexists with the Vite dev server and with a full local server
on demo day. On startup it prints the addresses to point the robot at.

**4. Deploy.**

```bash
./deploy.sh
```

The deploy works out this machine's address on the interface that actually
routes to the Pi — not the first one `ifconfig` lists, which on a laptop with
Docker or a VPN is a different and unreachable answer — and writes it into the
robot's service. Then, **from the Pi**, it fetches `/api/health` on that address
and prints either `ready — http://10.0.0.4:8600 serving pipe-defects-lite.onnx
at 384px` or the reason it could not. Checking from the robot rather than from
the laptop is the point: the laptop can obviously reach itself.

### Changing the address later

A DHCP lease is a guess. **Settings → Detection host** on the console sets it on
a running robot, persisted to `server/data/detector-host.txt` so it survives a
power-cycle, and it outranks whatever the deploy baked in. Clear the field to
fall back to the deployed address; empty means detection is simply off.

That field is also where the failure shows up. `cannot reach 10.0.0.4:8600`
tells an operator their laptop is asleep or on the wrong network — a bare
"detection unavailable" would send them looking at the robot.

### Checking it, and timing it

```bash
.venv/bin/python deploy/try-model.py some-pipe.jpg --save /tmp/boxed.jpg
```

Reports what it found and the median inference time. `--save` draws the boxes on
the image, which is the fastest way to spot transposed coordinates. Run it on
whatever machine serves the model — that is now the machine whose speed decides
anything.

## Serving it

Two backends behind one interface (`name`, `available`, `infer(jpeg)`), so
`DetectionService`, the run recorder, the map flags and the console cannot tell
which is behind them:

- `perception/rfdetr.py` runs the exported graph under onnxruntime. This is what
  `detect-host.py` and a laptop dev server use.
- `perception/remote.py` posts frames to a detection host. This is what the
  robot uses, and on the robot it is the only one that can ever be selected.

`best_detector()` picks remote when a host is configured. Without one it falls
back to a `NullDetector` carrying the reason, so a robot that cannot reach its
laptop still starts, drives and records — it just detects nothing.

**A configured host counts as available even while it is unreachable.** The
sampling loop only runs for an available backend, so treating a sleeping laptop
as unavailable would latch detection off for the rest of the run; instead the
loop keeps trying and detections resume on their own when the laptop wakes.

Inference is still off the video path entirely — the stream never waits on it —
because that was always the right shape, not merely a workaround for a slow Pi.

### One frame at a time

Each inference **replaces** the previous one, including when it finds nothing.
Detections used to accumulate and fade out individually over six seconds, which
made sense when inference was seconds per frame and boxes trickled in one at a
time. With the model on a laptop the results arrive fast enough that the only
thing fading produced was several overlapping generations of boxes for the same
crack. So `DetectionService` keeps the last result, whole, and the console draws
it solid.

The six-second timer survives as a staleness guard rather than a fade: if
results stop arriving at all — the host went away, the model threw — the last
frame's boxes are dropped as a unit rather than sitting on the glass describing
a stretch of pipe the robot left long ago. An empty overlay now means the model
sees nothing, not that a box expired.

It is still an **image** model with no memory between frames, so the same crack
in consecutive frames is independent guesses and boxes may shift. That is
inherent to running a still-image detector over video.

## Accuracy

Not recorded. The checkpoint stores weights, optimiser and training arguments
and no evaluation metrics, so there is no mAP or per-class AP to quote here.
The training arguments have `run_test` and `log_per_class_metrics` set, so
whoever trained it can produce both from the test split. Worth asking for:
`deposition` and `incrustation` are the pair most likely to be confused, and
per-class AP is the only thing that would say how badly.
