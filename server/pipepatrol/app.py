"""The FastAPI application: wiring, loops, and shutdown.

Shutdown is the part worth reading. The motors must stop on every exit path,
including the ones that skip normal teardown, so there are three overlapping
mechanisms and all of them are idempotent:

    atexit          catches a plain interpreter exit
    signal handlers catch SIGINT and SIGTERM, then chain to whatever was there
    lifespan        catches an orderly uvicorn shutdown

Any one of them is enough. Having three means a failure in one is not a robot
left driving.
"""

import asyncio
import atexit
import contextlib
import logging
import os
import signal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from pipepatrol import config
from pipepatrol.api import ROUTERS
from pipepatrol.robot import Robot

log = logging.getLogger(__name__)

# The console served from the Pi is same-origin, so it needs no CORS at all.
# These exist only for `npm run dev`, which runs on another port. The list is
# explicit rather than "*" on purpose: the robot has no authentication, so a
# wildcard would let any page the operator happens to open drive it.
DEV_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "PIPEPATROL_DEV_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]


def configure_logging(level=logging.INFO):
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )


def _install_signal_handlers(robot):
    """Cut the motors on SIGINT/SIGTERM, then let the previous handler run."""
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            previous = signal.getsignal(sig)
        except (ValueError, OSError):
            continue

        def handler(signum, frame, _previous=previous):
            robot.drive.stop(f"signal {signum}")
            robot.close(f"signal {signum}")
            if callable(_previous):
                _previous(signum, frame)
            elif _previous == signal.SIG_DFL:
                signal.signal(signum, signal.SIG_DFL)
                signal.raise_signal(signum)

        try:
            signal.signal(sig, handler)
        except (ValueError, OSError):
            # Not on the main thread; lifespan + atexit still cover us.
            pass


async def _watchdog_loop(robot):
    """Motor safety only. The loop that must survive everything else failing."""
    interval = 1.0 / config.WATCHDOG_HZ
    try:
        while True:
            robot.tick_watchdog()
            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        robot.drive.stop("watchdog cancelled")
        raise


async def _estimator_loop(robot):
    """Odometry, hazards, path sampling. Never touches the motors."""
    interval = 1.0 / config.TELEMETRY_HZ
    try:
        while True:
            try:
                robot.tick_estimators()
            except Exception as exc:  # noqa: BLE001 - an estimator must not stop driving
                log.warning("estimator tick failed: %s", exc)
            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        raise


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    robot = Robot()
    app.state.robot = robot
    atexit.register(robot.close)
    _install_signal_handlers(robot)
    config.ensure_data_dir()
    robot.start()

    tasks = [
        asyncio.create_task(_watchdog_loop(robot)),
        asyncio.create_task(_estimator_loop(robot)),
    ]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        robot.close("lifespan exit")


def create_app():
    app = FastAPI(title="PipeOS", lifespan=lifespan)

    if DEV_ORIGINS:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=DEV_ORIGINS,
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    for router in ROUTERS:
        app.include_router(router)

    _mount_console(app)
    return app


# index.html names the hashed bundle, so a stale copy loads a stale app. Without
# an explicit header a browser applies its own freshness heuristic and serves the
# cached page WITHOUT asking us -- which shows yesterday's console on open and
# today's after a reload. `no-cache` means revalidate, not "do not store": the
# ETag still answers 304, so this costs one conditional request per load.
_REVALIDATE = {"Cache-Control": "no-cache"}

# Everything under /assets is content-hashed by Vite, so a given URL's bytes can
# never change. Safe to keep for a year, and it is what makes the above cheap.
_IMMUTABLE = "public, max-age=31536000, immutable"


class _HashedAssets(StaticFiles):
    """StaticFiles, plus the long cache the hashed filenames have earned."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = _IMMUTABLE
        return response


def _mount_console(app: FastAPI):
    """Serve the built console, if there is one.

    In development there is not -- Vite serves it -- so this degrades to a note
    at `/` rather than a 404 that looks like the server is broken.
    """
    dist = config.WEB_DIST
    index = dist / "index.html"

    if (dist / "assets").is_dir():
        app.mount(
            "/assets", _HashedAssets(directory=str(dist / "assets")), name="assets"
        )

    @app.get("/{path:path}")
    async def console(path: str):
        # An unmatched /api path is a 404, not the console. Without this the
        # catch-all answers 200 to every typo and every probe of a route that
        # does not exist, which reads as "handled" to anything checking.
        if path.startswith("api/") or path == "api":
            return JSONResponse({"error": "no such endpoint"}, status_code=404)

        if not index.is_file():
            return JSONResponse(
                {
                    "service": "pipepatrol",
                    "note": (
                        "no built console at "
                        f"{dist} — run `npm run build` in web/, or use the Vite "
                        "dev server"
                    ),
                },
                status_code=200,
            )
        # A real file if it exists (favicon, fonts), otherwise index.html so
        # client-side routes like /runs/abc123 survive a page reload. Neither is
        # content-hashed, so both revalidate.
        candidate = dist / path
        if path and candidate.is_file():
            return FileResponse(candidate, headers=_REVALIDATE)
        return FileResponse(index, headers=_REVALIDATE)


app = create_app()
