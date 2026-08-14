"""HTTP and WebSocket surface. Routers reach hardware only through deps.get_robot."""

from pipepatrol.api import (
    control, media, portal, power, preflight, reasoning, runs, system,
)

ROUTERS = (
    system.router,
    control.router,
    media.router,
    portal.router,
    power.router,
    preflight.router,
    reasoning.router,
    runs.router,
)

__all__ = [
    "ROUTERS", "control", "media", "portal", "power", "preflight", "reasoning",
    "runs", "system",
]
