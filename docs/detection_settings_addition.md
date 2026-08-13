
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
