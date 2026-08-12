"""Demo day: the routes that let a laptop feed the robot's camera.

Mounted by pipepatrol/app.py only if this folder exists. Delete the folder and
the feature is gone -- see README.md.

There are two of them:

    POST /api/demoday/frame     a JPEG becomes the camera's current frame
    GET  /demo-panel            the operator's control panel window

The first is the whole trick. It writes into the same StreamingOutput the camera
backend writes into, so every consumer downstream -- optical flow and therefore
the distance estimate, the defect model, snapshots, the run recorder, the MJPEG
stream the console draws -- reads the supplied frame without knowing it was
supplied. Nothing is simulated and nothing downstream is special-cased, which is
the point: what a judge sees is the real console doing its real work on frames
that happen to have come from a file.

The takeover is not latched. hardware/camera.py gives the sensor its output back
a couple of seconds after the last supplied frame, so closing the panel, a dead
laptop or a dropped network all end in a live camera rather than a frozen one.
"""

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, JSONResponse

from pipepatrol.api.deps import get_robot

log = logging.getLogger("pipepatrol.demoday")

router = APIRouter()

PANEL = Path(__file__).resolve().parent / "panel.html"


@router.post("/api/demoday/frame")
async def post_frame(request: Request, robot=Depends(get_robot)):
    """Make the posted JPEG the camera's current frame."""
    output = robot.camera.raw_output()
    if output is None:
        # No camera running, so there is no stream to take over. Deliberately
        # not faked up: preflight tests the camera for real, and a run that
        # started against a camera that is not there would be the one dishonest
        # thing in this whole feature.
        return JSONResponse(
            {"error": "camera is not running", **robot.camera.status()},
            status_code=503,
        )

    jpeg = await request.body()
    if not jpeg:
        return JSONResponse({"error": "no frame supplied"}, status_code=400)

    output.write(jpeg, supplied=True)
    return {"ok": True, "bytes": len(jpeg)}


@router.get("/demo-panel")
async def get_panel():
    if not PANEL.is_file():
        return JSONResponse({"error": "panel.html is missing"}, status_code=404)
    return FileResponse(PANEL, headers={"Cache-Control": "no-store"})
