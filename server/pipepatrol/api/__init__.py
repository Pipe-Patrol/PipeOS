"""HTTP and WebSocket surface. Routers reach hardware only through deps.get_robot."""

from pipepatrol.api import control, media, power, runs, system

ROUTERS = (system.router, control.router, media.router, power.router, runs.router)

__all__ = ["ROUTERS", "control", "media", "power", "runs", "system"]
