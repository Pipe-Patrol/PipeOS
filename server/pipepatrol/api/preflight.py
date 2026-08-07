"""The preflight probes, over HTTP.

Two endpoints because they carry very different consequences. The first reads
and writes nothing an operator would notice. The second turns the motors, so it
is never part of the automatic sweep and never happens without someone asking.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from pipepatrol import preflight
from pipepatrol.api.deps import get_robot

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/preflight")


@router.post("")
async def post_preflight(robot=Depends(get_robot)):
    """Storage, camera, IMU and lights. Nothing here moves the robot.

    Off the event loop: the probes sleep, waiting on frames and on the IMU, and
    blocking the loop would stall the telemetry socket the console is watching
    them through.
    """
    return await asyncio.to_thread(preflight.run, robot, False)


@router.post("/motors")
async def post_motor_preflight(robot=Depends(get_robot)):
    """THIS MOVES THE ROBOT. Pivots on the spot, briefly, and checks the IMU.

    Refused while a run is open: the operator is driving then, and the drive
    already answers this question every time they press a key.
    """
    if robot.active_run_id:
        return JSONResponse(
            {"error": "a run is already open"},
            status_code=409,
        )
    return await asyncio.to_thread(preflight.motor_probe, robot)
