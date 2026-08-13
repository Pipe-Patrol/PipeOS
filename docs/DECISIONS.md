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
| `estimated` | Derived and drifting | `EST` badge; uncertainty recorded and in the JSON export, not shown beside the number |
| `unavailable` | No sensor exists | Struck-through blank, never a number |

A fabricated battery percentage would be trusted by a crew standing over an open
manhole. That is the failure this rule exists to prevent.

## Distance, and why it is estimated

There are no wheel encoders, so distance is inferred from three weak sources
that fail differently, blended in `estimation/odometry.py`:

1. **Inertial integration.** IMU acceleration integrated once into a velocity.
   The only source that knows about motion the wheels did not cause — being
   dragged, sliding back down a fall — and the first to react to a real start or
   stop. Drifts, because integrating a noisy number accumulates its noise.
2. **Commanded-duty integration.** Duty × top speed × time. Wrong whenever the
   wheels slip or the load changes, but the error grows linearly and is bounded.
   It is what bounds source 1: the motors are the only thing that can push this
   chassis, so they cap how fast it can possibly be going.
3. **Visual odometry.** Sparse optical flow between camera frames
   (`estimation/flow.py`). Scale-ambiguous on its own, so it is calibrated
   against source 2 while the robot is confidently rolling, then trusted to
   correct the integrator when they disagree — which is exactly the slip case.

With no accelerometer fitted it falls back to 2 and 3 alone.

### The deadband is what makes integration survivable

`hardware/imu.py` reports acceleration inside ±0.1 m/s² as **exactly zero**, and
everything downstream reads that as "no acceleration", not "no movement". The
distinction is the whole design:

| State | Acceleration | What happens |
|---|---|---|
| Accelerating | outside the band | velocity climbs |
| Steady crawl | reads 0 | velocity is **held** — distance keeps accumulating |
| Stopped | reads 0, and nothing commanded | velocity forced to 0 |

Reading the deadband as "not moving" would be catastrophic in the ordinary case:
steady speed *is* zero acceleration, so a robot crawling forty metres at a
constant 20 cm/s would log almost none of it. Leaving the noise in is the
opposite failure — a parked robot integrates jitter into a phantom velocity and
quietly logs metres it never travelled over a lunch break.

Uncertainty still grows monotonically and is still recorded against every
distance and every defect chainage, and it is still in the JSON export. It is no
longer shown beside the number on screen, nor given a column in the defect CSV:
the `estimated` badge already says the number is derived, and a margin on every
reading was being read as precision rather than as doubt. The CSV is the sheet an
inspector fills a report out of, and that column was never one of the ones they
filled in.

## Stall detection without a current sensor **[chosen]**

`drive.py` says outright that real stall detection needs current or rotation.
Neither is wired, so `estimation/obstacle.py` infers it: motors commanded above
`MIN_DUTY`, IMU acceleration flat, and optical flow near zero, all together, for
longer than a debounce window. That is a jammed robot.

It is a heuristic and is labelled one. It does not cut the motors on its own —
it raises an alert, because a false positive that stops the robot mid-pipe is
its own kind of failure. Wiring an INA260 would replace this with a measurement.

## The motors only turn during a run **[chosen]**

`hardware/drive.py` holds an `armed` flag. `Robot.start_run` sets it, `end_run`
clears it, and `command()` refuses everything — quietly, returning zero duties —
while it is false. The console reads `drive.armed` out of telemetry and locks
its own input to match, but that is the courtesy copy; this one holds when the
browser or the socket is what broke, like every other protection in that file.

This reverses the original design, which allowed driving with no run open so an
operator could check the camera. The cost of that was an inspection driven in
full and saved nowhere, discovered at the far end of a pipe. A locked keyboard
at the near end is the cheaper failure.

## The map is anchored by hand **[chosen]**

There is no GPS on the robot and there would be no signal for one down a pipe,
so the operator places the run's entry point on a Leaflet map before starting —
by clicking, from the browser's own location, or by typing coordinates off a
site plan. They also give the bearing the robot faces going in, because the IMU
runs on the game rotation vector with no magnetometer and its yaw is relative to
power-on: nothing on the robot knows where north is.

Both live on the run as its `origin`, and `components/map/geo.ts` projects the
odometer's local x/y into lat/lon through them. Runs without an origin are still
valid; their track is drawn in its own frame with no map behind it.

Setting the bearing per run gets old, so Settings has a **north reference**:
point the chassis at a known direction, say what it is, and `IMU.set_north()`
anchors every later yaw to the compass. New runs then take their entry bearing
from the robot's own heading and the operator does not have to think about it.

The reference is deliberately not persisted. Game rotation vector yaw counts
from sensor power-on, and the IMU reconnects on its own after a wedged I2C bus —
a datum from before that restart is meaningless, so it is reported `stale` and
the heading goes back to null. A compass wrong by an unknown amount is worse
than no compass.

Tiles come from OpenStreetMap over the internet, which a van at the side of a
road may not have. Every map reports that and stays usable without them —
clicking, coordinates and the drawn track do not need tiles. Leaflet itself is
bundled from npm, not a CDN, for the same reason the fonts are.

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

## The model runs on a laptop, not on the robot **[chosen]**

Supersedes the decoupling rationale in *Detection is stubbed, not wired*, which
assumed inference would happen on the Pi.

RF-DETR on a Pi 5 is seconds per frame with three of four cores saturated, and
the board runs hot enough doing it that a long inspection becomes a thermal
problem before it is an accuracy one — for a graph and a runtime that together
cost most of a gigabyte of SD card. So the robot posts the JPEG it already
encoded for the video stream to a laptop and gets boxes back. Its share of the
work is one HTTP POST of a frame it was going to encode anyway.

Rejected: **in-browser inference** (onnxruntime-web), which needs a ~120 MB
download per session and strands detections in the tab, where the run records,
map flags and exports cannot see them. Rejected: **the console brokering
frames**, for the same reason — detection has to reach the Pi's run store to be
part of an inspection, not just part of a screen.

The swap happens entirely behind the existing detector interface, so the run
recorder, the map and the console are unchanged. The cost is a real operational
dependency: the laptop must be awake and on the same network, and its address is
a DHCP guess. That is paid for with a settings field that retargets a running
robot, and a deploy that checks reachability *from the Pi* rather than from the
laptop, which can obviously reach itself.

Detection being off is a state the robot already handles — it drives, records
and logs defects by hand exactly as it did with no model installed.

## Detections replace rather than accumulate **[chosen]**

Each inference's findings replace the previous set outright, including when the
model finds nothing. The overlay draws them solid.

They used to accumulate and fade out individually over six seconds, which was
right when inference was seconds per frame and boxes trickled in one stale
rectangle at a time. Off the Pi, results arrive fast enough that the only thing
fading produced was several overlapping generations of boxes for the same crack.

The six seconds survives as a staleness guard, not a display duration: if
results stop arriving at all, the last set is dropped as a unit. A frame's
findings are a whole answer — the model judges each image alone — so half of one
is not a smaller truth, it is a different one.
