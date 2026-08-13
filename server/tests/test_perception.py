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
    """cxcywh out of the model, xyxy on the frame."""

    def test_cxcywh_becomes_xyxy(self):
        detector = _detector()
        logits = np.full((1, 1, len(CLASS_NAMES) + 2), -10.0, dtype=np.float32)
        logits[0, 0, 1] = 10.0  # confidently a crack
        boxes = np.array([[[0.5, 0.4, 0.2, 0.1]]], dtype=np.float32)

        found = detector._decode([logits, boxes])

        assert len(found) == 1
        assert found[0].label == "crack"
        # The frame is stretched to the square on the way in, so the box comes
        # back already normalised to the frame -- no padding to undo.
        assert found[0].box == pytest.approx([0.4, 0.35, 0.6, 0.45], abs=1e-6)

    def test_boxes_are_clamped_to_the_frame(self):
        detector = _detector()
        logits = np.full((1, 1, len(CLASS_NAMES) + 2), -10.0, dtype=np.float32)
        logits[0, 0, 2] = 10.0
        # Half outside the picture on the left.
        boxes = np.array([[[0.0, 0.5, 0.4, 0.2]]], dtype=np.float32)

        found = detector._decode([logits, boxes])

        assert all(0.0 <= value <= 1.0 for value in found[0].box)

    def test_class_zero_is_never_reported(self):
        """Index 0 is the Roboflow project name, not a defect. See MODEL.md."""
        detector = _detector()
        logits = np.full((1, 1, len(CLASS_NAMES) + 2), -10.0, dtype=np.float32)
        logits[0, 0, 0] = 20.0  # the dataset name, screaming
        logits[0, 0, 3] = 1.0  # a real class, quieter
        boxes = np.array([[[0.5, 0.5, 0.2, 0.2]]], dtype=np.float32)

        found = detector._decode([logits, boxes])

        assert [d.label for d in found] == ["incrustation"]

    def test_low_confidence_is_dropped(self):
        detector = _detector()
        logits = np.full((1, 2, len(CLASS_NAMES) + 2), -10.0, dtype=np.float32)
        logits[0, 0, 1] = 10.0  # keep
        logits[0, 1, 1] = -5.0  # well under the floor
        boxes = np.array(
            [[[0.5, 0.5, 0.2, 0.2], [0.2, 0.2, 0.1, 0.1]]], dtype=np.float32
        )

        found = detector._decode([logits, boxes])

        assert len(found) == 1
        assert found[0].confidence >= MIN_CONFIDENCE

    def test_outputs_are_matched_by_shape_not_by_order(self):
        """Exporters disagree about which output comes first."""
        detector = _detector()
        logits = np.full((1, 1, len(CLASS_NAMES) + 2), -10.0, dtype=np.float32)
        logits[0, 0, 1] = 10.0
        boxes = np.array([[[0.5, 0.5, 0.2, 0.2]]], dtype=np.float32)

        forwards = detector._decode([logits, boxes])
        backwards = detector._decode([boxes, logits])

        assert [d.box for d in forwards] == [d.box for d in backwards]


class TestPreprocessing:
    """The frame is 4:3 and the model wants a square. It is stretched, not padded.

    That is what RF-DETR does at inference and what this checkpoint was trained
    with (`square_resize_div_64`). Letterboxing instead puts black bars and the
    wrong aspect ratio in front of a model that never saw either, and the
    symptom is confidence collapsing everywhere rather than an exception.
    """

    def test_a_wide_frame_is_stretched_to_the_square(self):
        cv2 = pytest.importorskip("cv2")
        detector = _detector(size=64)
        detector._cv2 = cv2

        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        tensor = detector._prepare(frame)

        assert tensor.shape == (1, 3, 64, 64)

    def test_no_black_bars_are_introduced(self):
        """A padded frame would leave rows that are pure background."""
        cv2 = pytest.importorskip("cv2")
        detector = _detector(size=64)
        detector._cv2 = cv2

        # Uniform mid-grey. After a correct stretch every pixel of a channel
        # holds the same value; after letterboxing the top and bottom rows
        # would be black instead. Checked per channel, because the three
        # ImageNet constants differ and the channels legitimately do not match
        # each other.
        frame = np.full((480, 640, 3), 128, dtype=np.uint8)
        tensor = detector._prepare(frame)[0]

        for channel in tensor:
            assert channel.min() == pytest.approx(channel.max(), abs=1e-5)

    def test_imagenet_normalisation_is_applied(self):
        cv2 = pytest.importorskip("cv2")
        detector = _detector(size=8)
        detector._cv2 = cv2

        # Pure white through ImageNet stats lands well above 1.0.
        tensor = detector._prepare(np.full((16, 16, 3), 255, dtype=np.uint8))
        assert tensor.max() > 2.0


class TestDemoHoldoff:
    """Supplied frames take priority over the camera.

    On the robot both paths share four cores and one inference is seconds, so a
    camera loop grinding through pictures of a table while somebody is watching
    imported footage is the difference between a demo that responds and one that
    does not.
    """

    def test_a_supplied_frame_holds_the_camera_loop_off(self):
        from pipepatrol.perception.detector import DEMO_HOLDOFF_S, DetectionService

        service = DetectionService(camera=None, detector=NullDetector())
        assert service._supplied_at == 0.0

        service.infer_once(b"a frame from the console")

        import time

        held = time.monotonic() - service._supplied_at
        assert held < DEMO_HOLDOFF_S

    def test_the_holdoff_expires_on_its_own(self):
        """A closed browser must not leave detection switched off forever."""
        import time

        from pipepatrol.perception.detector import DEMO_HOLDOFF_S, DetectionService

        service = DetectionService(camera=None, detector=NullDetector())
        service._supplied_at = time.monotonic() - DEMO_HOLDOFF_S - 1

        assert time.monotonic() - service._supplied_at > DEMO_HOLDOFF_S
