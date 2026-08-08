"""Optical flow over the camera feed.

The camera looks down the pipe, so forward motion shows up as features sliding
*outward* from the centre of the image rather than sideways. That radial
expansion is the signal this module extracts.

Two numbers come out of it, and they answer different questions:

    divergence   1/s.  Rate of radial expansion. Relates forward speed `v` to
                       distance-to-surface `Z` by  divergence = v / Z.
    magnitude    px/s. Mean flow speed, regardless of direction. Answers "is
                       anything on screen moving at all", which is how a stall
                       is told from a slow crawl.

Divergence is the useful one twice over:

  * Multiplied by a calibrated scale it becomes a speed that notices wheel slip,
    because slipping wheels move the odometer and not the picture.
  * Inverted it is time-to-contact -- 1 / divergence -- with no scale factor and
    no camera calibration needed at all. That is what the obstacle warning uses.

Runs on its own thread at a fraction of the video rate. Video stays at full
speed; this is an estimator, not a viewer.
"""

import logging
import math
import os
import threading
import time

log = logging.getLogger(__name__)

SAMPLE_HZ = 10.0
# Flow is computed on a downscaled copy. Pipe walls are low-texture and the
# features worth tracking are large, so resolution buys very little here and
# costs CPU that inference will want.
WORK_WIDTH = 160
MAX_FEATURES = 120
FEATURE_QUALITY = 0.05
FEATURE_MIN_DISTANCE = 6

# Features nearer the centre than this (as a fraction of the half-diagonal) are
# dropped from the divergence estimate: close to the focus of expansion the
# radial direction is ill-defined and dividing by a tiny radius amplifies noise.
MIN_RADIUS_FRACTION = 0.15

# Below this many surviving features the frame is not trustworthy. A dark or
# blank pipe wall genuinely has nothing to track, and inventing a number there
# is how a robot drives confidently into a wall.
MIN_TRACKED_FEATURES = 12

# Re-detect features when tracking has thinned out. Cheaper than detecting every
# frame, and LK holds on for a good while in a slowly-changing scene.
REDETECT_BELOW = 40

# --- metric scale, from the pipe rather than from the wheels ---
#
# WHY THE PIPE IS THE RULER. Divergence alone gives v/Z, not v: a monocular
# camera cannot tell a small thing close by from a large thing far away, so
# something in the scene has to supply a known length. This used to be borrowed
# from the commanded duty, which made the visual estimate circular -- it was
# calibrated against the wheels, so it could never disagree with them, and wheel
# slip was exactly what it was supposed to catch.
#
# A pipe supplies the length for free. The camera looks down a tube of known
# diameter, so every feature on the wall sits at a known distance off the axis,
# and its image radius says how far away it is:
#
#     θ_i = where it sits, as an angle off the axis (from its image radius)
#     Z_i = R / tan(θ_i)         how far down the pipe that puts it
#     v_i = R · θ̇_i / sin²(θ_i)  differentiate Z, and the speed falls out
#
# Every feature gives an independent speed in metres per second, with no wheel
# and no accelerometer in the derivation. The median across them is what comes
# out. Nothing here needs a calibration run.
#
# WHAT IT ASSUMES, AND WHERE THAT BREAKS. It assumes the camera is on the pipe's
# axis and the pipe is round and straight. It is not on the axis -- it sits on a
# chassis on the invert -- so features on the crown read further away than
# features on the invert and the two errors sit either side of the median. Over
# a round pipe that mostly cancels; over a badly deformed one, or a wall that
# happens to be covered in flat sediment, it does not. Hence the sanity band in
# odometry.py, which still refuses a visual speed the motors could not deliver.

# Horizontal field of view of the fitted lens, degrees.
PIPE_CAMERA_HFOV_DEG = float(os.environ.get("PIPEPATROL_CAMERA_HFOV_DEG", "160.0"))

# Internal diameter of the pipe being inspected, metres. 10 inches. The one
# number an operator has to be right about for distance to be right.
PIPE_DIAMETER_M = float(os.environ.get("PIPEPATROL_PIPE_DIAMETER_M", "0.254"))

# THE LENS IS A FISHEYE, SO THE PINHOLE MODEL IS NOT USED.
#
# A pinhole projects at r = f·tan(θ), which runs to infinity as θ approaches 90°.
# At a 160° field of view the edge of the frame is at θ = 80°, where tan is 5.7
# and climbing — the model is already wrong in the middle of the image and
# meaningless at the edges. Every wide lens is built to some other projection,
# and the common one is equidistant:
#
#     r = f · θ           with  f = (W/2) / (HFOV/2 in radians)
#
# so the angle a feature sits at is just its radius over f. Depth then comes
# from the pipe's own geometry rather than from a similar-triangles argument
# that only holds for narrow lenses:
#
#     Z = R / tan(θ)      wall at radius R, seen θ off the axis
#
# Past about 60° the two models disagree by more than a factor of two, which
# would have shown up as distance being wrong by that much and drifting with
# how far out in the frame the features happened to land.
FISHEYE = os.environ.get("PIPEPATROL_CAMERA_FISHEYE", "1") != "0"

# Features beyond this angle are dropped. Near 90° the wall is edge-on, Z goes
# to zero and its reciprocal blows up.
MAX_FEATURE_ANGLE_DEG = 70.0

# THE CAMERA IS NOT ON THE PIPE'S AXIS. It rides on a chassis sitting on the
# invert, an inch or so below centre, which means the wall is not one distance
# away -- the crown is (R + d) out and the invert is (R - d). At d = 1" in a 10"
# pipe that is 0.152 m versus 0.102 m, a 50% spread, so treating every feature
# as if it sat at R would price the same motion differently depending on which
# part of the wall happened to have texture on it.
#
# The true off-axis distance at azimuth φ, measured from the camera:
#
#     ρ(φ) = d·sin(φ) + √(R² − d²·cos²(φ))
#
# and φ is known per feature, because it is just where the feature sits around
# the image centre. So each one is priced against its own wall distance instead
# of against an average. The d·sin(φ) term is antisymmetric and cancels for
# features spread around the bore -- which is why the median was already close
# -- but it does NOT cancel when the texture is all on one side, and sediment on
# the invert is the normal case rather than the exception.
#
# Positive = camera below the centre line, which is the only way it mounts.
CAMERA_OFFSET_M = float(os.environ.get("PIPEPATROL_CAMERA_OFFSET_M", "0.0254"))

# How many tracked features the telemetry envelope carries. Enough to see at a
# glance whether the estimate has anything behind it; capped because this goes
# out ten times a second and the console only draws dots with it.
MAX_PUBLISHED_POINTS = 60



class FlowSample:
    """One flow measurement. `valid` false means the scene gave us nothing."""

    __slots__ = (
        "divergence",
        "magnitude",
        "features",
        "valid",
        "at",
        "speed_m_s",
        "points",
    )

    def __init__(
        self,
        divergence=0.0,
        magnitude=0.0,
        features=0,
        valid=False,
        at=0.0,
        speed_m_s=None,
        points=None,
    ):
        self.divergence = divergence
        self.magnitude = magnitude
        self.features = features
        self.valid = valid
        self.at = at
        # Metres per second, straight off the picture. None when the pipe's
        # geometry is unknown or the frame gave nothing to measure.
        self.speed_m_s = speed_m_s
        # Where the tracked features are, normalised to the frame. The console
        # can draw these so an operator can see whether the distance estimate
        # has anything behind it -- on a clean wet wall it often does not, and
        # that failure is otherwise silent.
        self.points = points or []

    def as_dict(self):  # noqa: D102 - see the class docstring
        return {
            "divergence_per_s": round(self.divergence, 4),
            "magnitude_px_s": round(self.magnitude, 2),
            "features": self.features,
            "valid": self.valid,
            "speed_m_s": None if self.speed_m_s is None else round(self.speed_m_s, 4),
            "points": self.points,
        }


class OpticalFlow:
    """Samples the camera and publishes the most recent FlowSample.

    Absent OpenCV is a supported state: `available` goes false, samples stay
    invalid, and every consumer falls back to its non-visual path.
    """

    def __init__(self, camera, sample_hz=SAMPLE_HZ):
        self._camera = camera
        self._interval = 1.0 / sample_hz
        self._lock = threading.Lock()
        self._sample = FlowSample()
        self._stop = threading.Event()
        self._thread = None
        self._cv2 = None
        self._np = None
        self.available = False
        self.error = None

    def start(self):
        if self._thread is not None:
            return
        try:
            import cv2
            import numpy as np
        except ImportError as exc:
            self.error = f"OpenCV unavailable: {exc}"
            log.warning("optical flow disabled, distance falls back to duty: %s", exc)
            return
        self._cv2 = cv2
        self._np = np
        self.available = True
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="optical-flow", daemon=True)
        self._thread.start()

    def close(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None

    def latest(self):
        with self._lock:
            return self._sample

    # --- internals ---

    def _prepare(self, jpeg):
        """JPEG bytes -> small grayscale array, or None."""
        cv2, np = self._cv2, self._np
        image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_GRAYSCALE)
        if image is None:
            return None
        height, width = image.shape[:2]
        if width > WORK_WIDTH:
            scale = WORK_WIDTH / width
            image = cv2.resize(
                image, (WORK_WIDTH, max(1, int(height * scale))),
                interpolation=cv2.INTER_AREA,
            )
        return image

    def _detect(self, image):
        return self._cv2.goodFeaturesToTrack(
            image,
            maxCorners=MAX_FEATURES,
            qualityLevel=FEATURE_QUALITY,
            minDistance=FEATURE_MIN_DISTANCE,
        )

    def _run(self):
        cv2, np = self._cv2, self._np
        previous = None
        points = None
        previous_at = None
        seen = None

        while not self._stop.is_set():
            output = self._camera.raw_output()
            if output is None:
                self._publish(FlowSample(at=time.monotonic()))
                self._stop.wait(self._interval)
                continue

            jpeg, seen = output.wait_for_frame(timeout=1.0, since=seen)
            if jpeg is None:
                previous = None
                self._publish(FlowSample(at=time.monotonic()))
                continue

            now = time.monotonic()
            try:
                image = self._prepare(jpeg)
            except Exception as exc:  # noqa: BLE001 - a bad frame is not fatal
                log.debug("flow decode failed: %s", exc)
                image = None

            if image is None:
                previous = None
                self._stop.wait(self._interval)
                continue

            if previous is None or points is None or len(points) < REDETECT_BELOW:
                points = self._detect(image)
                previous, previous_at = image, now
                self._publish(FlowSample(at=now))
                self._stop.wait(self._interval)
                continue

            dt = now - previous_at
            if dt <= 0:
                self._stop.wait(self._interval)
                continue

            try:
                moved, status, _ = cv2.calcOpticalFlowPyrLK(previous, image, points, None)
            except Exception as exc:  # noqa: BLE001
                log.debug("flow tracking failed: %s", exc)
                previous, points = None, None
                continue

            sample = self._measure(points, moved, status, image.shape, dt, now)
            self._publish(sample)

            previous, previous_at = image, now
            points = moved[status.flatten() == 1].reshape(-1, 1, 2) if moved is not None else None

            self._stop.wait(self._interval)

    def _measure(self, before, after, status, shape, dt, now):
        """Radial expansion and mean speed over the surviving features."""
        np = self._np
        if after is None or status is None:
            return FlowSample(at=now)

        keep = status.flatten() == 1
        start = before.reshape(-1, 2)[keep]
        end = after.reshape(-1, 2)[keep]
        if len(start) < MIN_TRACKED_FEATURES:
            return FlowSample(features=int(len(start)), at=now)

        height, width = shape[:2]
        centre = np.array([width / 2.0, height / 2.0], dtype=np.float32)
        half_diagonal = math.hypot(width, height) / 2.0

        offsets = start - centre
        radii = np.linalg.norm(offsets, axis=1)
        near_centre = radii < MIN_RADIUS_FRACTION * half_diagonal

        displacement = end - start
        magnitude = float(np.mean(np.linalg.norm(displacement, axis=1))) / dt

        usable = ~near_centre
        if int(np.count_nonzero(usable)) < MIN_TRACKED_FEATURES:
            return FlowSample(magnitude=magnitude, features=int(len(start)), at=now)

        # Radial component of each feature's motion, divided by its radius. For
        # pure forward translation every feature gives the same answer, so the
        # median is a strong estimate and shrugs off a few bad tracks.
        radial = np.sum(displacement[usable] * offsets[usable], axis=1) / radii[usable]
        divergence = float(np.median(radial / radii[usable])) / dt

        return FlowSample(
            divergence=divergence,
            magnitude=magnitude,
            features=int(len(start)),
            valid=True,
            at=now,
            speed_m_s=self._metric_speed(
                radial, radii[usable], offsets[usable], width, dt
            ),
            # Normalised so the console can draw them over a frame of any size.
            points=[
                (round(float(px) / width, 4), round(float(py) / height, 4))
                for px, py in end[:MAX_PUBLISHED_POINTS]
            ],
        )

    def _metric_speed(self, radial, radii, offsets, width, dt):
        """Metres per second, from the pipe's own diameter. See the header.

        `radial` is each usable feature's radial displacement in pixels over
        `dt`; `radii` is where each one sat. Returns None rather than a guess
        whenever the geometry does not support an answer.

        The chain, per feature:

            θ  = angle off the optical axis, from its image radius
            φ  = where it sits around the bore, from its image direction
            ρ  = its own wall distance at that azimuth, camera offset included
            Z  = ρ / tan(θ)          how far down the pipe it is
            θ̇  = dr/dt · dθ/dr       its angular rate, from the pixel rate
            v  = −dZ/dt = ρ·θ̇ / sin²(θ)

        Every feature yields a speed on its own, so the median across them is
        the estimate and a handful of bad tracks cannot move it.
        """
        np = self._np
        if PIPE_DIAMETER_M <= 0 or width <= 0:
            return None

        half_width = width / 2.0
        half_fov = math.radians(PIPE_CAMERA_HFOV_DEG) / 2.0
        radius_m = PIPE_DIAMETER_M / 2.0

        if FISHEYE:
            # Equidistant: r = f·θ, so θ = r/f and dr/dθ is the constant f.
            focal_px = half_width / half_fov
            theta = radii / focal_px
            dtheta_dr = 1.0 / focal_px
        else:
            # Pinhole: r = f·tan(θ), so dr/dθ = f·sec²(θ).
            focal_px = half_width / math.tan(half_fov)
            theta = np.arctan(radii / focal_px)
            dtheta_dr = (np.cos(theta) ** 2) / focal_px

        limit = math.radians(MAX_FEATURE_ANGLE_DEG)
        # Also drop anything too near the axis, where tan(θ) → 0 puts the wall
        # at an unbounded distance and the estimate is all noise.
        usable = (theta < limit) & (theta > math.radians(2.0))
        if int(np.count_nonzero(usable)) < MIN_TRACKED_FEATURES:
            return None

        angular_rate = (
            radial[usable] * dtheta_dr
            if FISHEYE
            else radial[usable] * dtheta_dr[usable]
        )

        # Each feature's own wall distance, from where it sits around the bore.
        # Image y grows downward, so a feature above the centre of the frame is
        # on the crown and its sin(φ) must come out positive.
        offset = min(CAMERA_OFFSET_M, radius_m * 0.9)
        sin_phi = -offsets[usable][:, 1] / radii[usable]
        cos_phi = offsets[usable][:, 0] / radii[usable]
        wall_m = offset * sin_phi + np.sqrt(
            np.maximum(radius_m**2 - (offset * cos_phi) ** 2, 0.0)
        )

        speeds = wall_m * angular_rate / (np.sin(theta[usable]) ** 2) / dt
        return float(np.median(speeds))

    def _publish(self, sample):
        with self._lock:
            self._sample = sample

    def status(self):
        sample = self.latest()
        return {"available": self.available, "error": self.error, **sample.as_dict()}
