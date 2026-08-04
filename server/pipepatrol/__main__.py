"""`python -m pipepatrol` — run the server.

ws_ping_interval is off because the console sends its own pings and times the
round trip from them. Two ping mechanisms would just be noise on the socket.
"""

import sys

import uvicorn

from pipepatrol import config
from pipepatrol.app import app, configure_logging


def main():
    configure_logging()
    try:
        uvicorn.run(
            app,
            host=config.HOST,
            port=config.PORT,
            log_level="info",
            ws_ping_interval=None,
        )
    finally:
        # uvicorn has already run the lifespan shutdown by here; this is the
        # backstop for the paths where it did not get that far.
        robot = getattr(app.state, "robot", None)
        if robot is not None:
            robot.close("main exit")
        sys.exit(0)


if __name__ == "__main__":
    main()
