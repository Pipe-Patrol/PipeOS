# What each preflight row actually proves

Two layers. `web/src/components/live/runsetup/checks.ts` reads what each
subsystem says about itself. `server/pipepatrol/preflight.py` makes it do the
thing. Where they disagree, the probe wins.

| Row | Probe | What a tick means |
| --- | --- | --- |
| Storage | 64 KB written, fsynced, read back, deleted | The card accepts writes. Catches read-only and full cards that still report free bytes |
| Camera | Frame counter sampled twice | Frames are arriving now, not "the device opened at boot" |
| Lights | LED on, camera measures brightness, LED restored | Light actually came out. Falls back to GPIO read-back with no camera |
| IMU | `reading_age_s` after a wait | Fresh samples, not a stale cache from a wedged I2C bus |
| Motors | Pivot on the spot, IMU checks the yaw | The drivetrain turned. Operator-triggered only |
| Robot link, battery, accelerometer, north, ML model, CPU temp, air temp | none | Live telemetry reads. There is nothing to exercise |

`confirmed` is true only when something outside the software observed the
result. The section footer counts them: "All checks passed, 4 confirmed by test".

## The motor test moves the robot

`Drive.self_test` owns the limits, next to every other motor protection:
opposed directions so it pivots rather than travels, `MIN_DUTY`, 0.35 s,
the lock held for the whole pulse, and a `finally` that stops the motors on
every exit path. It is the only path that moves a motor with no run open.

It is never in the automatic sweep. A robot that twitches while someone has
their hands on it is a hazard, so it sits behind the `Test` button on its row
and is refused while a run is open.

## What still cannot be tested

- **Battery** — no sensor yet. The threshold logic is live and fires the day one
  is fitted.
- **Accelerometer** — the IMU probe covers freshness; there is no way to verify
  the accelerometer channel is calibrated without a known reference.
- **A motor with no IMU** — the pulse runs, the result comes back unconfirmed.
  Nothing else on the robot can see the wheels turn.
