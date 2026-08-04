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

Reads run on a background thread so a blocked I2C transaction can never stall
the web server's event loop.

What acceleration is used for: telling motion from stillness, and nothing else.
It is NOT integrated into a distance -- see docs/DECISIONS.md for why that number
would be worthless within seconds.
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

# Gravity-compensated magnitude below this reads as "not being moved". Sized
# above the BNO085's own noise floor sitting still on a bench.
STILLNESS_M_S2 = 0.12


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
        """Gravity-compensated magnitude in m/s^2, or None."""
        with self._lock:
            return self._accel

    def seems_still(self):
        """True when acceleration says nothing is happening.

        None (no reading) returns False: absence of evidence is not evidence of
        stillness, and the stall heuristic must not fire on a dead sensor.
        """
        accel = self.acceleration
        return accel is not None and accel < STILLNESS_M_S2

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
                # Gravity-compensated, so ~0 when stationary at any angle.
                "accel_m_s2": round(self._accel, 2) if self._accel is not None else None,
                "reading_age_s": round(age, 2) if age is not None else None,
                "failures": self._total_failures,
                "error": self._init_error,
            }
