"""BNO085 IMU reads, via the game rotation vector.

I2C address 0x4A on the Qwiic connector (physical pins 1, 3, 5, 9).

Two things shape this file:

1. The BNO085 uses I2C clock stretching and the Pi's hardware I2C has a known
   bug with it. Intermittent OSError during reads is NORMAL, not a fault. Every
   read is wrapped; repeated failures mark the IMU degraded and nothing more.
   Motor control must never depend on this sensor working.

2. Game rotation vector, not rotation vector. It skips the magnetometer, which
   the motor wiring corrupts anyway. Pitch and roll are what matter for pipe
   grade. Yaw is still reported but it is relative to startup and it drifts --
   do not treat it as a compass heading.

   `set_north()` is how it becomes one. The operator points the robot at a known
   bearing and says so, and every later yaw is absolute. The reference dies with
   the sensor session -- a reconnect restarts yaw from a new zero -- so it is
   reported stale rather than quietly reused. See the north block below.

Reads run on a background thread so a blocked I2C transaction can never stall
the web server's event loop.

What acceleration is used for: telling motion from stillness, and feeding the
odometer's velocity estimate (estimation/odometry.py). It is reported as a
deadbanded magnitude -- see ACCEL_DEADBAND_M_S2 -- so that a robot standing
still reads a clean zero rather than sensor noise, and so nothing downstream
integrates that noise into a distance.
"""

import logging
import math
import threading
import time

log = logging.getLogger(__name__)

I2C_ADDRESS = 0x4A
POLL_INTERVAL_S = 0.05  # 20 Hz, comfortably faster than the 10 Hz telemetry
FAILURES_BEFORE_DEGRADED = 5
REINIT_BACKOFF_S = 5.0

# Gravity-compensated magnitude below this is reported as exactly zero, and is
# treated as "no acceleration" by everything downstream. Sized above the
# BNO085's own noise floor sitting still on a bench.
#
# Reported as 0.0 rather than as the raw number on purpose. The sensor never
# reads a clean zero -- it jitters around 0.02-0.08 sitting on the bench -- and
# a readout that never settles is one an operator stops believing. More
# importantly the odometer integrates this number, so leaving the noise in
# would accumulate a phantom velocity out of a robot that is standing still.
ACCEL_DEADBAND_M_S2 = 0.1


def quaternion_to_euler(i, j, k, real):
    """Quaternion to pitch/roll/yaw in degrees.

    Roll and pitch are absolute (gravity referenced). Yaw is relative to
    wherever the sensor was when it started up.
    """
    roll = math.atan2(2.0 * (real * i + j * k), 1.0 - 2.0 * (i * i + j * j))

    sin_pitch = 2.0 * (real * j - k * i)
    sin_pitch = max(-1.0, min(1.0, sin_pitch))  # guard asin against rounding
    pitch = math.asin(sin_pitch)

    yaw = math.atan2(2.0 * (real * k + i * j), 1.0 - 2.0 * (j * j + k * k))

    return math.degrees(pitch), math.degrees(roll), math.degrees(yaw)


def _deadband(value):
    """Anything inside the noise floor becomes exactly zero. None passes through."""
    if value is None:
        return None
    return 0.0 if abs(value) <= ACCEL_DEADBAND_M_S2 else value


class IMU:
    def __init__(self, autostart=True):
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread = None

        self._sensor = None
        self._i2c = None
        self._pitch = None
        self._roll = None
        self._yaw = None
        self._accel = None
        self._accel_enabled = False
        self._consecutive_failures = 0
        self._total_failures = 0
        self._last_good_at = None
        self._last_init_attempt = 0.0
        self._present = False
        self._init_error = None

        # The north reference. See set_north() -- this is the yaw reading that
        # was pointing at true north, and the sensor session it was taken in.
        self._north_yaw = None
        self._north_session = None
        # Bumped on every successful connect. Game rotation vector yaw is
        # relative to when the sensor started, so a reconnect invalidates any
        # datum taken before it -- and the sensor reconnects on its own after a
        # wedged bus, without anyone asking.
        self._session = 0

        if autostart:
            self.start()

    # --- lifecycle ---

    def start(self):
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="imu-poll", daemon=True)
        self._thread.start()

    def close(self):
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
        with self._lock:
            self._sensor = None
            if self._i2c is not None:
                try:
                    self._i2c.deinit()
                except Exception:  # noqa: BLE001 - already tearing down
                    pass
                self._i2c = None
        log.info("imu closed")

    # --- queries used by the estimators ---

    @property
    def acceleration(self):
        """Gravity-compensated magnitude in m/s^2, deadbanded. None if unread.

        This is the number the odometer integrates, so the deadband is applied
        here rather than at the point of display: there must not be a version of
        this reading that the screen calls zero and the estimator does not.
        """
        with self._lock:
            return _deadband(self._accel)

    @property
    def raw_acceleration(self):
        """The undeadbanded magnitude. Diagnostics only -- see `acceleration`."""
        with self._lock:
            return self._accel

    def seems_still(self):
        """True when acceleration says nothing is happening.

        None (no reading) returns False: absence of evidence is not evidence of
        stillness, and the stall heuristic must not fire on a dead sensor.
        """
        accel = self.acceleration
        return accel is not None and accel == 0.0

    # --- the north reference ---

    def set_north(self, facing_deg=0.0):
        """Declare which way the robot is pointing RIGHT NOW.

        `facing_deg` is the true compass bearing the chassis is facing at the
        moment of the call: 0 for "I have pointed it at north", or the reading
        off a handheld compass or a site plan for anything else. From that and
        the current yaw, every later yaw becomes an absolute bearing.

        This exists because the BNO085 runs on the game rotation vector, which
        has no magnetometer -- the motor wiring corrupts one anyway. Its yaw is
        an angle from wherever the sensor happened to be at power-on. It is a
        perfectly good measure of TURNING and says nothing about DIRECTION, and
        this is the one number that can bridge the two. Nothing on the robot can
        measure it, so a person has to supply it.

        Returns the stored reference, or None if there is no yaw to anchor to.
        """
        with self._lock:
            if self._yaw is None:
                return None
            # Store the yaw that corresponds to north, so heading is a plain
            # subtraction afterwards.
            self._north_yaw = (self._yaw - facing_deg + 180.0) % 360.0 - 180.0
            self._north_session = self._session
            reference = self._north_reference()
        log.info("north set: yaw %.1f is bearing %.1f", self._yaw, facing_deg)
        return reference

    def clear_north(self):
        """Forget the reference. Headings go back to being relative."""
        with self._lock:
            self._north_yaw = None
            self._north_session = None
        log.info("north reference cleared")

    @property
    def heading_deg(self):
        """Absolute compass bearing, 0..360, or None if north is not set.

        None whenever the reference is missing or stale. A heading that silently
        falls back to a relative yaw would be a compass reading that is wrong by
        an unknown amount, which is worse than no compass at all.
        """
        with self._lock:
            return self._heading_deg()

    def _heading_deg(self):
        """Holds _lock."""
        if self._yaw is None or self._north_yaw is None:
            return None
        if self._north_session != self._session:
            return None
        return (self._yaw - self._north_yaw) % 360.0

    def _north_reference(self):
        """Holds _lock."""
        stale = (
            self._north_yaw is not None and self._north_session != self._session
        )
        return {
            "set": self._north_yaw is not None and not stale,
            # The sensor restarted since this was taken, so the datum is
            # meaningless. Reported rather than silently dropped: the operator
            # set it once and needs telling that it has to be done again.
            "stale": stale,
            "heading_deg": (
                round(self._heading_deg(), 1)
                if self._heading_deg() is not None
                else None
            ),
        }

    # --- internals ---

    def _connect(self):
        """Try to bring the sensor up. Returns True on success, never raises."""
        try:
            import board
            import busio
            from adafruit_bno08x import (
                BNO_REPORT_GAME_ROTATION_VECTOR,
                BNO_REPORT_LINEAR_ACCELERATION,
            )
            from adafruit_bno08x.i2c import BNO08X_I2C

            i2c = busio.I2C(board.SCL, board.SDA)
            sensor = BNO08X_I2C(i2c, address=I2C_ADDRESS)
            sensor.enable_feature(BNO_REPORT_GAME_ROTATION_VECTOR)
            # Give the feature a moment to start producing reports.
            time.sleep(0.2)
        except Exception as exc:  # noqa: BLE001 - absent sensor is a supported state
            self._init_error = f"{type(exc).__name__}: {exc}"
            log.warning("IMU init failed (continuing without it): %s", exc)
            return False

        # Linear acceleration is gravity-compensated, so it reads ~0 when the
        # robot is sitting still at any angle. Enabled separately and allowed to
        # fail: more reports mean more I2C traffic, and orientation is the part
        # that actually matters for pipe grade.
        accel_ok = False
        try:
            sensor.enable_feature(BNO_REPORT_LINEAR_ACCELERATION)
            time.sleep(0.2)
            accel_ok = True
        except Exception as exc:  # noqa: BLE001
            log.warning("IMU acceleration unavailable, orientation still fine: %s", exc)

        with self._lock:
            self._i2c = i2c
            self._sensor = sensor
            self._present = True
            self._accel_enabled = accel_ok
            self._init_error = None
            # Yaw is about to start counting from a new zero, so whatever north
            # meant a moment ago no longer means anything.
            self._session += 1
        log.info(
            "IMU online at 0x%02X, game rotation vector%s enabled",
            I2C_ADDRESS,
            " + linear acceleration" if accel_ok else "",
        )
        return True

    def _run(self):
        while not self._stop_event.is_set():
            if self._sensor is None:
                now = time.monotonic()
                if now - self._last_init_attempt < REINIT_BACKOFF_S:
                    self._stop_event.wait(REINIT_BACKOFF_S)
                    continue
                self._last_init_attempt = now
                if not self._connect():
                    self._stop_event.wait(REINIT_BACKOFF_S)
                    continue

            try:
                i, j, k, real = self._sensor.game_quaternion
                pitch, roll, yaw = quaternion_to_euler(i, j, k, real)
                accel = None
                if self._accel_enabled:
                    ax, ay, az = self._sensor.linear_acceleration
                    # One number is easier to read while driving than three
                    # axes. Magnitude answers "is it moving or being knocked
                    # about", which is what the operator wants at a glance.
                    accel = (ax * ax + ay * ay + az * az) ** 0.5
            except Exception as exc:  # noqa: BLE001 - OSError here is expected
                with self._lock:
                    self._consecutive_failures += 1
                    self._total_failures += 1
                    failures = self._consecutive_failures
                if failures == FAILURES_BEFORE_DEGRADED:
                    log.warning("IMU degraded after %d failed reads: %s", failures, exc)
                # A long run of failures usually means the bus wedged. Drop the
                # handle so the next loop rebuilds it from scratch.
                if failures >= FAILURES_BEFORE_DEGRADED * 4:
                    log.warning("IMU unresponsive, will reinitialise")
                    with self._lock:
                        self._sensor = None
                        self._consecutive_failures = FAILURES_BEFORE_DEGRADED
                    self._last_init_attempt = 0.0
                self._stop_event.wait(POLL_INTERVAL_S)
                continue

            with self._lock:
                self._pitch = pitch
                self._roll = roll
                self._yaw = yaw
                self._accel = accel
                self._consecutive_failures = 0
                self._last_good_at = time.monotonic()

            self._stop_event.wait(POLL_INTERVAL_S)

    # --- telemetry ---

    def status(self):
        """Never raises, never blocks on I2C. Returns cached values."""
        with self._lock:
            degraded = self._consecutive_failures >= FAILURES_BEFORE_DEGRADED
            age = (
                time.monotonic() - self._last_good_at
                if self._last_good_at is not None
                else None
            )
            if self._sensor is None and self._last_good_at is None:
                state = "absent"
            elif degraded:
                state = "degraded"
            else:
                state = "ok"

            return {
                "state": state,
                "present": self._present,
                "pitch": round(self._pitch, 1) if self._pitch is not None else None,
                "roll": round(self._roll, 1) if self._roll is not None else None,
                # Relative to startup and drifting -- no magnetometer in game mode.
                "yaw": round(self._yaw, 1) if self._yaw is not None else None,
                # Gravity-compensated and deadbanded, so exactly 0 when
                # stationary at any angle. The raw number rides alongside it for
                # anyone diagnosing a sensor rather than driving a robot.
                "accel_m_s2": _deadband(
                    round(self._accel, 2) if self._accel is not None else None
                ),
                "accel_raw_m_s2": (
                    round(self._accel, 2) if self._accel is not None else None
                ),
                "accel_deadband_m_s2": ACCEL_DEADBAND_M_S2,
                # Absolute compass bearing, or None until someone has said which
                # way north is. See set_north().
                "north": self._north_reference(),
                "reading_age_s": round(age, 2) if age is not None else None,
                "failures": self._total_failures,
                "error": self._init_error,
            }
