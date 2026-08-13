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
from pipepatrol.runs.models import Defect, Origin, Run, Snapshot

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

    def create(self, name="", origin=None):
        with self._lock:
            # Callers hand this in as a plain dict off the wire; normalise here
            # so nothing downstream has to check which shape it got.
            if isinstance(origin, dict):
                origin = Origin.from_dict(origin)
            run = Run(name=name or _default_name(), origin=origin)
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

    def add_recording(self, run_id, recording):
        """Append a finished clip. Runs may hold any number of them."""
        with self._lock:
            run = self._read(run_id)
            if run is None:
                return None
            run.recordings.append(recording)
            self._write(run)
            return recording

    def delete_recording(self, run_id, recording_id):
        """Drop one clip: its entry, its video, and its frame index.

        Video is almost all of what a run weighs -- a few minutes of MJPEG
        outruns every snapshot, defect and path point put together -- so this is
        the one delete that gets an SD card out of trouble. The run itself, its
        defects and its stills all survive, because the footage is the bulky
        part and rarely the part being reported on.

        Returns (deleted, freed_bytes). `deleted` is False for a clip that is
        not there, which a second click on a slow link would otherwise report
        as a failure.
        """
        with self._lock:
            run = self._read(run_id)
            if run is None:
                return False, 0

            match = next((r for r in run.recordings if r.id == recording_id), None)
            if match is None:
                return False, 0

            freed = self._unlink_clip(run_id, match)
            run.recordings = [r for r in run.recordings if r.id != recording_id]
            self._write(run)
            log.info("recording deleted: %s/%s (%d bytes)", run_id, recording_id, freed)
            return True, freed

    def delete_all_recordings(self):
        """Every clip of every run. Returns (runs_touched, clips, freed_bytes).

        The bulk version of the per-run button, for the case it exists to serve:
        a card that is full now, where going run by run is a dozen confirmations
        deep. Every run keeps its defects, stills and path -- this only ever
        removes video.
        """
        runs = clips = freed = 0
        for summary in self.list():
            count, bytes_freed = self.delete_recordings(summary["id"])
            if count:
                runs += 1
                clips += count
                freed += bytes_freed
        log.info("all video deleted: %d clips across %d runs (%d bytes)", clips, runs, freed)
        return runs, clips, freed

    def delete_recordings(self, run_id):
        """Every clip in the run. Returns (count, freed_bytes)."""
        with self._lock:
            run = self._read(run_id)
            if run is None or not run.recordings:
                return 0, 0

            freed = sum(self._unlink_clip(run_id, r) for r in run.recordings)
            count = len(run.recordings)
            run.recordings = []
            self._write(run)
            log.info("%d recordings deleted: %s (%d bytes)", count, run_id, freed)
            return count, freed

    def _unlink_clip(self, run_id, recording):
        """Remove a clip's files. Missing ones are fine -- the goal is absence.

        Deleting the files BEFORE rewriting run.json would strand them if the
        write then failed; deleting after means a crash in between leaves files
        with no entry, which costs space but never shows an operator a clip that
        will not play. Space is the cheaper failure.
        """
        directory = self.run_dir(run_id)
        freed = 0
        for name in (recording.file, recording.index_file):
            if not name:
                continue
            path = directory / name
            try:
                freed += path.stat().st_size
                path.unlink()
            except OSError:
                continue
        return freed

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
