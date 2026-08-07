"""The preflight probes, over HTTP.

Two endpoints. The sweep runs every probe and reports them together; the second
runs the motor probe alone, for an operator retesting one row without paying for
the rest of the sweep again.

The motor probe MOVES THE ROBOT, wherever it is called from. It is opt-in on the
sweep for that reason -- the caller has to ask for it -- and motor_probe refuses
itself while a run is open, so neither route can turn a robot someone is driving.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from pipepatrol import preflight
from pipepatrol.api.deps import get_robot

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/preflight")


class PreflightRequest(BaseModel):
    # Opt-in, and off by default: a caller that does not know this turns the
    # robot must not turn it. The console asks for it once the operator has the
    # panel open and the robot is on the ground.
    motors: bool = False


@router.post("")
async def post_preflight(
    payload: PreflightRequest = PreflightRequest(),
    robot=Depends(get_robot),
):
    """Storage, camera, IMU, lights, and the motors when asked for.

    Off the event loop: the probes sleep, waiting on frames and on the IMU, and
    blocking the loop would stall the telemetry socket the console is watching
    them through.
    """
    return await asyncio.to_thread(preflight.run, robot, payload.motors)


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
