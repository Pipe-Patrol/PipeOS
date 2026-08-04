"""Identity, capabilities, and a one-shot telemetry read.

`GET /api/health` is what the console's connect screen probes. It has to answer
fast and without side effects, because it is fired at several candidate hosts at
once and most of them will not be a robot.

It also reports what is *missing*. The console draws its unavailable states from
this rather than from a hardcoded list, so fitting the voltage sensor changes
what the operator sees without a frontend release.
"""

from fastapi import APIRouter, Depends

from pipepatrol import __version__
from pipepatrol.api.deps import get_robot
from pipepatrol.hardware import host

router = APIRouter()


@router.get("/api/health")
async def get_health(robot=Depends(get_robot)):
    battery = host.battery()
    current = host.motor_current()
    unavailable = []
    if not battery["available"]:
        unavailable.append("battery")
    if not current["available"]:
        unavailable.append("motor_current")

    return {
        "service": "pipepatrol",
        "version": __version__,
        "hostname": host.hostname(),
        "capabilities": {
            "motors": robot.drive.hardware_available,
            "camera": robot.camera.available,
            "lights": robot.lights.available,
            "imu": robot.imu.status()["state"] != "absent",
            "optical_flow": robot.flow.available,
            "detector": robot.detections.available,
        },
        "unavailable": unavailable,
        "active_run_id": robot.active_run_id,
    }


@router.get("/api/telemetry")
async def get_telemetry(robot=Depends(get_robot)):
    """The same envelope the socket pushes. For curl, and for a first paint."""
    return robot.telemetry()
