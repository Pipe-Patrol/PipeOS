"""The model catalogue: what can be served, and what happens when it cannot.

Neither model is loaded here -- one needs an ONNX graph, the other needs torch
and a checkpoint, and a test suite that required either would only run on the
machine that had them. What is tested is that choosing badly is survivable,
because the chooser is a button an operator presses mid-run.
"""

import inspect

from pipepatrol.perception import catalogue


class TestCatalogue:
    def test_every_entry_satisfies_the_backend_contract(self, monkeypatch, tmp_path):
        """name, available, error, and infer(jpeg, min_confidence).

        Checked with each model both absent AND present, because they take
        different code paths and the interesting one is present: a backend
        missing `error` only breaks once somebody installs it, so a catalogue
        that is empty on the test machine proves nothing.
        """
        monkeypatch.setattr(catalogue, "MODEL_DIR", tmp_path)

        for present in (False, True):
            if present:
                (tmp_path / "checkpoint.pth").write_bytes(b"stand-in")
                (tmp_path / "bank.npz").write_bytes(b"stand-in")

            for entry in catalogue.CATALOGUE:
                detector = catalogue.build(entry["id"])
                assert isinstance(detector.name, str)
                assert isinstance(detector.available, bool)
                # The one that was missing: read, not just present, because a
                # property that raises passes hasattr in the wrong way.
                assert detector.error is None or isinstance(detector.error, str)

                signature = inspect.signature(detector.infer)
                assert "min_confidence" in signature.parameters

    def test_describe_survives_a_model_that_is_installed(self, monkeypatch, tmp_path):
        """What actually broke: describe() reads .error off every backend."""
        monkeypatch.setattr(catalogue, "MODEL_DIR", tmp_path)
        (tmp_path / "checkpoint.pth").write_bytes(b"stand-in")

        entries = catalogue.describe("rfdetr-onnx", catalogue.build("rfdetr-onnx"))

        torch_entry = next(e for e in entries if e["id"] == "rfdetr-torch")
        assert torch_entry["available"] is True

    def test_an_unknown_id_is_refused_not_raised(self):
        detector = catalogue.build("something-newton-added")
        assert detector.available is False
        assert "something-newton-added" in detector.error

    def test_the_torch_model_says_where_to_put_the_checkpoint(self, monkeypatch, tmp_path):
        """The instruction is "drop a file here", not "export a variable"."""
        monkeypatch.delenv("PIPEPATROL_WEIGHTS", raising=False)
        monkeypatch.setattr(catalogue, "MODEL_DIR", tmp_path)

        detector = catalogue.build("rfdetr-torch")

        assert detector.available is False
        assert str(tmp_path) in detector.error

    def test_a_checkpoint_dropped_in_is_found_with_no_restart(self, monkeypatch, tmp_path):
        monkeypatch.delenv("PIPEPATROL_WEIGHTS", raising=False)
        monkeypatch.setattr(catalogue, "MODEL_DIR", tmp_path)
        assert catalogue.find_weights() is None

        (tmp_path / "checkpoint_best_total.pth").write_bytes(b"not really a checkpoint")

        # Nothing was reloaded, restarted or re-exported between these two lines,
        # which is the whole point: installing a model is copying a file.
        assert catalogue.find_weights().name == "checkpoint_best_total.pth"

    def test_the_newest_checkpoint_wins(self, monkeypatch, tmp_path):
        """Two in the folder means the one just copied in is the one meant."""
        import os
        import time

        monkeypatch.delenv("PIPEPATROL_WEIGHTS", raising=False)
        monkeypatch.setattr(catalogue, "MODEL_DIR", tmp_path)

        old = tmp_path / "aaa-old.pth"
        new = tmp_path / "zzz-new.pth"
        old.write_bytes(b"old")
        new.write_bytes(b"new")
        os.utime(old, (time.time() - 9000, time.time() - 9000))

        assert catalogue.find_weights().name == "zzz-new.pth"

    def test_an_explicit_path_still_wins(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PIPEPATROL_WEIGHTS", str(tmp_path / "nothing.pth"))
        monkeypatch.setattr(catalogue, "MODEL_DIR", tmp_path)
        (tmp_path / "ignored.pth").write_bytes(b"x")

        assert catalogue.find_weights() is None

    def test_the_anomaly_bank_is_optional(self, monkeypatch, tmp_path):
        monkeypatch.delenv("PIPEPATROL_ANOMALY_BANK", raising=False)
        monkeypatch.setattr(catalogue, "MODEL_DIR", tmp_path)
        assert catalogue.find_anomaly_bank() is None

        (tmp_path / "clean-pipe.npz").write_bytes(b"x")
        assert catalogue.find_anomaly_bank().endswith("clean-pipe.npz")

    def test_the_default_is_honest_when_nothing_is_installed(self, monkeypatch, tmp_path):
        monkeypatch.delenv("PIPEPATROL_WEIGHTS", raising=False)
        monkeypatch.setattr(catalogue, "MODEL_DIR", tmp_path)
        monkeypatch.setenv("PIPEPATROL_MODEL", str(tmp_path / "nothing.onnx"))
        import importlib

        from pipepatrol.perception import rfdetr

        importlib.reload(rfdetr)

        model_id, detector = catalogue.build_default()

        assert model_id is None
        assert detector.available is False
        # Both reasons, not just the first: "no model installed" on its own does
        # not say which of the two to go and fix.
        assert "rfdetr-onnx" in detector.error
        assert "rfdetr-torch" in detector.error

    def test_describe_marks_the_selected_one(self):
        detector = catalogue.build("rfdetr-onnx")
        entries = catalogue.describe("rfdetr-onnx", detector)

        assert [e["id"] for e in entries] == [e["id"] for e in catalogue.CATALOGUE]
        assert [e["selected"] for e in entries] == [True, False]
        assert all("available" in e and "note" in e for e in entries)

    def test_labels_match_what_the_console_keys_on(self):
        """A short code here silently loses the box colour and the mute toggle."""
        from pipepatrol.perception.model import LABELS
        from pipepatrol.perception.rfdetr import CLASS_NAMES

        assert LABELS == CLASS_NAMES
