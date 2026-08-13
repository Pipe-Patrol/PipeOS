"""Identity, capabilities, and a one-shot telemetry read.

`GET /api/health` is what the console's connect screen probes. It has to answer
fast and without side effects, because it is fired at several candidate hosts at
once and most of them will not be a robot.

It also reports what is *missing*. The console draws its unavailable states from
this rather than from a hardcoded list, so fitting the voltage sensor changes
what the operator sees without a frontend release.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from pipepatrol import __version__, config
from pipepatrol.api.deps import get_robot
from pipepatrol.hardware import host
from pipepatrol.perception import detector_for
from pipepatrol.perception.remote import normalise_url

router = APIRouter()


class DetectorHostRequest(BaseModel):
    # A bare host, a host:port, or a full URL -- normalise_url takes all three.
    # Empty clears the override and falls back to the address deploy.sh baked in.
    url: str = ""


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


@router.get("/api/detector-host")
async def get_detector_host(robot=Depends(get_robot)):
    """Where the model runs, and whether the robot is getting answers from it."""
    return {
        "url": config.detector_url(),
        # What deploy.sh baked in, so the console can show what clearing the
        # override would fall back to rather than just emptying the field.
        "deployed": config.DETECTOR_URL,
        **robot.detections.status(),
    }


@router.post("/api/detector-host")
async def post_detector_host(payload: DetectorHostRequest, robot=Depends(get_robot)):
    """Point the robot at a different machine for inference, without a redeploy.

    The address a laptop had at deploy time is a guess about a DHCP lease. This
    is what makes it correctable in the field, from the settings screen, on a
    robot that is already forty metres into a pipe.
    """
    # Normalised before it is stored, not after, so the address that comes back
    # to the settings screen is the one the robot will actually post to. Storing
    # "mymac.local" and reporting "mymac.local" hides which port it resolved to,
    # which is the first thing anyone checks when it does not work.
    url = config.save_detector_url(normalise_url(payload.url))
    robot.detections.set_backend(detector_for(url))
    return {
        "ok": True,
        "url": url,
        "deployed": config.DETECTOR_URL,
        **robot.detections.status(),
    }


@router.get("/api/telemetry")
async def get_telemetry(robot=Depends(get_robot)):
    """The same envelope the socket pushes. For curl, and for a first paint."""
    return robot.telemetry()
