"""Runs on disk, on the Pi.

The robot owns the recording. PipePatrolApp kept runs in the browser's
IndexedDB, which breaks the moment a second device opens the console -- and an
iPad is an explicit target. A run is a directory:

    data/runs/<run_id>/
        run.json            metadata, defects, snapshot index, sampled path
        snapshots/<id>.jpg
        video.mjpeg         concatenated JPEGs, if recording was on
        video.index.json    byte offsets and timestamps into video.mjpeg

Every write to run.json goes through a temp file and os.replace, so a power cut
mid-write leaves the previous version intact rather than a truncated one. That
matters more than usual here: the power cut is the *expected* failure, not a
remote one.
"""

import json
import logging
import os
import shutil
import threading
import time

from pipepatrol import config
from pipepatrol.runs.models import Defect, Run, Snapshot

log = logging.getLogger(__name__)

RUN_FILE = "run.json"
SNAPSHOT_DIR = "snapshots"


class RunStore:
    """Thread-safe access to the run directory.

    One lock over all of it. The write rate is a few operations a second at
    most, so finer-grained locking would buy nothing and cost correctness.
    """

    def __init__(self, root=None):
        self._root = (root or config.DATA_DIR) / "runs"
        self._root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    # --- paths ---

    def run_dir(self, run_id):
        return self._root / run_id

    def snapshot_path(self, run_id, filename):
        return self.run_dir(run_id) / SNAPSHOT_DIR / filename

    # --- reading ---

    def list(self):
        """Run summaries, newest first. Unreadable runs are skipped, not fatal."""
        summaries = []
        with self._lock:
            for entry in self._root.iterdir():
                if not entry.is_dir():
                    continue
                run = self._read(entry.name)
                if run is not None:
                    summaries.append(run.summary())
        summaries.sort(key=lambda r: r["started_at"], reverse=True)
        return summaries

    def get(self, run_id):
        with self._lock:
            return self._read(run_id)

    def interrupted(self):
        """Runs that were never ended. Offered back to the operator on connect."""
        return [r for r in self.list() if r["interrupted"]]

    def _read(self, run_id):
        path = self.run_dir(run_id) / RUN_FILE
        try:
            with path.open() as handle:
                return Run.from_dict(json.load(handle))
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as exc:
            log.warning("run %s is unreadable: %s", run_id, exc)
            return None

    # --- writing ---

    def create(self, name=""):
        with self._lock:
            run = Run(name=name or _default_name())
            directory = self.run_dir(run.id)
            (directory / SNAPSHOT_DIR).mkdir(parents=True, exist_ok=True)
            self._write(run)
            log.info("run started: %s (%s)", run.name, run.id)
            return run

    def update(self, run_id, **fields):
        """Patch top-level fields. Unknown names are ignored, not an error."""
        with self._lock:
            run = self._read(run_id)
            if run is None:
                return None
            for key, value in fields.items():
                if hasattr(run, key):
                    setattr(run, key, value)
            self._write(run)
            return run

    def end(self, run_id, distance_m=None, uncertainty_m=None):
        with self._lock:
            run = self._read(run_id)
            if run is None:
                return None
            run.ended_at = time.time()
            if distance_m is not None:
                run.distance_m = distance_m
            if uncertainty_m is not None:
                run.uncertainty_m = uncertainty_m
            self._write(run)
            log.info("run ended: %s (%.1f s)", run.id, run.duration_s)
            return run

    def add_defect(self, run_id, defect: Defect):
        with self._lock:
            run = self._read(run_id)
            if run is None:
                return None
            run.defects.append(defect)
            self._write(run)
            return defect

    def delete_defect(self, run_id, defect_id):
        with self._lock:
            run = self._read(run_id)
            if run is None:
                return False
            before = len(run.defects)
            run.defects = [d for d in run.defects if d.id != defect_id]
            if len(run.defects) == before:
                return False
            self._write(run)
            return True

    def add_snapshot(self, run_id, jpeg, chainage_m=None):
        """Write a still and index it. Returns the Snapshot, or None if no run."""
        with self._lock:
            run = self._read(run_id)
            if run is None:
                return None
            snapshot = Snapshot(chainage_m=chainage_m)
            snapshot.file = f"{snapshot.id}.jpg"
            directory = self.run_dir(run_id) / SNAPSHOT_DIR
            directory.mkdir(parents=True, exist_ok=True)
            (directory / snapshot.file).write_bytes(jpeg)
            run.snapshots.append(snapshot)
            self._write(run)
            return snapshot

    def delete(self, run_id):
        with self._lock:
            directory = self.run_dir(run_id)
            if not directory.is_dir():
                return False
            shutil.rmtree(directory)
            log.info("run deleted: %s", run_id)
            return True

    def _write(self, run):
        """Atomic. A power cut leaves the previous run.json, never half of one."""
        directory = self.run_dir(run.id)
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / RUN_FILE
        temp = directory / f"{RUN_FILE}.tmp"
        with temp.open("w") as handle:
            json.dump(run.as_dict(), handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, target)


def _default_name():
    return time.strftime("Run %Y-%m-%d %H:%M")
