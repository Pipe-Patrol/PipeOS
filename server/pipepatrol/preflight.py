"""Preflight probes that actually exercise the hardware.

The telemetry envelope answers "what does each subsystem SAY about itself".
That is not the same question as "does it work", and the gap between them is
where a robot gets stranded forty metres in:

    a full SD card reports free bytes right up until the write fails
    a camera that opened at boot and died since still reports available
    an LED ring with a broken lead has a perfectly healthy GPIO behind it
    a motor with a stripped gearbox has a perfectly healthy PWM pin behind it

So each probe here DOES the thing and reports what happened. Where a probe
cannot prove the physical outcome it says so rather than passing quietly, and
`confirmed` marks the difference: True means something outside the software
observed the result -- a frame counter that moved, a picture that got brighter,
an IMU that felt the chassis turn.

Nothing here raises. A probe that fails returns a reason; a probe that cannot
run returns `ran: False`. A preflight check that can crash the server is a
worse preflight check than none.
"""

import logging
import os
import time

from pipepatrol import config

log = logging.getLogger(__name__)

# --- storage ---
PROBE_FILENAME = ".preflight-probe"
PROBE_BYTES = 64 * 1024

# --- camera ---
CAMERA_WAIT_S = 1.5
CAMERA_POLL_S = 0.05

# --- lights ---
LIGHT_SETTLE_S = 0.35
# Mean luminance (0..255) the frame must gain with the lights on. Low on
# purpose: the camera's own auto-exposure fights this, and a probe that fails a
# working light because the sensor compensated well is worse than one that
# admits it could not tell.
LIGHT_MIN_DELTA = 1.5

# --- imu ---
IMU_WAIT_S = 0.4
# The reading must be no older than this once the probe has waited.
IMU_MAX_AGE_S = 1.5

# --- motors ---
# Degrees of yaw the pivot must produce. The IMU resolves far finer than this;
# the margin is for a robot sitting on grit that does not turn cleanly.
MOTOR_MIN_YAW_DEG = 1.5


def _result(ran, ok, reason="", confirmed=False, **evidence):
    return {
        "ran": ran,
        "ok": ok,
        "reason": reason,
        # True only when something outside this process observed the outcome.
        "confirmed": confirmed,
        "evidence": evidence,
    }


def run(robot, include_motors=False):
    """Every probe, in order. Returns one dict per probe id."""
    probes = {
        "storage": storage_probe(),
        "camera": camera_probe(robot),
        "imu": imu_probe(robot),
    }
    # After the camera, which it uses to see whether the light actually landed.
    probes["lights"] = lights_probe(robot, camera_live=probes["camera"]["ok"])

    if include_motors:
        probes["motors"] = motor_probe(robot)

    return {"at": round(time.time(), 3), "probes": probes}


def storage_probe():
    """Write, flush to the card, read back, delete.

    Free bytes are a claim; this is the answer. A card mounted read-only after a
    bad unmount, one that is physically full, or one that has started failing
    all report space and then refuse the write -- and the first the operator
    would otherwise know is a run with no snapshots in it.
    """
    path = None
    try:
        directory = config.ensure_data_dir()
        path = directory / PROBE_FILENAME
        payload = os.urandom(PROBE_BYTES)

        with open(path, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())

        with open(path, "rb") as handle:
            read_back = handle.read()

        if read_back != payload:
            return _result(
                True,
                False,
                "what was read back did not match what was written",
                bytes_written=len(payload),
            )

        return _result(True, True, confirmed=True, bytes_written=len(payload))
    except OSError as exc:
        return _result(True, False, f"{type(exc).__name__}: {exc}")
    finally:
        if path is not None:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


def camera_probe(robot):
    """Wait for the frame counter to move.

    `available` says the device opened at some point. This says frames are
    arriving now, which is the failure that matters: a CSI ribbon that works
    cold and drops out warm passes the first test every time.
    """
    camera = robot.camera
    if not camera.status().get("available"):
        return _result(False, False, "no camera")

    start = camera.frame_sequence()
    if start is None:
        return _result(True, False, "the camera is not streaming")

    deadline = time.monotonic() + CAMERA_WAIT_S
    while time.monotonic() < deadline:
        time.sleep(CAMERA_POLL_S)
        current = camera.frame_sequence()
        if current is not None and current > start:
            frame = camera.latest_jpeg()
            if not frame:
                return _result(True, False, "frames counted but none could be read")
            return _result(
                True,
                True,
                confirmed=True,
                frames=current - start,
                frame_bytes=len(frame),
            )

    return _result(True, False, f"no new frame in {CAMERA_WAIT_S:.1f}s")


def lights_probe(robot, camera_live=False):
    """Turn the light on and look at the picture.

    Writing to the GPIO and reading it back only proves the pin took the value,
    which a ring with a broken lead does perfectly. Pointing the camera at the
    result is the only way to find out whether any light came out, so that is
    what this does when there is a camera to do it with.

    Auto-exposure works against this, so an inconclusive brightness reading is
    reported as unconfirmed rather than as a failure. The lights are advisory in
    the panel; failing one because the sensor compensated would be a lie in the
    more expensive direction.
    """
    lights = robot.lights
    if not lights.status().get("available"):
        return _result(False, False, "no light array")

    before = lights.status().get("duty", 0.0)
    try:
        lights.set_level(1.0)
        applied = lights.status().get("duty", 0.0)
        if applied <= 0:
            return _result(True, False, "the LED channel did not take the value")

        if not camera_live:
            return _result(
                True,
                True,
                "no camera to confirm the light landed",
                confirmed=False,
                duty=applied,
            )

        lit = _mean_luminance(robot)
        lights.set_level(0.0)
        time.sleep(LIGHT_SETTLE_S)
        dark = _mean_luminance(robot)

        if lit is None or dark is None:
            return _result(
                True, True, "the camera could not be read to confirm it", duty=applied
            )

        delta = lit - dark
        if delta >= LIGHT_MIN_DELTA:
            return _result(True, True, confirmed=True, luminance_delta=round(delta, 2))

        return _result(
            True,
            True,
            "the camera saw no brightness change, which auto-exposure can hide",
            confirmed=False,
            luminance_delta=round(delta, 2),
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("lights probe failed: %s", exc)
        return _result(True, False, f"{type(exc).__name__}: {exc}")
    finally:
        try:
            lights.set_brightness(before)
        except Exception:  # noqa: BLE001
            pass


def _mean_luminance(robot):
    """Mean grey level of the current frame, 0..255, or None."""
    time.sleep(LIGHT_SETTLE_S)
    frame = robot.camera.latest_jpeg()
    if not frame:
        return None
    try:
        import cv2
        import numpy as np

        buffer = np.frombuffer(frame, dtype=np.uint8)
        image = cv2.imdecode(buffer, cv2.IMREAD_GRAYSCALE)
        if image is None:
            return None
        return float(image.mean())
    except Exception as exc:  # noqa: BLE001
        log.debug("could not measure frame brightness: %s", exc)
        return None


def imu_probe(robot):
    """Confirm the sensor is producing fresh samples, not a stale cache.

    The IMU polls on its own thread and keeps the last good values, so
    `status()` returns numbers long after an I2C bus has wedged. `reading_age_s`
    is what tells those two apart, and it is the reading the distance estimate
    depends on.
    """
    status = robot.imu.status()
    if status.get("state") == "absent":
        return _result(False, False, "no IMU")

    time.sleep(IMU_WAIT_S)
    status = robot.imu.status()
    age = status.get("reading_age_s")

    if age is None:
        return _result(True, False, "the sensor has never produced a reading")
    if age > IMU_MAX_AGE_S:
        return _result(True, False, f"the last reading is {age:.1f}s old")
    if status.get("accel_raw_m_s2") is None:
        return _result(True, False, "no acceleration channel")

    return _result(
        True,
        True,
        confirmed=True,
        reading_age_s=age,
        state=status.get("state"),
    )


def motor_probe(robot):
    """Turn the motors and ask the IMU whether the robot moved.

    THIS MOVES THE ROBOT. It pivots on the spot for a third of a second at the
    lowest duty the gearbox turns at -- see Drive.self_test, which owns the
    limits -- and both motors always run together.

    The IMU closes the loop. Commanding a motor proves the software works;
    watching the chassis rotate proves the motor, the driver, the wiring and the
    gearbox all do. With no IMU fitted the pulse still runs and the result comes
    back unconfirmed, because a claim that cannot be checked should not wear a
    tick.

    A pulse that does not move the robot is tried once more the other way before
    it is called a failure. MIN_DUTY is by definition the edge of what the
    gearbox will turn at, so a cold robot, a wheel against a kerb or a tooth
    resting badly can all refuse to break away in one direction and go without
    complaint in the other. There is no current sensing on this chassis, so a
    stall and a stripped gearbox look identical from here -- the reversal is the
    only thing that separates them, and without it stiction is reported to the
    operator as a broken drive.
    """
    if robot.active_run_id:
        return _result(False, False, "a run is already open")
    if not robot.drive.hardware_available:
        return _result(False, False, "no motor hardware")

    before = robot.imu.status().get("yaw")
    ran, reason = robot.drive.self_test()
    if not ran:
        return _result(True, False, reason)

    # The IMU integrates on its own thread; give it a poll or two to catch up.
    time.sleep(0.3)
    after = robot.imu.status().get("yaw")

    if before is None or after is None:
        return _result(
            True,
            True,
            "the motors were driven, but there is no IMU to confirm they turned",
            confirmed=False,
        )

    turned = abs(_wrap_degrees(after - before))
    if turned >= MOTOR_MIN_YAW_DEG:
        return _result(True, True, confirmed=True, yaw_change_deg=round(turned, 1))

    ran, reason = robot.drive.self_test(reverse=True)
    if not ran:
        return _result(True, False, reason)

    time.sleep(0.3)
    settled = robot.imu.status().get("yaw")
    if settled is None:
        return _result(
            True,
            True,
            "the motors were driven, but there is no IMU to confirm they turned",
            confirmed=False,
        )

    back = abs(_wrap_degrees(settled - after))
    if back >= MOTOR_MIN_YAW_DEG:
        return _result(
            True,
            True,
            "the motors needed a nudge the other way before they broke away",
            confirmed=True,
            yaw_change_deg=round(back, 1),
            reversed_to_start=True,
        )

    return _result(
        True,
        False,
        "the motors were driven both ways but the robot did not turn "
        f"({turned:.1f}° then {back:.1f}°)",
        yaw_change_deg=round(max(turned, back), 1),
    )


def _wrap_degrees(value):
    """Shortest signed angle, so 359 -> 1 reads as +2 rather than -358."""
    return (value + 180.0) % 360.0 - 180.0
