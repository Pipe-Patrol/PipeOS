"""HTTP and WebSocket surface. Routers reach hardware only through deps.get_robot."""

from pipepatrol.api import control, media, runs, system

ROUTERS = (system.router, control.router, media.router, runs.router)

__all__ = ["ROUTERS", "control", "media", "runs", "system"]
