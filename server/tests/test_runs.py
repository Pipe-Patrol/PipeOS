"""Run storage. The failure it is built around is the power going out."""

import json

import pytest

from pipepatrol.runs import export, recorder
from pipepatrol.runs.models import Defect, Recording, Run
from pipepatrol.runs.store import RunStore


@pytest.fixture
def store(tmp_path):
    return RunStore(root=tmp_path)


class TestLifecycle:
    def test_create_then_end(self, store):
        run = store.create("Elm Street MH12")
        assert run.interrupted is True

        ended = store.end(run.id, distance_m=12.4, uncertainty_m=1.1)
        assert ended.interrupted is False
        assert ended.distance_m == 12.4
        assert ended.uncertainty_m == 1.1

    def test_names_itself_when_unnamed(self, store):
        assert store.create().name.startswith("Run ")

    def test_listing_is_newest_first(self, store):
        first = store.create("first")
        second = store.create("second")
        store.update(second.id, started_at=first.started_at + 100)

        assert [r["id"] for r in store.list()] == [second.id, first.id]

    def test_delete_removes_the_directory(self, store):
        run = store.create("scratch")
        assert store.delete(run.id) is True
        assert store.get(run.id) is None
        assert store.run_dir(run.id).exists() is False

    def test_delete_of_a_missing_run_is_false_not_an_error(self, store):
        assert store.delete("nope") is False


class TestInterrupted:
    def test_a_run_that_was_never_ended_is_offered_back(self, store):
        crashed = store.create("crashed")
        finished = store.create("finished")
        store.end(finished.id)

        interrupted = store.interrupted()

        assert [r["id"] for r in interrupted] == [crashed.id]


class TestDefects:
    def test_added_and_read_back(self, store):
        run = store.create("run")
        defect = Defect(code="RB", severity=4, clock_position=12, chainage_m=8.2)
        store.add_defect(run.id, defect)

        reloaded = store.get(run.id)
        assert len(reloaded.defects) == 1
        assert reloaded.defects[0].code == "RB"
        assert reloaded.defects[0].chainage_m == 8.2

    def test_deleted_by_id(self, store):
        run = store.create("run")
        defect = Defect(code="OB")
        store.add_defect(run.id, defect)

        assert store.delete_defect(run.id, defect.id) is True
        assert store.get(run.id).defects == []
        assert store.delete_defect(run.id, defect.id) is False


class TestRecordings:
    """A run may hold several clips. It used to keep only the last one."""

    def test_every_clip_is_kept(self, store):
        run = store.create("run")
        store.add_recording(run.id, Recording(file="video.mjpeg", frames=10))
        store.add_recording(run.id, Recording(file="video-2.mjpeg", frames=20))

        reloaded = store.get(run.id)
        assert [r.file for r in reloaded.recordings] == ["video.mjpeg", "video-2.mjpeg"]
        assert reloaded.summary()["recording_count"] == 2

    def test_clips_get_their_own_files(self):
        assert recorder._clip_files(1) == ("video.mjpeg", "video.index.json")
        assert recorder._clip_files(2) == ("video-2.mjpeg", "video-2.index.json")
        # The first clip keeps the original names, so runs recorded before
        # multi-clip support still resolve.
        assert recorder._clip_files(1)[0] == recorder.VIDEO_FILE

    def test_a_run_stored_with_one_recording_still_loads(self, store):
        """The old single-clip shape on disk reads back as a one-item list."""
        run = store.create("run")
        path = store.run_dir(run.id) / "run.json"
        data = json.loads(path.read_text())
        data.pop("recordings", None)
        data["recording"] = {"file": "video.mjpeg", "index_file": "video.index.json"}
        path.write_text(json.dumps(data))

        reloaded = store.get(run.id)
        assert [r.file for r in reloaded.recordings] == ["video.mjpeg"]


class TestSnapshots:
    def test_written_to_disk_and_indexed(self, store):
        run = store.create("run")
        snapshot = store.add_snapshot(run.id, b"\xff\xd8jpeg-bytes", chainage_m=3.0)

        path = store.snapshot_path(run.id, snapshot.file)
        assert path.read_bytes() == b"\xff\xd8jpeg-bytes"
        assert store.get(run.id).snapshots[0].chainage_m == 3.0


class TestDurability:
    def test_writes_leave_no_temp_file_behind(self, store):
        run = store.create("run")
        store.add_defect(run.id, Defect(code="FS"))

        leftovers = list(store.run_dir(run.id).glob("*.tmp"))
        assert leftovers == []

    def test_a_corrupt_run_is_skipped_not_fatal(self, store):
        good = store.create("good")
        broken = store.create("broken")
        (store.run_dir(broken.id) / "run.json").write_text("{ not json")

        assert [r["id"] for r in store.list()] == [good.id]
        assert store.get(broken.id) is None

    def test_unknown_fields_survive_a_round_trip_as_defaults(self, store):
        # A run written by an older version must still load.
        run = store.create("legacy")
        path = store.run_dir(run.id) / "run.json"
        data = json.loads(path.read_text())
        del data["uncertainty_m"]
        del data["path"]
        path.write_text(json.dumps(data))

        reloaded = store.get(run.id)
        assert reloaded.uncertainty_m == 0.0
        assert reloaded.path == []


class TestExport:
    def test_csv_carries_the_chainage(self):
        run = Run(name="run")
        run.defects.append(
            Defect(code="RB", chainage_m=10.0, chainage_uncertainty_m=1.5)
        )

        text = export.to_csv(run).decode()

        header, row = text.splitlines()[0], text.splitlines()[1]
        assert "chainage_m" in header
        assert "10.0" in row

    def test_csv_leaves_the_uncertainty_out(self):
        """It is still recorded, and still in the JSON. It is not a column an
        inspector fills a report out of."""
        run = Run(name="run")
        run.defects.append(
            Defect(code="RB", chainage_m=10.0, chainage_uncertainty_m=1.5)
        )

        text = export.to_csv(run).decode()
        header, row = text.splitlines()[0], text.splitlines()[1]

        assert "chainage_uncertainty_m" not in header
        # Checked per field rather than as a substring of the whole row: the
        # first column is a timestamp, and an epoch second beginning "1.5" made
        # this fail roughly one run in ten for a reason that had nothing to do
        # with the uncertainty.
        assert "1.5" not in row.split(",")

    def test_the_uncertainty_is_still_in_the_json(self):
        run = Run(name="run")
        run.defects.append(
            Defect(code="RB", chainage_m=10.0, chainage_uncertainty_m=1.5)
        )

        data = json.loads(export.to_json(run))

        assert data["defects"][0]["chainage_uncertainty_m"] == 1.5

    def test_json_is_the_whole_run(self):
        run = Run(name="run", distance_m=5.0)
        data = json.loads(export.to_json(run))
        assert data["name"] == "run"
        assert data["distance_m"] == 5.0

    def test_zip_contains_metadata_and_images(self, store):
        import io
        import zipfile

        run = store.create("zip me")
        store.add_snapshot(run.id, b"\xff\xd8image")
        loaded = store.get(run.id)

        archive = zipfile.ZipFile(io.BytesIO(export.to_zip(loaded, store)))
        names = archive.namelist()

        assert "run.json" in names
        assert "defects.csv" in names
        assert any(n.startswith("snapshots/") for n in names)

    def test_filename_is_filesystem_safe(self):
        run = Run(name="Elm St / MH-12: north")
        assert "/" not in export.filename_for(run, "csv")
        assert export.filename_for(run, "csv").endswith(".csv")


class TestDeletingVideo:
    """Video is almost all of what a run weighs, and the only part worth deleting.

    Deleting it must never take the inspection record with it: the defects, the
    stills and the path are what somebody is going to be asked for, and they are
    small enough that keeping them costs nothing.
    """

    def _recorded(self, store, count=2):
        from pipepatrol.runs.models import Recording

        run = store.create(name="with video")
        directory = store.run_dir(run.id)
        directory.mkdir(parents=True, exist_ok=True)

        clips = []
        for index in range(count):
            clip = Recording(frames=10, bytes=1000)
            clip.file = f"clip{index}.mjpeg"
            clip.index_file = f"clip{index}.idx"
            (directory / clip.file).write_bytes(b"x" * 1000)
            (directory / clip.index_file).write_bytes(b"i" * 10)
            store.add_recording(run.id, clip)
            clips.append(clip)
        return run, clips

    def test_one_clips_files_go_with_its_entry(self, store):
        run, clips = self._recorded(store)
        directory = store.run_dir(run.id)

        deleted, freed = store.delete_recording(run.id, clips[0].id)

        assert deleted is True
        assert freed == 1010
        assert not (directory / clips[0].file).exists()
        assert not (directory / clips[0].index_file).exists()
        # The other clip is untouched.
        assert (directory / clips[1].file).exists()
        assert [r.id for r in store.get(run.id).recordings] == [clips[1].id]

    def test_deleting_all_clips_keeps_the_run(self, store):
        run, _ = self._recorded(store)
        store.add_defect(
            run.id, __import__("pipepatrol.runs.models", fromlist=["Defect"]).Defect(code="CR")
        )

        count, freed = store.delete_recordings(run.id)

        assert count == 2
        assert freed == 2020
        after = store.get(run.id)
        assert after is not None
        assert after.recordings == []
        # The record survives. That is the whole point of deleting video rather
        # than deleting the run.
        assert len(after.defects) == 1

    def test_a_clip_that_is_not_there_is_not_an_error_state(self, store):
        run, _ = self._recorded(store)
        deleted, freed = store.delete_recording(run.id, "nosuchclip")
        assert deleted is False
        assert freed == 0

    def test_deleting_all_of_nothing_is_fine(self, store):
        run = store.create(name="no video")
        assert store.delete_recordings(run.id) == (0, 0)

    def test_missing_files_do_not_stop_the_entry_going(self, store):
        """A clip whose file was already removed by hand must still be clearable."""
        run, clips = self._recorded(store, count=1)
        (store.run_dir(run.id) / clips[0].file).unlink()

        deleted, _ = store.delete_recording(run.id, clips[0].id)

        assert deleted is True
        assert store.get(run.id).recordings == []
