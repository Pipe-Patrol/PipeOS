"""The camera: the stream, its tuning, and stills pulled off it."""

import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from pipepatrol.api.deps import get_robot
from pipepatrol.hardware import camera as camera_module

log = logging.getLogger(__name__)

router = APIRouter()


class TuningRequest(BaseModel):
    brightness: float | None = Field(default=None, ge=-1.0, le=1.0)
    contrast: float | None = Field(default=None, ge=-1.0, le=1.0)
    dehaze: bool | None = None


@router.get("/api/camera")
async def get_camera(robot=Depends(get_robot)):
    if not robot.camera.available:
        # One retry: the camera may have come up after the server did.
        robot.camera.start()
    if not robot.camera.available:
        return JSONResponse(
            {"error": "camera unavailable", **robot.camera.status()}, status_code=503
        )
    return StreamingResponse(
        robot.camera.frames(),
        media_type=f"multipart/x-mixed-replace; boundary={camera_module.BOUNDARY}",
        headers={"Cache-Control": "no-store", "Age": "0"},
    )


@router.post("/api/camera/tuning")
async def post_tuning(payload: TuningRequest, robot=Depends(get_robot)):
    """Brightness and contrast go to the sensor. Dehaze starts a pixel worker."""
    tuning = robot.camera.set_tuning(
        brightness=payload.brightness,
        contrast=payload.contrast,
        dehaze=payload.dehaze,
    )
    return {"ok": True, "tuning": tuning}


@router.post("/api/snapshot")
async def post_snapshot(robot=Depends(get_robot)):
    """Save the current frame into the active run."""
    if robot.active_run_id is None:
        return JSONResponse(
            {"error": "no active run to save into"}, status_code=409
        )
    snapshot = robot.snapshot()
    if snapshot is None:
        return JSONResponse({"error": "no frame available"}, status_code=503)
    return {"ok": True, "snapshot": snapshot.as_dict()}


@router.post("/api/recording/start")
async def post_recording_start(robot=Depends(get_robot)):
    if robot.active_run_id is None:
        return JSONResponse({"error": "no active run to record"}, status_code=409)
    status = robot.recorder.start(robot.active_run_id)
    if status is None:
        return JSONResponse(
            {"error": "could not start recording", **robot.recorder.status()},
            status_code=503,
        )
    return {"ok": True, "recording": status}


@router.post("/api/recording/stop")
async def post_recording_stop(robot=Depends(get_robot)):
    recording = robot.recorder.stop()
    return {
        "ok": True,
        "recording": recording.as_dict() if recording else None,
    }
