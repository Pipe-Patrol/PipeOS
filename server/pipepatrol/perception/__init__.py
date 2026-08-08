"""Defect detection: the interface, and the model that fills it."""

from pipepatrol.perception.detector import Detection, DetectionService, NullDetector
from pipepatrol.perception.rfdetr import RfDetrDetector

__all__ = ["Detection", "DetectionService", "NullDetector", "RfDetrDetector"]


def best_detector():
    """The real model if it is installed and loadable, otherwise nothing.

    Chosen here rather than in robot.py so there is one place that decides, and
    so the reason a model is absent survives into the telemetry the console
    shows -- "no model at /path" is something an operator can act on, where a
    silently missing backend is not.
    """
    detector = RfDetrDetector()
    if detector.available:
        return detector
    return NullDetector(note=detector.error)
