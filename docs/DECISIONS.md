# Decisions

Why this repo looks the way it does. Sections marked **[chosen]** were not
specified — they were decided here and are open to being overruled.

---

## Where PipeOS came from

Two repos merged:

- **PipePatrolTesting** — the real one. FastAPI server, hardware drivers, and a
  single-file GUI that actually drives the robot. The backend here is its
  descendant, reorganised into a package but with the safety logic unchanged.
- **PipePatrolApp** — a React operator console with no backend at all
  (`REAL_CLIENT_IMPLEMENTED = false`). Its component quality, type discipline,
  and layout ideas were worth keeping. Its telemetry was invented by a mock
  provider, and none of that survived the merge.

The rule applied throughout: **PipePatrolApp contributed structure, never data.**
Any screen of its that could not be backed by something the robot actually
reports was either rebuilt against real telemetry or deleted.

## The honesty rule

Three tiers, enforced in `server/pipepatrol/telemetry.py` and rendered
differently in the console:

| Tier | Meaning | Console treatment |
|---|---|---|
| `measured` | Came off a sensor | Plain value |
| `estimated` | Derived and drifting | `EST` badge, uncertainty shown |
| `unavailable` | No sensor exists | Struck-through blank, never a number |

A fabricated battery percentage would be trusted by a crew standing over an open
manhole. That is the failure this rule exists to prevent.

## Distance, and why it is estimated

There are no wheel encoders, so distance is inferred from two weak sources that
fail differently, blended in `estimation/odometry.py`:

1. **Commanded-duty integration.** Duty × top speed × time. Wrong whenever the
   wheels slip or the load changes, but the error grows linearly and is bounded.
2. **Visual odometry.** Sparse optical flow between camera frames
   (`estimation/flow.py`). Scale-ambiguous on its own, so it is calibrated
   against source 1 while the robot is confidently rolling, then trusted to
   correct it when the two disagree — which is exactly the slip case.

Deliberately **not** used: double-integrating IMU acceleration. Error grows with
the square of time; over a five-minute run the number is meaningless. The IMU's
acceleration is used only to answer "is it actually moving", which is a
comparison, not an integral.

Uncertainty grows monotonically and is reported alongside the distance. It never
recovers, because nothing underground can re-fix it.

## Stall detection without a current sensor **[chosen]**

`drive.py` says outright that real stall detection needs current or rotation.
Neither is wired, so `estimation/obstacle.py` infers it: motors commanded above
`MIN_DUTY`, IMU acceleration flat, and optical flow near zero, all together, for
longer than a debounce window. That is a jammed robot.

It is a heuristic and is labelled one. It does not cut the motors on its own —
it raises an alert, because a false positive that stops the robot mid-pipe is
its own kind of failure. Wiring an INA260 would replace this with a measurement.

## What was cut for v1 **[chosen]**

- **Profile strip, drift cone, map pins.** The profile strip is the canonical
  sewer-inspection view and it is keyed on trustworthy chainage. Estimated
  distance is not that yet. The path map survives because a rough track with a
  heading cone is still useful and reads as approximate.
- **PDF and PACP/MSCC reports.** Export is JSON, CSV, and a frame zip. A
  standards-compliant report wants defect coding that only lands with the model.
- **Accounts, orgs, billing, fleet view.** One team, one robot. The run store is
  content-addressed and sync-shaped so cloud history can be added without a
  migration, but none of it is built.
- **Aggregate dashboard.** Superseded by the run list, which carries the same
  numbers without a second screen to keep truthful.

## Runs live on the Pi, not in the browser **[chosen]**

PipePatrolApp kept runs in IndexedDB. That breaks the moment a second device
opens the console — and an iPad is an explicit target. The robot owns the
recording; the console is a view onto it.

## Detection is stubbed, not wired **[chosen]**

The model is coming later and will not be PipePatrolML. `perception/detector.py`
defines the interface and ships a no-op backend. The console renders detections,
confidence filtering, and alerts today against that interface, so landing a real
model is one class, not a UI project.

Inference is expected to be slow on the Pi. The camera stream and the detection
cadence are decoupled: video stays at full rate, detections arrive whenever they
arrive, and the overlay ages them out rather than pretending they are current.

## Simulation **[chosen]**

Development without a Pi runs against a simulator, behind a banner that cannot
be dismissed. It never invents `unavailable` readings — a simulated battery is
still blank, because a demo that shows a battery the robot cannot report would
teach the wrong thing about the product.
