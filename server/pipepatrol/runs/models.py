"""What a run is made of.

Plain dataclasses with explicit serialisation rather than a schema library: this
is the on-disk format, and a run recorded last month has to still load after the
code changes. `from_dict` tolerates missing keys for exactly that reason.
"""

import time
import uuid
from dataclasses import asdict, dataclass, field


def _new_id():
    return uuid.uuid4().hex[:12]


@dataclass
class Snapshot:
    """A still the operator saved, or one captured alongside a defect."""

    id: str = field(default_factory=_new_id)
    at: float = field(default_factory=time.time)
    chainage_m: float | None = None
    file: str = ""

    def as_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, data):
        return cls(
            id=data.get("id", _new_id()),
            at=data.get("at", 0.0),
            chainage_m=data.get("chainage_m"),
            file=data.get("file", ""),
        )


@dataclass
class Defect:
    """An operator's confirmed observation.

    Outlives whatever prompted it -- a model detection, or nothing at all. The
    chainage is stamped from the odometer at the moment of logging and is an
    estimate; `chainage_uncertainty_m` travels with it so a report can say so.
    """

    id: str = field(default_factory=_new_id)
    at: float = field(default_factory=time.time)
    code: str = ""
    severity: int = 3
    # Clock-face position on the pipe wall, 1-12, 12 = crown. None when unplaced.
    clock_position: int | None = None
    note: str = ""
    chainage_m: float | None = None
    chainage_uncertainty_m: float | None = None
    snapshot_id: str | None = None
    # Set when the entry came from a model rather than from the operator.
    detection_id: str | None = None
    # Box the operator drew over the frame, normalised 0..1. None if not placed.
    region: dict | None = None

    def as_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, data):
        return cls(
            id=data.get("id", _new_id()),
            at=data.get("at", 0.0),
            code=data.get("code", ""),
            severity=int(data.get("severity", 3)),
            clock_position=data.get("clock_position"),
            note=data.get("note", ""),
            chainage_m=data.get("chainage_m"),
            chainage_uncertainty_m=data.get("chainage_uncertainty_m"),
            snapshot_id=data.get("snapshot_id"),
            detection_id=data.get("detection_id"),
            region=data.get("region"),
        )


@dataclass
class Recording:
    """Where the video went. See runs/recorder.py for the format."""

    file: str = ""
    index_file: str = ""
    frames: int = 0
    bytes: int = 0

    def as_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, data):
        return cls(
            file=data.get("file", ""),
            index_file=data.get("index_file", ""),
            frames=int(data.get("frames", 0)),
            bytes=int(data.get("bytes", 0)),
        )


@dataclass
class Origin:
    """Where on the earth the run started, and which way the robot faced.

    Placed by the operator on a map, not measured -- there is no GPS on the
    robot and there would be no signal for it down a pipe. It is the anchor the
    whole track hangs off: every x/y in `Run.path` is metres from here.

    `bearing_deg` is the compass direction the robot was pointing when the run
    began, 0 = north. The IMU's yaw is relative to startup and has no
    magnetometer behind it, so this is the only thing that ties the track to
    real-world directions. Left at 0 it means the operator did not say, and the
    track is drawn as though the robot entered heading north.
    """

    lat: float = 0.0
    lon: float = 0.0
    bearing_deg: float = 0.0

    def as_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, data):
        return cls(
            lat=float(data.get("lat", 0.0)),
            lon=float(data.get("lon", 0.0)),
            bearing_deg=float(data.get("bearing_deg", 0.0)),
        )


@dataclass
class Run:
    id: str = field(default_factory=_new_id)
    name: str = ""
    started_at: float = field(default_factory=time.time)
    ended_at: float | None = None
    note: str = ""

    # Where the operator says the robot went in. None when they did not place
    # it, in which case the track is drawn in its own local frame and no map.
    origin: Origin | None = None

    # Odometry at the moment the run ended, or the last sample seen. Estimated,
    # like everything derived from it.
    distance_m: float = 0.0
    uncertainty_m: float = 0.0

    defects: list[Defect] = field(default_factory=list)
    snapshots: list[Snapshot] = field(default_factory=list)
    recording: Recording | None = None

    # Sampled path, for the map. Appended at a fixed distance interval rather
    # than a time interval, so standing still does not fill it with duplicates.
    path: list[dict] = field(default_factory=list)

    @property
    def interrupted(self):
        """Ended by a crash or a power cut rather than by the operator."""
        return self.ended_at is None

    @property
    def duration_s(self):
        return (self.ended_at or time.time()) - self.started_at

    def as_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "note": self.note,
            "origin": self.origin.as_dict() if self.origin else None,
            "distance_m": round(self.distance_m, 2),
            "uncertainty_m": round(self.uncertainty_m, 2),
            "duration_s": round(self.duration_s, 1),
            "interrupted": self.interrupted,
            "defects": [d.as_dict() for d in self.defects],
            "snapshots": [s.as_dict() for s in self.snapshots],
            "recording": self.recording.as_dict() if self.recording else None,
            "path": self.path,
        }

    def summary(self):
        """The row in the run list. Everything but the bulky arrays."""
        return {
            "id": self.id,
            "name": self.name,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "duration_s": round(self.duration_s, 1),
            "origin": self.origin.as_dict() if self.origin else None,
            "distance_m": round(self.distance_m, 2),
            "uncertainty_m": round(self.uncertainty_m, 2),
            "interrupted": self.interrupted,
            "defect_count": len(self.defects),
            "snapshot_count": len(self.snapshots),
            "has_recording": self.recording is not None,
        }

    @classmethod
    def from_dict(cls, data):
        recording = data.get("recording")
        origin = data.get("origin")
        return cls(
            id=data.get("id", _new_id()),
            name=data.get("name", ""),
            started_at=data.get("started_at", 0.0),
            ended_at=data.get("ended_at"),
            note=data.get("note", ""),
            origin=Origin.from_dict(origin) if origin else None,
            distance_m=data.get("distance_m", 0.0),
            uncertainty_m=data.get("uncertainty_m", 0.0),
            defects=[Defect.from_dict(d) for d in data.get("defects", [])],
            snapshots=[Snapshot.from_dict(s) for s in data.get("snapshots", [])],
            recording=Recording.from_dict(recording) if recording else None,
            path=data.get("path", []),
        )
