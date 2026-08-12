"""The telemetry envelope: one snapshot of everything, ten times a second.

Every field carries which of three tiers it belongs to, because the console
renders them differently and must never have to guess:

    measured      came off a sensor
    estimated     derived and drifting -- badged, with its uncertainty attached
    unavailable   no sensor exists -- a blank, never a number

`unavailable` is the one that matters. A fabricated battery percentage would be
believed by a crew standing over an open manhole, and believing it is what gets
a robot stranded forty metres in. See docs/DECISIONS.md.

This module builds a dict and nothing else. It reads subsystems, never commands
them, so a bug here cannot move a motor.
"""

import time

QUALITY_MEASURED = "measured"
QUALITY_ESTIMATED = "estimated"
QUALITY_UNAVAILABLE = "unavailable"


def build(robot):
    """One snapshot of everything. Never raises."""
    drive = robot.drive.status()
    imu = robot.imu.status()
    camera = robot.camera.status()
    lights = robot.lights.status()
    host = robot.host_status()
    climate = robot.climate.status()
    odometry = robot.odometry.status()
    hazards = robot.hazards.status()
    flow = robot.flow.status()

    return {
        "type": "telemetry",
        "at": round(time.time(), 3),
        "drive": drive,
        "orientation": _orientation(imu),
        "motion": _motion(odometry, flow),
        "power": _power(robot),
        "camera": camera,
        "lights": lights,
        "climate": _climate(climate),
        "host": host,
        "hazards": hazards,
        "detections": [d.as_dict() for d in robot.detections.active()],
        "perception": robot.detections.status(),
        "flow": flow,
        "run": robot.run_status(),
        "recording": robot.recorder.status(),
        "alert": _alert(drive, hazards, camera, host),
    }


def _climate(climate):
    """Air temperature and humidity, or blanks.

    Tiered like everything else: a sensor that has gone quiet reports
    unavailable rather than holding up its last reading, because a stale
    humidity looks exactly like a current one and this is a number an operator
    may be asked to put in a report.
    """
    return {
        "quality": QUALITY_MEASURED if climate["available"] else QUALITY_UNAVAILABLE,
        "available": climate["available"],
        "temperature_c": climate["temperature_c"],
        "humidity_pct": climate["humidity_pct"],
    }


def _orientation(imu):
    """Pitch and roll are absolute. Yaw is not, unless someone has said so.

    `heading_deg` is the compass bearing and is null until the operator sets a
    north reference (hardware/imu.py set_north), and null again if the sensor
    reconnects and invalidates it. Never a fallback to the relative yaw: a
    compass that is wrong by an unknown amount is worse than no compass.
    """
    north = imu["north"]
    return {
        "quality": QUALITY_MEASURED if imu["state"] == "ok" else imu["state"],
        "pitch_deg": imu["pitch"],
        "roll_deg": imu["roll"],
        "yaw_deg": imu["yaw"],
        "yaw_is_relative": True,
        "heading_deg": north["heading_deg"],
        "north_set": north["set"],
        # Set once, then the sensor restarted. The operator has to do it again.
        "north_stale": north["stale"],
        "accel_m_s2": imu["accel_m_s2"],
        "state": imu["state"],
    }


def _motion(odometry, flow):
    """Distance and speed, both estimated. The tier is in the payload, not a comment.

    The tracked features ride along because distance is measured off the picture
    and an operator has no other way to tell a confident estimate from one the
    camera has stopped supporting -- the number keeps updating either way.

    No acceleration here any more. It used to ride along because the distance was
    partly integrated from it; the distance is now purely visual, and an IMU
    reading sitting inside the motion block would imply it still had a say. It
    is still published under `orientation`, which is where preflight reads it.
    """
    return {
        **odometry,
        "flow_points": flow.get("points") or None,
    }


def _power(robot):
    """Battery and motor current, neither of which is wired."""
    battery = robot.battery()
    current = robot.motor_current()
    return {
        "battery": {"quality": QUALITY_UNAVAILABLE, **battery},
        "motor_current": {"quality": QUALITY_UNAVAILABLE, **current},
    }


def _alert(drive, hazards, camera, host):
    """The single line the console shows across the top. Most urgent wins.

    One string rather than a list: an operator driving has attention for exactly
    one message, and a stack of them is how the important one gets missed.
    """
    if drive.get("run_limit_tripped"):
        return {"level": "critical", "message": "RUN LIMIT — release controls to reset"}

    reason = drive.get("last_stop_reason") or ""
    if reason.startswith("watchdog"):
        return {"level": "critical", "message": reason.upper()}

    if hazards.get("stalled"):
        return {
            "level": "critical",
            "message": "POSSIBLE STALL — motors driving, nothing moving",
        }

    obstruction = hazards.get("obstruction")
    if obstruction:
        distance = obstruction.get("estimated_distance_m")
        suffix = f" — {distance:.1f} m" if distance else ""
        return {
            "level": obstruction["level"],
            "message": f"OBSTRUCTION AHEAD{suffix}",
        }

    if drive.get("hardware") is False:
        return {"level": "critical", "message": "MOTOR GPIO UNAVAILABLE"}

    if host.get("temp_state") == "critical":
        return {
            "level": "warning",
            "message": f"PI THROTTLING — {host.get('cpu_temp_c')}°C",
        }

    if camera.get("available") is False:
        return {"level": "warning", "message": "NO CAMERA"}

    storage = host.get("storage") or {}
    if storage.get("used_pct") is not None and storage["used_pct"] >= 95:
        return {"level": "warning", "message": "STORAGE ALMOST FULL"}

    return None
