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
