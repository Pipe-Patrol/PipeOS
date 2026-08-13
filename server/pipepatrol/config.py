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


# Where the defect model runs. Empty means nowhere, and the robot drives,
# records and logs defects by hand exactly as it does with no model installed.
#
# It is not on the Pi. RF-DETR on a Pi 5 is seconds per frame with the cores
# pinned and the board hot, for a graph and a runtime that together cost most of
# a gigabyte of SD card. `server/detect-host.py` serves it from a laptop
# instead; deploy.sh fills this in with the address of whatever machine ran the
# deploy. See perception/remote.py.
DETECTOR_URL = os.environ.get("PIPEPATROL_DETECTOR_URL", "")

# May this machine load an ONNX graph and infer locally?
#
# Yes on a laptop, which is where detect-host.py and a local dev server run. The
# robot's systemd unit sets it to 0, and that is a latch rather than a
# preference: the deploy deletes server/model and uninstalls onnxruntime, and
# this makes sure a graph that reappears -- restored from a backup, copied over
# by hand, left behind by an older checkout -- cannot quietly put the Pi back to
# doing seconds-per-frame inference with its cores pinned. Off means off.
ALLOW_LOCAL_MODEL = os.environ.get("PIPEPATROL_LOCAL_MODEL", "1") != "0"

# The operator's override, set from the console's settings screen. It outranks
# the environment: the address baked in at deploy time is a starting guess, and
# a laptop that moved to a different network must be fixable without a redeploy
# and must survive the power-cycle that follows.
DETECTOR_HOST_FILE = DATA_DIR / "detector-host.txt"


def detector_url():
    """The configured detection host: the operator's, else the deploy's."""
    try:
        saved = DETECTOR_HOST_FILE.read_text().strip()
    except OSError:
        saved = ""
    return saved or DETECTOR_URL


def save_detector_url(url):
    """Persist the operator's choice. An empty string clears it back to the deploy's."""
    ensure_data_dir()
    url = (url or "").strip()
    if url:
        DETECTOR_HOST_FILE.write_text(f"{url}\n")
    else:
        DETECTOR_HOST_FILE.unlink(missing_ok=True)
    return detector_url()


def ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR
