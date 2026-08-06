"""Run storage. The failure it is built around is the power going out."""

import json

import pytest

from pipepatrol.runs import export
from pipepatrol.runs.models import Defect, Run
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

        assert "chainage_uncertainty_m" not in text
        assert "1.5" not in text

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
