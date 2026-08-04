"""Turning a recording into something a laptop will play.

The recording on disk is raw concatenated JPEGs (see recorder.py). Nothing on a
Mac or a Windows box opens that by double-clicking, so getting a run off the
robot meant ssh, ffmpeg and scp by hand, three commands and a wait.

REMUX, DO NOT RE-ENCODE. The frames are already JPEG, and MJPEG is a legal
codec inside a QuickTime container, so the conversion is a container rewrite --
no pixels are touched. Measured on this robot, a 149-second run:

    re-encode to H.264   28 s     20 MB
    remux to MOV          0.34 s  83 MB

Eighty times faster for a file four times bigger, over a LAN. That trade is
obvious in one direction, and it is the difference between a button that
responds and one that needs a progress bar and a job queue behind it.

STRAIGHT TO THE CLIENT, never to a file. The Pi boots off an SD card with a
finite write budget -- the same reason the recorder caps itself at 15 Hz -- and
writing another 83 MB every time somebody wants to watch a run would be a poor
way to spend it. ffmpeg writes to a pipe and the bytes go out as they arrive.

THE FRAME RATE IS NOT A GUESS. A raw MJPEG stream carries no timing at all, so
ffmpeg assumes 25 fps unless told otherwise; these recordings run at about 14.6,
which would play the run 70% fast and report the wrong duration. The real rate
is recoverable from the timestamps the recorder already writes into the index.
"""

import json
import logging
import shutil
import subprocess

log = logging.getLogger(__name__)

FFMPEG = "ffmpeg"
CHUNK_BYTES = 64 * 1024
# What to fall back to when the index cannot answer. Matches the recorder's cap,
# so a run recorded at the ceiling comes out right even with no index at all.
DEFAULT_FPS = 15.0
MEDIA_TYPE = "video/quicktime"


def available():
    """Whether ffmpeg is installed. The console hides the button if it is not."""
    return shutil.which(FFMPEG) is not None


def recorded_fps(index_path, default=DEFAULT_FPS):
    """The rate the run was actually captured at, from the index timestamps.

    Divided by one fewer than the frame count: n frames have n-1 gaps between
    them, and using n would stretch the duration by a frame's worth.
    """
    try:
        index = json.loads(index_path.read_text())
    except (OSError, ValueError) as exc:
        log.debug("no usable video index (%s); assuming %.1f fps", exc, default)
        return default

    if not isinstance(index, list) or len(index) < 2:
        return default

    try:
        span = float(index[-1]["at"]) - float(index[0]["at"])
    except (KeyError, TypeError, ValueError):
        return default

    if span <= 0:
        return default
    return (len(index) - 1) / span


def _command(video_path, fps):
    return [
        FFMPEG,
        "-loglevel", "error",
        "-f", "mjpeg",
        "-framerate", f"{fps:.3f}",
        "-i", str(video_path),
        "-c:v", "copy",
        # Fragmented, so the file is valid from the first bytes out. A normal
        # MOV puts its index at the end, which cannot be written until the whole
        # thing is done -- fine for a file, useless for a stream.
        "-movflags", "frag_keyframe+empty_moov",
        "-f", "mov",
        "pipe:1",
    ]


def remux(video_path, fps):
    """Yield a playable MOV of the recording, as ffmpeg produces it."""
    process = subprocess.Popen(
        _command(video_path, fps),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        while True:
            chunk = process.stdout.read(CHUNK_BYTES)
            if not chunk:
                break
            yield chunk
    finally:
        # Reached on a client disconnect as well as on success. Without this an
        # abandoned download leaves ffmpeg running against the card, and enough
        # of those would be a real load on a robot that is also driving.
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        for pipe in (process.stdout, process.stderr):
            if pipe is not None:
                pipe.close()
        if process.returncode not in (0, None) and process.returncode > 0:
            log.warning("ffmpeg exited %s converting %s", process.returncode, video_path)
