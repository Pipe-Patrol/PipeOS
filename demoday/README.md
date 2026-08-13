# Demo day

On demo day the robot sits on a table. There is no sewer in the room, so the
camera sees a ceiling: the model finds nothing, the optical flow has nothing to
track, and the distance never moves. Every interesting thing about this console
becomes impossible to show, on the one day it has to be shown.

This folder fixes that by feeding the camera recorded pipe footage.

**Delete this folder and the feature is gone.** Nothing in `server/` or `web/`
imports it. The server looks for `demoday/router.py` at startup and mounts it if
it is there (`_mount_demoday` in `server/pipepatrol/app.py`); if it is not, the
robot comes up as a product with no demo mode in it.

## Using it

1. Open the console and connect to the robot.
2. Press **D** twice. A second window opens — this is the operator's window.
3. Load a clip or some stills into it, and pick one.
4. Drive from the console as normal.

The panel is on the operator's screen. The console in the other window is not
modified in any way, which is the point: a judge can be handed the keyboard and
there is nothing on that screen to notice.

`←` and `→` in the panel switch footage. **Pace** says how many seconds of
footage make up a metre of pipe — it is the one number that decides whether the
distance on screen looks right for the speed the robot is moving.

## Two environments, two transports

The panel works in both, and picks automatically by asking on a BroadcastChannel
whether a simulator is listening:

| where | frames go to | who runs the model |
| ----- | ------------ | ------------------ |
| dev console on :5173 after T,T | the simulator in the console window | this Mac, via `/api/detect` on the local server |
| deployed robot | `/api/demoday/frame` → the camera buffer | the Pi |

Same panel, same footage, same model. Only the compute moves.

The test-mode half lives in `temptest/demo-bridge.ts`; delete `temptest/` and
demo day still works against a real robot, delete `demoday/` and the simulator
still works. Neither needs the other.

## IT IS NOT A FAKE

Nothing here invents a detection or a distance.

The panel posts JPEGs to `/api/demoday/frame`, which writes them into the same
buffer the camera driver writes into. Everything downstream reads them without
knowing where they came from — and none of it is special-cased:

| what                     | reads the supplied frame                        |
| ------------------------ | ----------------------------------------------- |
| the defect model         | genuinely runs, genuinely finds what it finds    |
| optical flow → odometry  | the distance is measured off these frames        |
| snapshots, run recording | the run's evidence is the footage that was shown |
| `/api/camera`            | so the console just shows its normal live view   |

The distance is worth spelling out. `server/pipepatrol/estimation/odometry.py`
is purely visual — no wheels, no IMU. So the chainage on the console is measured
off the pictures the panel supplied, by the same estimator that would measure a
real pipe. The panel plays the clip at a rate set by the throttle the operator
is commanding, so the causal chain is the real one:

    drive  →  the picture moves  →  optical flow  →  distance climbs

Stop, and the picture holds still and the distance stops. Reverse, and it runs
back. Nobody scripted any of that, and no number on screen came from anywhere
but the robot.

The only substitution in the whole feature is where the pictures come from.

## Handing the camera back

The takeover is not latched. `hardware/camera.py` gives the sensor its output
back `SUPPLIED_TIMEOUT_S` (2 s) after the last supplied frame, so closing the
panel, a dead laptop or a dropped network all end with a live camera rather than
a feed frozen on somebody's last frame. There is no state to reset and no mode
to get stuck in.

## What it will not do

It will not start a run without hardware. Preflight tests the motors and the
camera for real, and this folder does not touch preflight. If the camera is not
running, `/api/demoday/frame` returns 503 rather than inventing a stream to take
over — a run recorded against a camera that was not there would be the one
dishonest thing in the feature.
