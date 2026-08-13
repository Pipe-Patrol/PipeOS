"""The model catalogue: what can be served, and what happens when it cannot.

Neither model is loaded here -- one needs an ONNX graph, the other needs torch
and a checkpoint, and a test suite that required either would only run on the
machine that had them. What is tested is that choosing badly is survivable,
because the chooser is a button an operator presses mid-run.
"""

from pipepatrol.perception import catalogue


class TestCatalogue:
    def test_every_entry_can_be_built(self):
        """Whatever is installed, building an entry returns a usable backend."""
        for entry in catalogue.CATALOGUE:
            detector = catalogue.build(entry["id"])
            assert hasattr(detector, "infer")
            assert isinstance(detector.available, bool)

    def test_an_unknown_id_is_refused_not_raised(self):
        detector = catalogue.build("something-newton-added")
        assert detector.available is False
        assert "something-newton-added" in detector.error

    def test_the_torch_model_says_what_it_is_missing(self, monkeypatch):
        monkeypatch.delenv("PIPEPATROL_WEIGHTS", raising=False)
        detector = catalogue.build("rfdetr-torch")
        assert detector.available is False
        # Actionable: the operator can go and set it.
        assert "PIPEPATROL_WEIGHTS" in detector.error

    def test_a_checkpoint_that_is_not_there_is_reported(self, monkeypatch, tmp_path):
        monkeypatch.setenv("PIPEPATROL_WEIGHTS", str(tmp_path / "nothing.pth"))
        detector = catalogue.build("rfdetr-torch")
        assert detector.available is False
        assert "nothing.pth" in detector.error

    def test_the_default_is_honest_when_nothing_is_installed(self, monkeypatch, tmp_path):
        monkeypatch.delenv("PIPEPATROL_WEIGHTS", raising=False)
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
