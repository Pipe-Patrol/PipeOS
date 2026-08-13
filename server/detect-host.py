#!/usr/bin/env python3
"""The defect model, served from a laptop for a robot that no longer carries it.

Run this on your Mac, point the robot at it, and the Pi stops doing inference
entirely. See MODEL.md.

    cd server
    .venv/bin/python detect-host.py

WHY IT IS A SEPARATE FILE AND NOT `python -m pipepatrol`. The full server brings
up a camera, an IMU, motors, a watchdog and a run store, none of which exist on
a laptop and all of which log their absence at startup. This needs one thing:
the model. It is also on 8600 rather than 8000, so it can run beside the Vite
dev server and beside a full local server on demo day without a port fight.

THE ENDPOINT IS THE ROBOT'S OWN. `POST /api/detect` here takes the same raw
JPEG body and returns the same `{"ok": true, "detections": [...]}` as the
robot's demo-day endpoint, because perception/remote.py speaks exactly one
protocol whichever end it is pointed at. That also means you can curl this the
same way you would curl the robot.
"""

import argparse
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from pipepatrol.perception import RfDetrDetector  # noqa: E402

log = logging.getLogger("detect-host")

DEFAULT_PORT = 8600

app = FastAPI(title="PipeOS detection host")
detector = None


@app.get("/api/health")
async def health():
    """What the robot and the console probe. Cheap, and truthful about the model."""
    return {
        "service": "pipepatrol-detect",
        "ok": detector.available,
        **detector.status(),
    }


@app.post("/api/detect")
async def detect(request: Request, min: float | None = None):
    """One JPEG in, the model's findings out.

    Synchronous, like the robot's copy: there is no video here to hold up and
    the caller wants the answer for the frame it just sent.
    """
    if not detector.available:
        return JSONResponse(
            {"error": detector.error or "no model loaded", **detector.status()},
            status_code=503,
        )

    jpeg = await request.body()
    if not jpeg:
        return JSONResponse({"error": "no frame supplied"}, status_code=400)

    try:
        # `min` lowers the confidence floor, for the model lab: on a frame with
        # no detections the best score reached is what says whether the model
        # looked and was unconvinced, or is simply not working.
        found = detector.infer(jpeg, min_confidence=min)
    except Exception as exc:  # noqa: BLE001 - a model fault must not kill the host
        log.warning("inference failed: %s", exc)
        return JSONResponse({"error": f"{type(exc).__name__}: {exc}"}, status_code=500)

    return {"ok": True, "detections": [d.as_dict() for d in found]}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    # 0.0.0.0 by default and deliberately: the whole point is that a robot on
    # the LAN can reach it. Localhost would serve only this machine.
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument(
        "--model",
        help="an ONNX graph to serve instead of the default (PIPEPATROL_MODEL also works)",
    )
    parser.add_argument(
        "--threads",
        type=int,
        help="inference threads. Defaults to all cores but one -- unlike the Pi, "
        "there is nothing else on this machine that must stay responsive.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    global detector
    detector = RfDetrDetector(
        model_path=args.model, threads=args.threads or (os.cpu_count() or 4)
    )

    if not detector.available:
        # Loud, and still serving. The robot's error message comes from asking
        # this host, so a host that refuses to start leaves the operator with
        # "cannot reach" -- which sends them to the network, not to the model.
        log.error("NO MODEL: %s", detector.error)
        log.error("the robot will report this rather than a connection failure")
    else:
        log.info("serving %s on port %d", detector.model_path.name, args.port)
        for address in _lan_addresses():
            log.info("robot should point at  %s:%d", address, args.port)

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


def _lan_addresses():
    """Best guess at what to type into the robot's settings screen.

    Printed rather than resolved automatically, because the machine cannot know
    which of its interfaces the robot can see -- but printing them saves an
    `ifconfig | grep inet` every time the network changes.
    """
    import socket

    try:
        _, _, addresses = socket.gethostbyname_ex(socket.gethostname())
    except OSError:
        addresses = []
    return [a for a in addresses if not a.startswith("127.")]


if __name__ == "__main__":
    main()
