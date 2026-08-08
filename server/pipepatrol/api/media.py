"""The camera: the stream, its tuning, and stills pulled off it."""

import logging

from fastapi import APIRouter, Depends, Request, Response
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
    sharpness: float | None = Field(default=None, ge=0.0, le=1.0)


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


@router.get("/api/camera/still")
async def get_camera_still(robot=Depends(get_robot)):
    """One frame, as a plain JPEG.

    The stream is the wrong thing to point an <img> at when what is wanted is a
    picture of a particular moment: it keeps playing, so a "preview" of the
    frame a defect was filed against quietly becomes a live view of wherever the
    robot is now. This returns the current frame and then ends, so the browser
    holds a still.

    Cached hard and deliberately. The console fetches this with the timestamp
    the operator marked the defect at, and that URL must keep resolving to the
    same picture for as long as the panel is open.
    """
    jpeg = robot.camera.latest_jpeg()
    if jpeg is None:
        return JSONResponse({"error": "no frame available"}, status_code=503)
    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=3600, immutable"},
    )


@router.post("/api/detect")
async def post_detect(
    request: Request, min: float | None = None, robot=Depends(get_robot)
):
    """Run the model against a frame the console supplied, rather than the camera.

    This is what makes demo day honest. On demo day the robot is on a table and
    the camera sees a ceiling, so the console feeds it recorded footage instead
    -- but the detections still have to be the model's own work rather than
    something drawn on. The frames come here, the same detector that would have
    run against the camera runs against them, and what comes back is what it
    found.

    Synchronous on purpose. The live path is deliberately decoupled from
    inference because video must never wait on it; here there is no video to
    hold up and the caller wants the answer for the frame it just sent.
    """
    if not robot.detections.available:
        return JSONResponse(
            {"error": "no detection model is installed", **robot.detections.status()},
            status_code=503,
        )

    jpeg = await request.body()
    if not jpeg:
        return JSONResponse({"error": "no frame supplied"}, status_code=400)

    try:
        # `min` lowers the confidence floor, for the model lab: on a frame with
        # no detections the best score reached is what says whether the model
        # looked and was unconvinced, or is simply not working.
        found = robot.detections.infer_once(jpeg, min_confidence=min)
    except Exception as exc:  # noqa: BLE001 - a model fault must not stop the console
        log.warning("supplied-frame inference failed: %s", exc)
        return JSONResponse({"error": f"{type(exc).__name__}: {exc}"}, status_code=500)

    return {"ok": True, "detections": [d.as_dict() for d in found]}


@router.post("/api/camera/tuning")
async def post_tuning(payload: TuningRequest, robot=Depends(get_robot)):
    """Brightness and contrast go to the sensor. Dehaze and sharpening do not.

    Those two share a worker that decodes and re-encodes every frame, so either
    one switched on costs CPU; both together cost barely more than one.

    Orientation is deliberately not here: the 180 degree turn is a fixed
    correction for how the camera is mounted, not something to adjust mid-run.
    """
    tuning = robot.camera.set_tuning(
        brightness=payload.brightness,
        contrast=payload.contrast,
        dehaze=payload.dehaze,
        sharpness=payload.sharpness,
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
