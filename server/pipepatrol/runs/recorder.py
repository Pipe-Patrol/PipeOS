"""Video recording, by writing the JPEGs down exactly as they arrive.

Format: every frame concatenated into one `.mjpeg` file, with a sidecar JSON
index of byte offsets and timestamps.

WHY NOT MP4. Re-encoding costs CPU the Pi does not have spare -- it is already
running optical flow and, soon, inference, and a dropped frame in the estimator
is worse than an awkward container. Appending bytes the camera already encoded
costs essentially nothing. Convert afterwards on a real machine:

    ffmpeg -f mjpeg -i video.mjpeg run.mp4

The index is what makes the file seekable, and it is flushed periodically rather
than only at stop, because the failure this has to survive is the power cut.
"""

import json
import logging
import os
import threading
import time

from pipepatrol.runs.models import Recording

log = logging.getLogger(__name__)

VIDEO_FILE = "video.mjpeg"
INDEX_FILE = "video.index.json"

# Cap the write rate. The camera runs faster than a recording needs to, and disk
# on a Pi is an SD card with a finite write budget.
MAX_RECORD_HZ = 15.0

# Flush the index this often, so a crash costs seconds of seekability, not a run.
INDEX_FLUSH_INTERVAL_S = 5.0


class Recorder:
    """Appends camera frames to disk for the duration of a run.

    One recording at a time; starting a second stops the first.
    """

    def __init__(self, camera, store):
        self._camera = camera
        self._store = store
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self._run_id = None
        self._frames = 0
        self._bytes = 0
        self._started_at = None
        self._error = None

    @property
    def active(self):
        return self._thread is not None

    def start(self, run_id):
        with self._lock:
            if self._thread is not None:
                self._stop_locked()
            if not self._camera.available:
                self._error = "camera unavailable"
                return None

            self._run_id = run_id
            self._frames = 0
            self._bytes = 0
            self._started_at = time.time()
            self._error = None
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._run, name="recorder", daemon=True
            )
            self._thread.start()
            log.info("recording started for run %s", run_id)
            return self.status()

    def stop(self):
        with self._lock:
            return self._stop_locked()

    def _stop_locked(self):
        if self._thread is None:
            return None
        self._stop.set()
        self._thread.join(timeout=5.0)
        self._thread = None
        recording = Recording(
            file=VIDEO_FILE,
            index_file=INDEX_FILE,
            frames=self._frames,
            bytes=self._bytes,
        )
        self._store.update(self._run_id, recording=recording)
        log.info(
            "recording stopped: %d frames, %.1f MB", self._frames, self._bytes / 1e6
        )
        self._run_id = None
        return recording

    def _run(self):
        directory = self._store.run_dir(self._run_id)
        directory.mkdir(parents=True, exist_ok=True)
        video_path = directory / VIDEO_FILE
        index_path = directory / INDEX_FILE

        interval = 1.0 / MAX_RECORD_HZ
        index = []
        offset = 0
        seen = None
        last_flush = time.monotonic()

        try:
            with video_path.open("wb") as video:
                while not self._stop.is_set():
                    output = self._camera.raw_output()
                    if output is None:
                        self._stop.wait(0.5)
                        continue

                    frame, seen = output.wait_for_frame(timeout=1.0, since=seen)
                    if frame is None:
                        continue

                    video.write(frame)
                    index.append(
                        {"offset": offset, "length": len(frame), "at": time.time()}
                    )
                    offset += len(frame)
                    self._frames += 1
                    self._bytes = offset

                    now = time.monotonic()
                    if now - last_flush >= INDEX_FLUSH_INTERVAL_S:
                        video.flush()
                        os.fsync(video.fileno())
                        _write_index(index_path, index)
                        last_flush = now

                    self._stop.wait(interval)

                video.flush()
                os.fsync(video.fileno())
        except OSError as exc:
            self._error = f"{type(exc).__name__}: {exc}"
            log.error("recording failed: %s", exc)

        _write_index(index_path, index)

    def status(self):
        return {
            "active": self._thread is not None,
            "run_id": self._run_id,
            "frames": self._frames,
            "bytes": self._bytes,
            "elapsed_s": (
                round(time.time() - self._started_at, 1) if self._started_at else None
            ),
            "error": self._error,
        }


def _write_index(path, index):
    temp = path.with_suffix(".tmp")
    try:
        with temp.open("w") as handle:
            json.dump(index, handle)
        os.replace(temp, path)
    except OSError as exc:
        log.warning("could not write video index: %s", exc)
