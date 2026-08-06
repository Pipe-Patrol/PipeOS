"""Driving the robot: the WebSocket, and the stop that does not need it.

The socket carries commands in and telemetry out at 10 Hz. `POST /api/stop` is
deliberately independent of it -- the socket is a plausible thing to have died,
and the operator hitting stop must not depend on the channel that failed.

Nothing in this file enforces a motor limit. Every protection lives in
hardware/drive.py, so it still holds when this layer is what broke.
"""

import asyncio
import contextlib
import json
import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from pipepatrol import config
from pipepatrol.api.deps import get_robot

log = logging.getLogger(__name__)

router = APIRouter()


class LedRequest(BaseModel):
    # 0..1 of the usable range. hardware/lights.py owns the real ceiling.
    level: float = Field(default=0.0, ge=0.0, le=1.0)


class NorthRequest(BaseModel):
    """The true bearing the robot is facing at the moment of the call."""

    facing_deg: float = Field(default=0.0, ge=0.0, lt=360.0)


@router.post("/api/stop")
async def post_stop(robot=Depends(get_robot)):
    """Immediate all-stop. No dependency on the WebSocket, by design."""
    robot.drive.stop("api stop")
    return {"ok": True, "drive": robot.drive.status()}


@router.post("/api/led")
async def post_led(payload: LedRequest, robot=Depends(get_robot)):
    applied = robot.lights.set_level(payload.level)
    return {"ok": True, "level": applied, "lights": robot.lights.status()}


@router.post("/api/north")
async def post_north(payload: NorthRequest, robot=Depends(get_robot)):
    """Anchor the IMU's yaw to a real compass bearing.

    Point the robot at a known direction, then call this with that direction.
    Nothing on the robot can measure it -- the IMU has no magnetometer -- so
    this is the only way a heading becomes a bearing.

    409 when there is no yaw to anchor to, which means no IMU: a reference
    against nothing would read as set and be meaningless.
    """
    reference = robot.imu.set_north(payload.facing_deg)
    if reference is None:
        return JSONResponse(
            {"error": "no IMU reading to anchor north to"}, status_code=409
        )
    return {"ok": True, "north": reference}


@router.delete("/api/north")
async def delete_north(robot=Depends(get_robot)):
    """Forget the reference. Headings go back to being relative to power-on."""
    robot.imu.clear_north()
    return {"ok": True, "north": robot.imu.status()["north"]}


@router.websocket("/ws")
async def websocket_control(websocket: WebSocket):
    robot = websocket.app.state.robot
    await websocket.accept()
    log.info("client connected: %s", websocket.client)

    async def receive_commands():
        while True:
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue

            command = payload.get("type", "drive")
            if command == "stop":
                robot.drive.stop("client stop")
            elif command == "ping":
                # Echoed straight back so the browser can time the round trip.
                # The client owns the clock; the server never needs to know it.
                await websocket.send_text(
                    json.dumps({"type": "pong", "t": payload.get("t")})
                )
            elif command == "led":
                robot.lights.set_level(payload.get("level", 0.0))
            else:
                # Default path: a tank command. Anything malformed clamps to 0.
                robot.drive.command(payload.get("left", 0.0), payload.get("right", 0.0))

    async def send_telemetry():
        interval = 1.0 / config.TELEMETRY_HZ
        while True:
            await websocket.send_text(json.dumps(robot.telemetry()))
            await asyncio.sleep(interval)

    receiver = asyncio.create_task(receive_commands())
    sender = asyncio.create_task(send_telemetry())
    try:
        done, pending = await asyncio.wait(
            {receiver, sender}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
        for task in done:
            with contextlib.suppress(WebSocketDisconnect, asyncio.CancelledError):
                task.result()
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 - a bad client must not kill the server
        log.warning("websocket error: %s", exc)
    finally:
        # The socket dropping is exactly the case the watchdog exists for, but
        # stop immediately rather than waiting out the 500 ms.
        robot.drive.stop("client disconnected")
        log.info("client disconnected: %s", websocket.client)
