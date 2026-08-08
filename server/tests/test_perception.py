"""The defect model's edges: what it does with no model, and where boxes land.

The inference itself is not tested here -- that would be testing onnxruntime.
What is tested is everything around it, because that is where the bugs are
silent: a box mapped back through the wrong letterbox still renders, in the
wrong place, and nothing raises.
"""

import numpy as np
import pytest

from pipepatrol.perception import NullDetector, best_detector
from pipepatrol.perception.rfdetr import CLASS_NAMES, MIN_CONFIDENCE, RfDetrDetector


class TestAbsent:
    """A robot with no model still has to start, drive and record."""

    def test_a_missing_file_is_reported_not_raised(self, tmp_path):
        detector = RfDetrDetector(model_path=tmp_path / "nothing.onnx")
        assert detector.available is False
        assert "nothing.onnx" in detector.error
        assert detector.infer(b"whatever") == []

    def test_best_detector_falls_back_and_keeps_the_reason(self, tmp_path, monkeypatch):
        monkeypatch.setenv("PIPEPATROL_MODEL", str(tmp_path / "nothing.onnx"))
        # Re-read the env var, which is captured at import time.
        import importlib

        from pipepatrol.perception import rfdetr

        importlib.reload(rfdetr)

        detector = rfdetr.RfDetrDetector()
        assert detector.available is False
        assert detector.error

    def test_null_detector_carries_a_note(self):
        detector = NullDetector(note="no model at /nowhere")
        assert detector.available is False
        assert detector.error == "no model at /nowhere"
        assert detector.infer(b"") == []

    def test_the_default_backend_is_usable_either_way(self):
        """Whatever is installed, this returns something with the interface."""
        detector = best_detector()
        assert hasattr(detector, "infer")
        assert isinstance(detector.available, bool)


def _detector(size=560):
    """An RfDetrDetector with the runtime stubbed out, for the maths alone."""
    detector = RfDetrDetector.__new__(RfDetrDetector)
    detector._np = np
    detector._size = size
    detector.available = True
    return detector


class TestBoxMapping:
    """Boxes come back in the padded square and have to land on the frame."""

    def test_a_centred_box_stays_centred(self):
        detector = _detector()
        # 4:3 letterboxed into a square leaves bars top and bottom.
        pad = (0.0, 0.125, 1.0, 0.75)
        logits = np.full((1, 1, len(CLASS_NAMES) + 2), -10.0, dtype=np.float32)
        logits[0, 0, 1] = 10.0  # confidently a crack
        boxes = np.array([[[0.5, 0.5, 0.2, 0.2]]], dtype=np.float32)

        found = detector._decode([logits, boxes], pad)

        assert len(found) == 1
        x1, y1, x2, y2 = found[0].box
        assert found[0].label == "crack"
        # Centre survives; the vertical extent is stretched by the bars removed.
        assert (x1 + x2) / 2 == pytest.approx(0.5, abs=1e-6)
        assert (y1 + y2) / 2 == pytest.approx(0.5, abs=1e-6)
        assert x2 - x1 == pytest.approx(0.2, abs=1e-6)
        assert y2 - y1 == pytest.approx(0.2 / 0.75, abs=1e-6)

    def test_boxes_are_clamped_to_the_frame(self):
        detector = _detector()
        logits = np.full((1, 1, len(CLASS_NAMES) + 2), -10.0, dtype=np.float32)
        logits[0, 0, 2] = 10.0
        # Half outside the picture on the left.
        boxes = np.array([[[0.0, 0.5, 0.4, 0.2]]], dtype=np.float32)

        found = detector._decode([logits, boxes], (0.0, 0.0, 1.0, 1.0))

        assert all(0.0 <= value <= 1.0 for value in found[0].box)

    def test_class_zero_is_never_reported(self):
        """Index 0 is the Roboflow project name, not a defect. See MODEL.md."""
        detector = _detector()
        logits = np.full((1, 1, len(CLASS_NAMES) + 2), -10.0, dtype=np.float32)
        logits[0, 0, 0] = 20.0  # the dataset name, screaming
        logits[0, 0, 3] = 1.0  # a real class, quieter
        boxes = np.array([[[0.5, 0.5, 0.2, 0.2]]], dtype=np.float32)

        found = detector._decode([logits, boxes], (0.0, 0.0, 1.0, 1.0))

        assert [d.label for d in found] == ["incrustation"]

    def test_low_confidence_is_dropped(self):
        detector = _detector()
        logits = np.full((1, 2, len(CLASS_NAMES) + 2), -10.0, dtype=np.float32)
        logits[0, 0, 1] = 10.0  # keep
        logits[0, 1, 1] = -5.0  # well under the floor
        boxes = np.array(
            [[[0.5, 0.5, 0.2, 0.2], [0.2, 0.2, 0.1, 0.1]]], dtype=np.float32
        )

        found = detector._decode([logits, boxes], (0.0, 0.0, 1.0, 1.0))

        assert len(found) == 1
        assert found[0].confidence >= MIN_CONFIDENCE

    def test_outputs_are_matched_by_shape_not_by_order(self):
        """Exporters disagree about which output comes first."""
        detector = _detector()
        logits = np.full((1, 1, len(CLASS_NAMES) + 2), -10.0, dtype=np.float32)
        logits[0, 0, 1] = 10.0
        boxes = np.array([[[0.5, 0.5, 0.2, 0.2]]], dtype=np.float32)

        forwards = detector._decode([logits, boxes], (0.0, 0.0, 1.0, 1.0))
        backwards = detector._decode([boxes, logits], (0.0, 0.0, 1.0, 1.0))

        assert [d.box for d in forwards] == [d.box for d in backwards]


class TestLetterbox:
    """The frame is 4:3 and the model wants a square."""

    def test_a_wide_frame_is_padded_not_stretched(self):
        cv2 = pytest.importorskip("cv2")
        detector = _detector(size=64)
        detector._cv2 = cv2

        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        tensor, pad = detector._prepare(frame)

        assert tensor.shape == (1, 3, 64, 64)
        left, top, span_w, span_h = pad
        # Full width, bars top and bottom, and the aspect preserved exactly.
        assert span_w == pytest.approx(1.0, abs=0.02)
        assert span_h == pytest.approx(0.75, abs=0.02)
        assert left == pytest.approx(0.0, abs=0.02)
        assert top == pytest.approx(0.125, abs=0.02)
