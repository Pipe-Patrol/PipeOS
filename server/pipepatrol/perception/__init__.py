"""Defect detection. Interface only -- see detector.py for why no model ships here."""

from pipepatrol.perception.detector import Detection, DetectionService, NullDetector

__all__ = ["Detection", "DetectionService", "NullDetector"]
