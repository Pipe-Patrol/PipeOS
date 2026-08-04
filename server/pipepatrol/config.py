"""Every knob the server has, in one file.

Environment variables win over the defaults so a Pi can be configured without
editing the checkout. Anything safety-related is deliberately NOT here -- the
motor limits live in hardware/drive.py and are not environment-tunable, because
a typo in a unit file must not be able to raise the duty ceiling.
"""

import os
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVER_ROOT.parent

# Runs, snapshots and recordings. Also the filesystem whose free space the
# console reports.
DATA_DIR = Path(os.environ.get("PIPEPATROL_DATA", SERVER_ROOT / "data"))

# The built console. Absent in development, where Vite serves it instead.
WEB_DIST = Path(os.environ.get("PIPEPATROL_WEB", REPO_ROOT / "web" / "dist"))

HOST = os.environ.get("PIPEPATROL_HOST", "0.0.0.0")
PORT = int(os.environ.get("PIPEPATROL_PORT", "8000"))

TELEMETRY_HZ = 10
# Faster than the 500 ms command timeout, so the watchdog catches it promptly
# rather than up to a full tick late.
WATCHDOG_HZ = 20

# The map samples the path by distance, not by time: a robot parked for two
# minutes should not add two minutes of identical points.
PATH_SAMPLE_INTERVAL_M = 0.25

# Cap on stored path points per run. At 0.25 m that is 500 m of pipe, well past
# any single run, and it bounds the JSON a long idle recording could produce.
PATH_MAX_POINTS = 2000


def ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR
