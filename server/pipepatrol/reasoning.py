"""Reasoning across a whole pass, rather than one frame at a time.

WHY THIS EXISTS. Every inspection system on the market reports observations one
at a time, and so do the coding standards behind them: NASSCO PACP and
EN 13508-2 are descriptive by design, recording what was seen and refusing to
say what caused it. So a joint displacement at 34 m and deposits at 36 m are
filed as two unrelated entries.

Together they mean something neither means alone. Material settling below an
opening in the wall, with no roots to account for it, is soil washing in from
outside, and soil leaving the ground around the pipe is a void forming. The
camera is inside; the void is outside. The combination implies it.

The thresholds here are not invented. They were measured across the 1,040,129
annotated frames of Sewer-ML, whose labels aggregate every observation within
0.3 m behind and 1.0 m ahead, and therefore already record which conditions
were found together:

    displaced joint + settled deposits    2.25x chance     45,910 frames
    crack + settled deposits              2.22x            7,312
    roots + settled deposits              1.55x            2,527
    crack + infiltration                  3.43x            3,589
    surface damage + infiltration         3.44x            14,482

Roots explain deposits too, but less strongly than an opening does, which is
why their presence lowers confidence here rather than suppressing the finding.

WHAT THIS IS NOT. These are inferences from what a camera can see inside a
pipe, never confirmed conditions outside it. Excavation confirms; this points
at where to dig.
"""

import time

# --------------------------------------------------------------------------
# Tuning
# --------------------------------------------------------------------------

# How far apart two observations can be and still be treated as one situation.
# Chainage here is real odometry in metres, unlike the ~1.3 m annotation
# spacing Sewer-ML samples at, so this is a physical distance and not a frame
# count. Widen it and unrelated findings start getting joined.
WINDOW_M = 2.5

# One condition stays in view for many frames as the robot approaches and
# passes it, so the raw log holds a row per frame rather than one per defect.
# An inspector writes one code per defect. Same-label observations closer
# together than this collapse into one.
MERGE_M = 1.0

# Roots are a competing explanation for deposits, measured weaker than an
# opening. Lower the confidence, do not suppress the finding.
ROOTS_PENALTY = 0.6

# Clock face positions where settled material can plausibly rest. Skipped
# entirely when the model classifies without localising, since there is no
# clock position to test.
INVERT_CLOCK = {4, 5, 6, 7, 8}

# Labels this module reasons about. These are the console's own codes from
# web/src/constants/defects.ts, not a standards set.
OPENINGS = ("CR", "FR", "BR", "HO", "JD")   # anything that breaches the wall
DEPOSITS = ("DE",)
ROOTS = ("RO",)
INFILTRATION = ("IN",)
SURFACE = ("SD",)
UNKNOWN = ("UNKNOWN",)


# --------------------------------------------------------------------------
# The observation log
# --------------------------------------------------------------------------

class Observation:
    """One detection, kept for the length of a run rather than six seconds.

    DetectionService ages its overlay entries out because a stale box must not
    imply it describes what is on screen now. Reasoning needs the opposite: the
    whole pass at once, so findings at different chainages can be compared.
    """

    __slots__ = ("label", "confidence", "chainage_m", "clock_position",
                 "box", "at", "seen_in", "anomaly")

    def __init__(self, label, confidence, chainage_m=None, clock_position=None,
                 box=None, at=None, anomaly=None):
        self.label = label
        self.confidence = float(confidence)
        self.chainage_m = chainage_m
        self.clock_position = clock_position
        self.box = box
        self.at = at if at is not None else time.time()
        self.anomaly = anomaly
        self.seen_in = 1

    @classmethod
    def from_detection(cls, detection):
        """Build from a perception.detector.Detection."""
        return cls(
            label=detection.label,
            confidence=detection.confidence,
            chainage_m=detection.chainage_m,
            clock_position=clock_from_box(detection.box),
            box=detection.box,
            at=detection.at,
            anomaly=getattr(detection, "anomaly", None),
        )

    def as_dict(self):
        return {
            "label": self.label,
            "confidence": round(self.confidence, 4),
            "chainage_m": self.chainage_m,
            "clock_position": self.clock_position,
            "box": self.box,
            "at": round(self.at, 3),
            "seen_in": self.seen_in,
            "anomaly": self.anomaly,
        }


def clock_from_box(box):
    """Clock-face position from a normalised box, 12 at the crown.

    Assumes the centre of the frame is roughly the centre of the bore, which
    holds while the camera points down the pipe. Returns None when the model
    classified without localising, and callers must cope with that rather than
    assume a position.
    """
    if not box:
        return None
    import math

    x1, y1, x2, y2 = box
    dx = (x1 + x2) / 2 - 0.5
    dy = (y1 + y2) / 2 - 0.5
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return None
    # -dy because image y grows downward and clock faces do not
    angle = math.degrees(math.atan2(-dy, dx))
    clock = round((90 - angle) / 30) % 12
    return 12 if clock == 0 else clock


def condense(observations):
    """Collapse repeated sightings of one condition into a single entry.

    Keeps the sighting the model was most confident about, and centres it on
    the middle of where it was visible. Without this the rules fire over and
    over on the same joint: a first pass over real footage produced fifteen
    findings from seventy-two frames, five of them the same displaced joint.
    """
    placed = [o for o in observations if o.chainage_m is not None]
    if not placed:
        return []

    out = []
    by_label = {}
    for o in placed:
        by_label.setdefault(o.label, []).append(o)

    for label, group in by_label.items():
        group.sort(key=lambda o: o.chainage_m)
        run = []
        for o in group:
            if run and o.chainage_m - run[-1].chainage_m > MERGE_M:
                out.append(_merge(run))
                run = []
            run.append(o)
        if run:
            out.append(_merge(run))

    out.sort(key=lambda o: o.chainage_m)
    return out


def _merge(group):
    best = max(group, key=lambda o: o.confidence)
    merged = Observation(
        label=best.label,
        confidence=best.confidence,
        chainage_m=sum(o.chainage_m for o in group) / len(group),
        clock_position=best.clock_position,
        box=best.box,
        at=best.at,
        anomaly=best.anomaly,
    )
    merged.seen_in = len(group)
    return merged


# --------------------------------------------------------------------------
# The rules
# --------------------------------------------------------------------------

def _near(observations, chainage_m, window=WINDOW_M):
    return [o for o in observations if abs(o.chainage_m - chainage_m) <= window]


def _score(supporting):
    """Average the evidence, docked when it is spread across the window."""
    spread = max(o.chainage_m for o in supporting) - min(o.chainage_m for o in supporting)
    penalty = 1.0 - min(spread / WINDOW_M, 1.0) * 0.2
    return round(sum(o.confidence for o in supporting) / len(supporting) * penalty, 3)


def _finding(rule, chainage_m, confidence, supporting, mechanism):
    return {
        "rule": rule,
        "chainage_m": round(chainage_m, 2),
        "confidence": confidence,
        "mechanism": mechanism,
        "evidence": [o.as_dict() for o in supporting],
    }


def rule_soil_infiltration(observations):
    """Material below an opening in the wall, with nothing else to explain it.

    The strongest of these, and the one that reaches outside the pipe: soil
    entering through a breach means soil leaving the ground around it.
    """
    findings = []
    for deposit in [o for o in observations if o.label in DEPOSITS]:
        # Only test the clock position when there is one. A classifier without
        # a localisation head gives no box, and requiring one would silently
        # disable this rule rather than loosen it.
        if deposit.clock_position is not None and deposit.clock_position not in INVERT_CLOCK:
            continue

        window = _near(observations, deposit.chainage_m)
        openings = [o for o in window if o.label in OPENINGS]
        roots = [o for o in window if o.label in ROOTS]
        if not openings:
            continue

        supporting = openings + [deposit]
        confidence = _score(supporting)
        rule = "possible soil infiltration, external void"
        if roots:
            confidence = round(confidence * ROOTS_PENALTY, 3)
            rule += " (roots nearby, competing explanation)"
            supporting = supporting + roots

        findings.append(_finding(
            rule, deposit.chainage_m, confidence, supporting,
            "Material settling below a breach in the pipe wall is consistent "
            "with soil entering from outside. Soil leaving the surrounding "
            "ground forms a void, which the camera cannot see."))
    return findings


def rule_active_ingress(observations):
    """A breach with water actively coming through it.

    The strongest pairing in Sewer-ML: 3.43x chance for cracks and 3.44x for
    surface damage. Water moving through a wall is what carries soil with it.
    """
    findings = []
    for water in [o for o in observations if o.label in INFILTRATION]:
        window = _near(observations, water.chainage_m)
        breaches = [o for o in window if o.label in OPENINGS + SURFACE]
        if not breaches:
            continue
        supporting = breaches + [water]
        findings.append(_finding(
            "active ingress through a wall breach", water.chainage_m,
            _score(supporting), supporting,
            "Water entering through a breach is a live path, not a static "
            "defect. It carries fines out of the surrounding ground."))
    return findings


def rule_localized_cluster(observations):
    """Several different conditions in one short length.

    One local cause is a better explanation than the pipe happening to age
    badly in exactly one spot.
    """
    findings = []
    claimed = set()
    for o in observations:
        window = _near(observations, o.chainage_m)
        kinds = {w.label for w in window if w.label not in UNKNOWN}
        if len(kinds) < 3:
            continue
        key = round(o.chainage_m / WINDOW_M)
        if key in claimed:
            continue
        claimed.add(key)
        findings.append(_finding(
            "localized damage cluster", o.chainage_m,
            _score(window), window,
            "Multiple distinct conditions concentrated in a short length "
            "suggests a single local cause rather than general deterioration."))
    return findings


def rule_ground_movement(observations):
    """A joint pulled apart with the pipe otherwise sound.

    Pipes failing on their own usually show other damage too. A clean
    separation suggests something moved the pipe from outside.
    """
    findings = []
    for joint in [o for o in observations if o.label == "JD"]:
        window = [o for o in _near(observations, joint.chainage_m)
                  if o is not joint]
        if window:
            continue
        findings.append(_finding(
            "possible ground movement", joint.chainage_m,
            round(joint.confidence, 3), [joint],
            "An isolated joint displacement, with the pipe otherwise sound, "
            "suggests external displacement rather than structural failure."))
    return findings


def rule_unknown_near_defect(observations):
    """Something the model has no name for, next to something it does.

    Depends on the anomaly backend writing UNKNOWN observations. Silent
    without it, which is the correct behaviour rather than an error.
    """
    findings = []
    for unknown in [o for o in observations if o.label in UNKNOWN]:
        window = [o for o in _near(observations, unknown.chainage_m)
                  if o.label not in UNKNOWN]
        if not window:
            continue
        findings.append(_finding(
            "unrecognised condition adjacent to a known defect",
            unknown.chainage_m, round(unknown.confidence, 3),
            [unknown] + window,
            "The detector has no class for this and cannot characterise it. "
            "Its proximity to a known defect makes it worth a human look."))
    return findings


ALL_RULES = (
    rule_soil_infiltration,
    rule_active_ingress,
    rule_localized_cluster,
    rule_ground_movement,
    rule_unknown_near_defect,
)


def _dedupe(findings):
    """Two firings of one rule a metre apart are one finding."""
    kept = []
    for f in sorted(findings, key=lambda f: -f["confidence"]):
        if any(k["rule"].split(" (")[0] == f["rule"].split(" (")[0]
               and abs(k["chainage_m"] - f["chainage_m"]) <= WINDOW_M
               for k in kept):
            continue
        kept.append(f)
    return sorted(kept, key=lambda f: f["chainage_m"])


def analyse(observations):
    """Every finding across a finished pass.

    Runs after the pass, not during it: a rule compares conditions at
    different chainages and cannot do that until the run has them all.
    """
    condensed = condense(observations)
    findings = []
    for rule in ALL_RULES:
        findings.extend(rule(condensed))
    return {
        "observations": len(observations),
        "distinct": len(condensed),
        "findings": _dedupe(findings),
    }
