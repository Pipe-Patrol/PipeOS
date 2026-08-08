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
import threading

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


def _command(video_paths, fps):
    """One ffmpeg invocation for however many clips the run holds.

    JOINED BY CONCATENATING THE INPUT, not with ffmpeg's concat demuxer. Raw
    MJPEG is just JPEGs end to end, so two clips appended byte-for-byte are a
    valid MJPEG stream of both -- the format has no header or index to merge.
    That means one `-i` reading a pipe we feed, rather than a temporary list
    file on a card we are trying not to write to.
    """
    del video_paths  # fed on stdin; see _feed
    return [
        FFMPEG,
        "-loglevel", "error",
        "-f", "mjpeg",
        "-framerate", f"{fps:.3f}",
        "-i", "pipe:0",
        "-c:v", "copy",
        # Fragmented, so the file is valid from the first bytes out. A normal
        # MOV puts its index at the end, which cannot be written until the whole
        # thing is done -- fine for a file, useless for a stream.
        "-movflags", "frag_keyframe+empty_moov",
        "-f", "mov",
        "pipe:1",
    ]


def remux(video_paths, fps):
    """Yield one playable MOV covering every clip, in order.

    `video_paths` may be a single path or a list of them. A run can hold several
    recordings -- the operator stops and starts as they work -- and what they
    want out of it is the run, not the last clip of it.
    """
    if not isinstance(video_paths, (list, tuple)):
        video_paths = [video_paths]
    paths = [path for path in video_paths if path.is_file()]
    if not paths:
        return

    process = subprocess.Popen(
        _command(paths, fps),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # Fed from a thread: ffmpeg will not drain stdin while nothing is reading
    # its stdout, so writing the clips inline here would deadlock on the first
    # pipe buffer that fills.
    feeder = threading.Thread(
        target=_feed, args=(process, paths), name="remux-feed", daemon=True
    )
    feeder.start()

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
        feeder.join(timeout=5)
        if process.returncode not in (0, None) and process.returncode > 0:
            log.warning("ffmpeg exited %s converting %s", process.returncode, paths)


def _feed(process, paths):
    """Write every clip into ffmpeg's stdin, in order, then close it."""
    try:
        for path in paths:
            with path.open("rb") as clip:
                shutil.copyfileobj(clip, process.stdin, CHUNK_BYTES)
    except (BrokenPipeError, OSError):
        # The client hung up, or ffmpeg died. Either way there is nothing to
        # write to and nothing useful to say about it.
        pass
    finally:
        try:
            process.stdin.close()
        except (BrokenPipeError, OSError):
            pass
