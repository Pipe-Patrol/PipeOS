# Detection settings: what to change when the model lands

The Configuration section of the run setup panel already has the full set of
detection controls. **None of them are wired to anything.** They edit a draft
object that lives in the console and is thrown away when the panel closes.

This file is the checklist for making them real. It exists because the controls
went in first on purpose: the shape of the decision is easier to settle before a
model is forcing one, and an operator should see the same panel the day it
starts working as the day before.

## Where it is now

| Thing | File |
| --- | --- |
| The controls | `web/src/components/live/runsetup/DetectionSettings.tsx` |
| The draft type and defaults | same file, `DetectionDraft` / `DEFAULT_DETECTION` |
| Where it is held | `web/src/components/live/runsetup/RunSetupPanel.tsx` |
| The class list it draws from | `web/src/constants/defects.ts` |
| The detector it will drive | `server/pipepatrol/perception/detector.py` |

The draft:

```ts
interface DetectionDraft {
  enabled: boolean
  mode: 'manual' | 'assisted'
  sampleEveryNFrames: number   // 1 = every frame
  minConfidence: number        // 0..1
  classes: string[]            // defect codes the model may raise
}
```

## What has to change

1. **Send it.** `RunSetupPanel` drops the draft on submit; `RunDraft` carries
   name, record and origin only. Add `detection` to `RunDraft`, to the
   `POST /api/runs` body in `LiveRoute.startRun`, and to the request model in
   `server/pipepatrol/api/runs.py`.

2. **Store it on the run.** Add the settings to `runs/models.py` so an export
   says what the model was told to look for. A run whose detections cannot be
   explained by its own settings is a run nobody can defend in a report.

3. **Apply it in the detector.** `sampleEveryNFrames` and `minConfidence` belong
   in `perception/detector.py`. `classes` filters the label set. `enabled: false`
   must stop inference rather than hide its output, or the CPU cost is paid for
   nothing.

4. **Make `mode` mean something.** `manual` draws boxes and files nothing.
   `assisted` files a defect per detection above the threshold, against the
   chainage at the moment it was seen. That second path does not exist yet.
   Whatever it writes must be distinguishable from an operator's own defect in
   `runs/models.py` — `Defect.detection_id` is already the hook for this.

5. **Replace the class list.** `constants/defects.ts` is a provisional plain
   language set, not a standards code set. When the model ships with its own
   labels, they replace it. Codes recorded before then have to stay readable.

6. **Report what actually ran.** `telemetry.perception` reports the backend and
   latency. Once these settings are live it should also report what is in force,
   so the preflight ML row can say "off by choice" rather than "not detected".

## Until then

The preflight ML row reads `telemetry.perception.available` and the flow
estimator, and warns rather than blocks. That stays correct either way: a run
with no model is a worse run, not an unsafe one.

---

## What landed since this was written

A backend now exists: `perception/model.py`, with `RFDetrDetector` (model in
process), `RemoteDetector` (frame posted to another machine), and an anomaly
bank that emits `UNKNOWN` when a frame looks unlike healthy pipe. `robot.py`
asks `build_detector()` for one instead of taking the default.

Which backend runs is chosen by environment, since it is a property of the
machine rather than of a run:

| Variable | Effect |
| --- | --- |
| `PIPEPATROL_WEIGHTS` | path to a checkpoint, selects the local backend |
| `PIPEPATROL_ANOMALY_BANK` | path to a `.npz` bank, enables `UNKNOWN` |
| `PIPEPATROL_INFERENCE_URL` | posts frames elsewhere, wins over the above |

Set none and `build_detector()` returns `NullDetector`, so the console behaves
exactly as it did before.

Everything in the draft stays the draft's. `CONF_THRESHOLD` in `model.py` is a
plain constant and deliberately not configurable from the environment, because
`minConfidence` is where it belongs and two configuration surfaces would mean
an export could not say what the model was told. Item 3 replaces it.

### Still open against this checklist

**`sampleEveryNFrames` is not implemented.** `MIN_INFERENCE_INTERVAL_S` in
`detector.py` remains the only rate limit and it is a floor, not a choice.

**`UNKNOWN` has to be exempt from the `classes` filter.** The anomaly bank has
no vocabulary: it reports that something is unlike healthy pipe and cannot say
what it is, which is the point, since it covers what the classifier has no
class for. Those arrive as `label: "UNKNOWN"` with no box and the abnormality
score in place of a confidence. Filtering by class is meaningless for something
that has none.

### Item 5, resolved the other way round

This file expects the model's own labels to replace `defects.ts`. They do not.
`LABELS` in `model.py` maps the model's seven classes onto the codes already
there, one for one:

```
crack CR   deposition DE   incrustation EN   joint offset JD
obstruction OB   root intrusion RO   utility intrusion UT
```

The reason is the last line of item 5: codes recorded before the model shipped
have to stay readable. Mapping into the existing set keeps every run
comparable and puts the translation in one dict, so changing what an operator
sees is a one-line edit and nothing else depends on the model's naming.

`UT` was added to `defects.ts` for this. It is grouped Structural rather than
Service because the defining fact is that something pierced the wall, not that
the bore is narrower, and that is the part that matters when someone puts a
cutter down the line.

### What consumes all this

`reasoning.py` reads the pass and looks for combinations that mean something no
single detection does. It needs the whole run, so `DetectionService` keeps an
unpruned log beside the six-second overlay list, and
`GET /api/reasoning/findings` runs the rules over it once the pass ends.

That is adjacent to item 4 but not the same thing. `assisted` files a `Defect`
per detection, which is a record of what was seen. The observation log is input
to a claim about what it means, and the two should not be conflated: one is an
observation the operator owns, the other is an inference the system is making.
