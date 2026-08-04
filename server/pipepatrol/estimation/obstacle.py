"""Two warnings inferred from sensors that were not fitted to produce them.

STALL. The gearboxes strip when held against a jam, and nothing electrical
detects that -- see docs/HARDWARE.md. What we have instead: motors commanded
above MIN_DUTY, the IMU reporting no acceleration, and the picture not changing.
All three at once, held for a debounce window, is a robot pushing against
something that will not move.

OBSTRUCTION. Radial flow divergence relates speed to distance by
`divergence = v / Z`, so its reciprocal is time-to-contact in seconds -- with no
camera calibration and no scale factor. A wall closing fast raises divergence
even at constant speed. Below a threshold, warn.

Neither of these stops the motors. Both are heuristics, and a false positive
that halts a crawler forty metres into a live sewer is its own kind of failure.
They raise an alert and let the operator decide. An INA260 on the pack would
replace the first one with a measurement.
"""

import threading
import time

from pipepatrol.hardware import drive as drive_module

# All three stall conditions must hold continuously for this long. Short enough
# to catch a jam before much torque has been dumped into stationary teeth, long
# enough to ride out a single bad flow frame.
STALL_DEBOUNCE_S = 0.8

# Mean flow below this is "the picture is not changing", in pixels per second on
# the downscaled working image.
STALL_FLOW_PX_S = 1.2

# Without flow, the IMU alone has to carry it -- so wait longer before believing
# it. A robot crawling smoothly over wet concrete reads very quiet.
STALL_DEBOUNCE_NO_FLOW_S = 2.0

# Time-to-contact thresholds, seconds.
OBSTRUCTION_WARN_TTC_S = 4.0
OBSTRUCTION_CRITICAL_TTC_S = 1.5
OBSTRUCTION_DEBOUNCE_S = 0.5

# Below this the divergence is noise and its reciprocal is a wild number.
MIN_DIVERGENCE = 0.02


class Hazards:
    """Debounced stall and obstruction inference. Driven by the telemetry loop."""

    def __init__(self, drive, imu, flow):
        self._drive = drive
        self._imu = imu
        self._flow = flow
        self._lock = threading.Lock()
        self._stall_since = None
        self._obstruction_since = None
        self._state = {
            "stalled": False,
            "obstruction": None,
            "time_to_contact_s": None,
        }

    def update(self, speed_m_s=None, now=None):
        now = time.monotonic() if now is None else now
        sample = self._flow.latest()
        duties = self._drive.duties
        driving = any(abs(d) >= drive_module.MIN_DUTY for d in duties)

        with self._lock:
            stalled = self._update_stall(driving, sample, now)
            obstruction, ttc = self._update_obstruction(duties, sample, speed_m_s, now)
            self._state = {
                "stalled": stalled,
                "obstruction": obstruction,
                "time_to_contact_s": round(ttc, 1) if ttc is not None else None,
            }
            return dict(self._state)

    # --- internals ---

    def _update_stall(self, driving, sample, now):
        if not driving:
            self._stall_since = None
            return False

        still = self._imu.seems_still()
        if sample.valid:
            quiet = sample.magnitude < STALL_FLOW_PX_S
            suspect = still and quiet
            debounce = STALL_DEBOUNCE_S
        else:
            # No usable picture. The IMU is all there is, so demand more of it.
            suspect = still
            debounce = STALL_DEBOUNCE_NO_FLOW_S

        if not suspect:
            self._stall_since = None
            return False

        if self._stall_since is None:
            self._stall_since = now
        return now - self._stall_since >= debounce

    def _update_obstruction(self, duties, sample, speed_m_s, now):
        forward = all(d > 0 for d in duties) and any(
            abs(d) >= drive_module.MIN_DUTY for d in duties
        )
        if not forward or not sample.valid or sample.divergence < MIN_DIVERGENCE:
            self._obstruction_since = None
            return None, None

        ttc = 1.0 / sample.divergence
        if ttc > OBSTRUCTION_WARN_TTC_S:
            self._obstruction_since = None
            return None, ttc

        if self._obstruction_since is None:
            self._obstruction_since = now
        if now - self._obstruction_since < OBSTRUCTION_DEBOUNCE_S:
            return None, ttc

        level = "critical" if ttc <= OBSTRUCTION_CRITICAL_TTC_S else "warning"
        distance = abs(speed_m_s) * ttc if speed_m_s else None
        return {
            "level": level,
            "estimated_distance_m": round(distance, 2) if distance else None,
        }, ttc

    def status(self):
        with self._lock:
            return dict(self._state)
