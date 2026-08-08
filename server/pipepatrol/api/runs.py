"""Runs: starting, ending, reading back, and getting out.

Runs live on the Pi (see runs/store.py), so these routes are the only way the
console sees them. That is the point -- two devices watching the same robot see
the same run.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    Response,
    StreamingResponse,
)
from pydantic import BaseModel, Field

from pipepatrol.api.deps import get_robot
from pipepatrol.runs import export, video as video_module
from pipepatrol.runs.models import Defect

router = APIRouter(prefix="/api/runs")


class OriginRequest(BaseModel):
    """Where the operator placed the entry point on the map."""

    lat: float = Field(ge=-90.0, le=90.0)
    lon: float = Field(ge=-180.0, le=180.0)
    # Compass direction the robot faces going in, 0 = north. Null means the
    # operator did not say, in which case the robot fills it in from its own
    # heading if a north reference has been set, and falls back to north.
    bearing_deg: float | None = Field(default=None, ge=0.0, lt=360.0)


class StartRunRequest(BaseModel):
    name: str = ""
    record: bool = False
    # None when the operator did not place the run on the map. The run is still
    # perfectly valid -- it just has no anchor, so its track stays local.
    origin: OriginRequest | None = None


class Region(BaseModel):
    x: float
    y: float
    w: float
    h: float


class DefectRequest(BaseModel):
    code: str = ""
    severity: int = Field(default=3, ge=1, le=5)
    clock_position: int | None = Field(default=None, ge=1, le=12)
    note: str = ""
    detection_id: str | None = None
    # Box the operator drew over the frame, normalised 0..1.
    region: Region | None = None
    # Save the current frame alongside the defect. Video is not kept unless
    # recording is on, so without this there is nothing to look at later.
    with_snapshot: bool = True


@router.get("")
async def list_runs(robot=Depends(get_robot)):
    return {"runs": robot.store.list(), "active_run_id": robot.active_run_id}


@router.post("")
async def start_run(payload: StartRunRequest, robot=Depends(get_robot)):
    run = robot.start_run(
        name=payload.name,
        record=payload.record,
        origin=payload.origin.model_dump() if payload.origin else None,
    )
    return {"ok": True, "run": run.as_dict()}


@router.get("/interrupted")
async def list_interrupted(robot=Depends(get_robot)):
    """Runs that were never ended -- a crash, or the power going out."""
    return {"runs": robot.store.interrupted()}


@router.get("/{run_id}")
async def get_run(run_id: str, robot=Depends(get_robot)):
    run = robot.store.get(run_id)
    if run is None:
        return JSONResponse({"error": "no such run"}, status_code=404)
    return run.as_dict()


@router.delete("/{run_id}")
async def delete_run(run_id: str, robot=Depends(get_robot)):
    if run_id == robot.active_run_id:
        return JSONResponse(
            {"error": "cannot delete the run that is recording"}, status_code=409
        )
    if not robot.store.delete(run_id):
        return JSONResponse({"error": "no such run"}, status_code=404)
    return {"ok": True}


@router.post("/{run_id}/end")
async def end_run(run_id: str, robot=Depends(get_robot)):
    if run_id != robot.active_run_id:
        return JSONResponse({"error": "that run is not active"}, status_code=409)
    run = robot.end_run()
    return {"ok": True, "run": run.as_dict() if run else None}


@router.post("/{run_id}/resume")
async def resume_run(run_id: str, robot=Depends(get_robot)):
    run = robot.resume_run(run_id)
    if run is None:
        return JSONResponse(
            {"error": "no such run, or it was ended normally"}, status_code=409
        )
    return {"ok": True, "run": run.as_dict()}


@router.post("/{run_id}/defects")
async def add_defect(run_id: str, payload: DefectRequest, robot=Depends(get_robot)):
    """Log a defect at wherever the odometer currently thinks the robot is.

    The chainage is stamped here rather than sent by the client so it cannot
    drift between the operator pressing the key and the request landing. Its
    uncertainty is stored with it -- the number is an estimate and a report
    built from it has to be able to say so.
    """
    run = robot.store.get(run_id)
    if run is None:
        return JSONResponse({"error": "no such run"}, status_code=404)

    snapshot = None
    if payload.with_snapshot and run_id == robot.active_run_id:
        snapshot = robot.snapshot()

    motion = robot.odometry.status()
    defect = Defect(
        code=payload.code,
        severity=payload.severity,
        clock_position=payload.clock_position,
        note=payload.note,
        detection_id=payload.detection_id,
        chainage_m=motion["chainage_m"] if run_id == robot.active_run_id else None,
        chainage_uncertainty_m=(
            motion["uncertainty_m"] if run_id == robot.active_run_id else None
        ),
        snapshot_id=snapshot.id if snapshot else None,
        region=payload.region.model_dump() if payload.region else None,
    )
    robot.store.add_defect(run_id, defect)
    return {"ok": True, "defect": defect.as_dict()}


@router.delete("/{run_id}/defects/{defect_id}")
async def delete_defect(run_id: str, defect_id: str, robot=Depends(get_robot)):
    if not robot.store.delete_defect(run_id, defect_id):
        return JSONResponse({"error": "no such defect"}, status_code=404)
    return {"ok": True}


@router.get("/{run_id}/snapshots/{filename}")
async def get_snapshot(run_id: str, filename: str, robot=Depends(get_robot)):
    # Reject anything that could climb out of the run directory. The filename
    # comes from a URL, so it is never trusted.
    if "/" in filename or "\\" in filename or ".." in filename:
        return JSONResponse({"error": "bad filename"}, status_code=400)
    path = robot.store.snapshot_path(run_id, filename)
    if not path.is_file():
        return JSONResponse({"error": "no such snapshot"}, status_code=404)
    return FileResponse(path, media_type="image/jpeg")


@router.get("/{run_id}/video")
async def get_video(run_id: str, clip: str | None = None, robot=Depends(get_robot)):
    """The raw MJPEG. `ffmpeg -f mjpeg -i video.mjpeg out.mp4` converts it.

    `clip` names one recording by id; without it the first is served. The joined
    version of every clip is the .mov endpoint below.
    """
    run = robot.store.get(run_id)
    if run is None or not run.recordings:
        return JSONResponse({"error": "no recording for that run"}, status_code=404)
    recording = _pick_clip(run, clip)
    if recording is None:
        return JSONResponse({"error": "no such clip"}, status_code=404)
    path = robot.store.run_dir(run_id) / recording.file
    if not path.is_file():
        return JSONResponse({"error": "recording file is missing"}, status_code=404)
    return FileResponse(path, media_type="video/x-motion-jpeg")


def _pick_clip(run, clip_id):
    if clip_id is None:
        return run.recordings[0]
    return next((r for r in run.recordings if r.id == clip_id), None)


@router.get("/{run_id}/video.mov")
async def get_video_mov(run_id: str, robot=Depends(get_robot)):
    """The recording as a file a laptop will actually open.

    A container rewrite, not a re-encode, streamed straight out rather than
    written to the card -- see runs/video.py for why both of those matter.
    """
    run = robot.store.get(run_id)
    if run is None or not run.recordings:
        return JSONResponse({"error": "no recording for that run"}, status_code=404)

    directory = robot.store.run_dir(run_id)
    clips = [
        recording
        for recording in run.recordings
        if (directory / recording.file).is_file()
    ]
    if not clips:
        return JSONResponse({"error": "recording file is missing"}, status_code=404)
    if not video_module.available():
        return JSONResponse(
            {"error": "ffmpeg is not installed on the robot"}, status_code=503
        )

    # Every clip, joined, in the order they were recorded. One rate for the
    # whole thing: they were all captured by the same recorder at the same cap,
    # and the first clip is the longest-running evidence of what that was.
    fps = video_module.recorded_fps(directory / clips[0].index_file)
    filename = _download_name(run)
    return StreamingResponse(
        video_module.remux([directory / clip.file for clip in clips], fps),
        media_type=video_module.MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _download_name(run):
    """A filename someone can find again, rather than video.mov in Downloads."""
    safe = "".join(
        character if character.isalnum() or character in "-_" else "-"
        for character in (run.name or "run")
    ).strip("-")
    return f"{safe or 'run'}-{run.id}.mov"


@router.get("/{run_id}/export.{fmt}")
async def export_run(run_id: str, fmt: str, robot=Depends(get_robot)):
    run = robot.store.get(run_id)
    if run is None:
        return JSONResponse({"error": "no such run"}, status_code=404)

    builders = {
        "json": (export.to_json, "application/json"),
        "csv": (export.to_csv, "text/csv"),
    }
    if fmt == "zip":
        body = export.to_zip(run, robot.store)
        media_type = "application/zip"
    elif fmt in builders:
        builder, media_type = builders[fmt]
        body = builder(run)
    else:
        return JSONResponse(
            {"error": "format must be json, csv or zip"}, status_code=400
        )

    filename = export.filename_for(run, fmt)
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
