"""Inference over the network: parsing, failure, and what the robot does without it.

The model itself is not exercised here -- it is not on this machine and that is
the point. What is tested is the seam: a detection host's answer becoming
Detections, and every way that answer can fail to arrive leaving a robot that
still drives.
"""

import json
import urllib.error
from io import BytesIO

import pytest

from pipepatrol.perception import DetectionService, NullDetector
from pipepatrol.perception.detector import DETECTION_STALE_S
from pipepatrol.perception.remote import DEFAULT_PORT, RemoteDetector, normalise_url


class TestAddress:
    """Operators type a host into a field, not a URL."""

    @pytest.mark.parametrize(
        "typed",
        ["10.0.0.4", "10.0.0.4:8600", "http://10.0.0.4:8600", "http://10.0.0.4:8600/"],
    )
    def test_the_forms_people_type_all_mean_the_same_thing(self, typed):
        assert normalise_url(typed) == "http://10.0.0.4:8600"

    def test_a_named_host_gets_the_default_port(self):
        assert normalise_url("mymac.local") == f"http://mymac.local:{DEFAULT_PORT}"

    def test_an_explicit_port_is_kept(self):
        assert normalise_url("mymac.local:9000") == "http://mymac.local:9000"

    def test_nothing_means_nothing(self):
        assert normalise_url("") == ""
        assert normalise_url("   ") == ""
        assert normalise_url(None) == ""


def _responding(monkeypatch, payload=None, raises=None, body=b""):
    """Stand in for the detection host. Records what it was sent."""
    sent = {}

    class _Response:
        def __init__(self, data):
            self._data = data

        def read(self):
            return self._data

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    def _urlopen(request, timeout=None):  # noqa: ARG001
        sent["url"] = request.full_url
        sent["body"] = request.data
        if raises is not None:
            raise raises
        return _Response(body or json.dumps(payload).encode())

    monkeypatch.setattr("urllib.request.urlopen", _urlopen)
    return sent


class TestParsing:
    def test_a_hosts_answer_becomes_detections(self, monkeypatch):
        _responding(
            monkeypatch,
            {
                "ok": True,
                "detections": [
                    {"label": "crack", "confidence": 0.81, "box": [0.1, 0.2, 0.3, 0.4]},
                    {"label": "root intrusion", "confidence": 0.55, "box": None},
                ],
            },
        )

        found = RemoteDetector("10.0.0.4").infer(b"jpeg")

        assert [d.label for d in found] == ["crack", "root intrusion"]
        assert found[0].box == [0.1, 0.2, 0.3, 0.4]
        # Classified but not localised. Drawn as a list, never as an invented box.
        assert found[1].box is None

    def test_the_frame_is_posted_as_jpeg_to_the_hosts_detect_endpoint(self, monkeypatch):
        sent = _responding(monkeypatch, {"detections": []})

        RemoteDetector("mymac.local:8600").infer(b"\xff\xd8jpeg bytes")

        assert sent["url"] == "http://mymac.local:8600/api/detect"
        assert sent["body"] == b"\xff\xd8jpeg bytes"

    def test_a_confidence_floor_rides_along(self, monkeypatch):
        sent = _responding(monkeypatch, {"detections": []})

        RemoteDetector("10.0.0.4").infer(b"jpeg", min_confidence=0.0)

        assert sent["url"].endswith("/api/detect?min=0.0")

    def test_the_timestamp_is_the_robots_own(self, monkeypatch):
        """Two machines' clocks need not agree, and staleness is judged here."""
        _responding(
            monkeypatch,
            {"detections": [{"label": "crack", "confidence": 0.9, "at": 1.0}]},
        )

        import time

        found = RemoteDetector("10.0.0.4").infer(b"jpeg")

        assert found[0].at == pytest.approx(time.time(), abs=5)

    def test_one_bad_entry_does_not_discard_the_frame(self, monkeypatch):
        _responding(
            monkeypatch,
            {
                "detections": [
                    {"label": "crack", "confidence": "not a number"},
                    {"no": "label"},
                    {"label": "obstruction", "confidence": 0.7, "box": [0.1, 0.2]},
                    {"label": "deposition", "confidence": 0.6, "box": [0, 0, 1, 1]},
                ]
            },
        )

        found = RemoteDetector("10.0.0.4").infer(b"jpeg")

        assert [d.label for d in found] == ["obstruction", "deposition"]
        # A box of the wrong length is dropped rather than drawn somewhere.
        assert found[0].box is None


class TestFailure:
    """A laptop that is asleep, gone, or angry. None of it stops the robot."""

    def test_an_unreachable_host_is_reported_not_raised(self, monkeypatch):
        _responding(monkeypatch, raises=urllib.error.URLError("connection refused"))
        detector = RemoteDetector("10.0.0.4")

        assert detector.infer(b"jpeg") == []
        assert "cannot reach" in detector.error
        assert "10.0.0.4:8600" in detector.error

    def test_a_host_with_no_model_says_so(self, monkeypatch):
        _responding(
            monkeypatch,
            raises=urllib.error.HTTPError(
                "http://10.0.0.4:8600/api/detect",
                503,
                "Service Unavailable",
                {},
                BytesIO(b'{"error": "no model at pipe-defects.onnx"}'),
            ),
        )
        detector = RemoteDetector("10.0.0.4")

        assert detector.infer(b"jpeg") == []
        assert "503" in detector.error
        assert "pipe-defects.onnx" in detector.error

    def test_malformed_json_is_reported_not_raised(self, monkeypatch):
        _responding(monkeypatch, body=b"<html>proxy error</html>")
        detector = RemoteDetector("10.0.0.4")

        assert detector.infer(b"jpeg") == []
        assert "malformed JSON" in detector.error

    def test_a_recovered_host_clears_the_error(self, monkeypatch):
        detector = RemoteDetector("10.0.0.4")
        _responding(monkeypatch, raises=urllib.error.URLError("asleep"))
        detector.infer(b"jpeg")
        assert detector.error

        _responding(monkeypatch, {"detections": []})
        detector.infer(b"jpeg")
        assert detector.error is None

    def test_a_configured_host_stays_available_while_unreachable(self, monkeypatch):
        """The sampling loop only runs for an available backend.

        A laptop asleep at boot must not latch detection off for the whole run --
        wake it and detections have to resume without restarting the robot.
        """
        _responding(monkeypatch, raises=urllib.error.URLError("asleep"))
        detector = RemoteDetector("10.0.0.4")

        detector.infer(b"jpeg")

        assert detector.available is True

    def test_no_host_is_not_available(self):
        detector = RemoteDetector("")
        assert detector.available is False
        assert detector.infer(b"jpeg") == []


class TestOnlyTheLatestFrame:
    """Detections replace, they never pile up."""

    def test_a_new_result_replaces_the_previous_one(self):
        from pipepatrol.perception.detector import Detection

        service = DetectionService(camera=None, detector=NullDetector())
        service._detections = [Detection("crack", 0.9, [0, 0, 1, 1])]
        service._detections_at = _now()

        service._detections = [Detection("deposition", 0.8, [0, 0, 1, 1])]
        service._detections_at = _now()

        assert [d.label for d in service.active()] == ["deposition"]

    def test_a_frame_with_nothing_in_it_clears_the_overlay(self):
        """The case that used to leave stale boxes on the glass."""
        from pipepatrol.perception.detector import Detection

        service = DetectionService(camera=None, detector=NullDetector())
        service._detections = [Detection("crack", 0.9, [0, 0, 1, 1])]
        service._detections_at = _now()

        service._detections = []
        service._detections_at = _now()

        assert service.active() == []

    def test_results_that_stop_arriving_go_away_whole(self):
        from pipepatrol.perception.detector import Detection

        service = DetectionService(camera=None, detector=NullDetector())
        service._detections = [
            Detection("crack", 0.9, [0, 0, 1, 1]),
            Detection("deposition", 0.8, [0, 0, 1, 1]),
        ]
        service._detections_at = _now() - DETECTION_STALE_S - 1

        assert service.active() == []

    def test_a_retarget_drops_the_old_backends_findings(self):
        """They were judged by a different model on a different machine."""
        from pipepatrol.perception.detector import Detection

        service = DetectionService(camera=None, detector=NullDetector())
        service._detections = [Detection("crack", 0.9, [0, 0, 1, 1])]
        service._detections_at = _now()

        service.set_backend(NullDetector(note="switched"))

        assert service.active() == []


def _now():
    import time

    return time.time()
