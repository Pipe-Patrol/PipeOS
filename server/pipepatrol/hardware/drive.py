"""Motor control for the PipePatrol drivetrain.

Cytron MDD10A in sign-magnitude mode: one PWM pin and one direction pin per side.

    Signal   BCM     Physical   Side
    PWM1     GPIO12  32         LEFT
    DIR1     GPIO5   29         LEFT
    PWM2     GPIO13  33         RIGHT
    DIR2     GPIO6   31         RIGHT

SAFETY: the gearboxes are 226:1 SPUR gears, not planetary. ServoCity warns that
stalling them strips teeth. Stall current is 3.85 A, well under anything the
MDD10A would current-limit on, so the driver will hold a jammed motor at full
torque until the gearbox shears. Nothing in the electronics protects it.

Every protection lives in this file:
  * MAX_DUTY  - hard ceiling on any commanded duty
  * MIN_DUTY  - anything below snaps to zero (buzzing without turning IS a stall)
  * watchdog  - no command for COMMAND_TIMEOUT_S and both motors cut
  * run limit - nonzero for more than MAX_CONTINUOUS_RUN_S and both motors cut
  * cleanup   - atexit + explicit close(), PWM released on every exit path

The interface is tank (independent left/right) even though the console only
drives straight. Steering belongs to the operator's input mapping, not to the
motor driver -- constraining it here would mean re-teaching this file the day a
steered chassis appears.

No web code belongs in here.
"""

import atexit
import logging
import threading
import time

log = logging.getLogger(__name__)

# --- Pin map (BCM numbering) ---
PIN_PWM_LEFT = 12
PIN_DIR_LEFT = 5
PIN_PWM_RIGHT = 13
PIN_DIR_RIGHT = 6

# The motors are fitted so a LOW direction pin drives the chassis backwards.
# Corrected at the pin, not in the command, so a positive duty still means
# forward everywhere else -- odometry and telemetry both depend on that.
DIR_INVERTED = True

# --- Tunable limits. Change them HERE and nowhere else. ---
MAX_DUTY = 0.75  # ceiling applied to every motor command
MIN_DUTY = 0.25  # below this the gearbox buzzes without turning -> treat as stall
COMMAND_TIMEOUT_S = 0.5  # no command for this long -> full stop

# Seconds a motor may run continuously before being forced to stop.
# 0 disables the limit, which is the default.
#
# A gearbox strips from torque WITHOUT rotation: the motor dumping its full
# stall torque into one or two teeth that are not moving. A freely turning motor
# spreads a much smaller force across teeth that keep rolling through mesh, and
# can run indefinitely. A clock cannot tell those two apart -- it counts seconds
# either way -- so a time limit interrupts normal driving without detecting the
# thing that actually breaks the gearbox.
#
# estimation/obstacle.py infers a stall from flow and acceleration instead. That
# is a heuristic; a current sensor is what would make this real. See
# docs/HARDWARE.md.
MAX_CONTINUOUS_RUN_S = 0.0
PWM_FREQUENCY_HZ = 1000

# How long to wait before trying to claim the motor GPIO again after a failure.
#
# At boot the service can start before lgpio's chip node is ready, and claiming
# a pin that is not there yet fails. Without a retry that failure is permanent
# for the life of the process: the motors stay dead until someone restarts the
# service, which is why redeploying "fixed" them. The IMU already recovers this
# way (see hardware/imu.py); this is the same idea for the drivetrain.
GPIO_RETRY_BACKOFF_S = 5.0

# --- Self test ---
#
# The preflight check cannot confirm a motor without turning it. Nothing on this
# robot measures the drivetrain: there are no encoders and no current sensor, so
# "the GPIO was claimed" is the most a passive check can ever say, and a sheared
# gearbox or an unplugged motor lead passes it.
#
# So self_test() turns them, under limits that make it the smallest movement
# that can still be detected:
#
#   * the two sides run OPPOSITE ways, so the chassis pivots on the spot rather
#     than driving off a manhole cover
#   * MIN_DUTY, the slowest speed the gearbox actually rotates at
#   * a third of a second, long enough for the IMU to register the yaw
#
# It is the only path in this file that moves a motor with no run open, which is
# why it is here, next to the limits, and not in the API layer.
SELF_TEST_S = 0.35

# --- Physical constants, for the speed estimate ---
MOTOR_FREE_RPM = 43.0
WHEEL_DIAMETER_M = 0.090
# 43 RPM on a 90 mm wheel -> about 0.203 m/s -> 20.3 cm/s at full duty.
TOP_SPEED_M_S = (MOTOR_FREE_RPM / 60.0) * (3.14159265 * WHEEL_DIAMETER_M)
TOP_SPEED_CM_S = TOP_SPEED_M_S * 100.0


def clamp_command(value):
    """Clamp a raw -1.0..1.0 command to a legal signed duty cycle.

    Returns 0.0 for anything that would land under MIN_DUTY, because a duty that
    low does not turn the gearbox -- it just holds torque against it.
    """
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 0.0
    if value != value:  # NaN
        return 0.0

    value = max(-1.0, min(1.0, value))
    duty = abs(value) * MAX_DUTY
    if duty < MIN_DUTY:
        return 0.0
    return duty if value >= 0 else -duty


class _MotorBackend:
    """Wraps gpiozero so the rest of the class does not care whether it exists."""

    def __init__(self):
        self.available = False
        self.error = None
        self._attempts = 0
        self._last_attempt_at = None
        self.open()

    def open(self):
        """Try to claim the motor pins. Returns True if the motors are usable.

        Safe to call repeatedly: a backend that is already open returns
        immediately, and a failed attempt leaves every pin released so the next
        one starts from the same place this one did.
        """
        if self.available:
            return True

        self._attempts += 1
        self._last_attempt_at = time.monotonic()

        try:
            from gpiozero import DigitalOutputDevice, PWMOutputDevice
        except ImportError as exc:
            # A missing library is not a race and will not fix itself, but it
            # costs nothing to keep trying and it keeps one code path here.
            self._fail(f"gpiozero unavailable: {exc}")
            return False

        try:
            self.pwm_left = PWMOutputDevice(
                PIN_PWM_LEFT, frequency=PWM_FREQUENCY_HZ, initial_value=0.0
            )
            self.dir_left = DigitalOutputDevice(PIN_DIR_LEFT, initial_value=False)
            self.pwm_right = PWMOutputDevice(
                PIN_PWM_RIGHT, frequency=PWM_FREQUENCY_HZ, initial_value=0.0
            )
            self.dir_right = DigitalOutputDevice(PIN_DIR_RIGHT, initial_value=False)
        except Exception as exc:  # noqa: BLE001 - any GPIO failure must not crash us
            self._fail(f"could not claim motor GPIO: {exc}")
            self._release()
            return False

        if self._attempts > 1:
            log.info("motor GPIO claimed after %d attempts -- motors are live", self._attempts)
        self.error = None
        self.available = True
        return True

    def _fail(self, message):
        """Record why the motors are down, logging it once per distinct reason.

        Retrying every few seconds forever would otherwise fill the journal with
        the same line, and a log that scrolls is a log nobody reads.
        """
        if message != self.error:
            log.error("%s -- motors are DISABLED, will keep retrying", message)
        self.error = message

    def retry_due(self, now):
        """Is it time for another attempt? False while the backend is working."""
        if self.available:
            return False
        return now - self._last_attempt_at >= GPIO_RETRY_BACKOFF_S

    def apply(self, left, right):
        """Write signed duties to the hardware. Direction first, then magnitude."""
        if not self.available:
            return
        self.dir_left.value = (left < 0) != DIR_INVERTED
        self.dir_right.value = (right < 0) != DIR_INVERTED
        self.pwm_left.value = abs(left)
        self.pwm_right.value = abs(right)

    def zero(self):
        if not self.available:
            return
        self.pwm_left.value = 0.0
        self.pwm_right.value = 0.0

    def _release(self):
        for name in ("pwm_left", "dir_left", "pwm_right", "dir_right"):
            device = getattr(self, name, None)
            if device is None:
                continue
            try:
                device.close()
            except Exception:  # noqa: BLE001 - we are already tearing down
                pass
            setattr(self, name, None)

    def close(self):
        try:
            self.zero()
        except Exception:  # noqa: BLE001
            pass
        self._release()
        self.available = False


class Drive:
    """Tank-style drive with the gearbox protections baked in.

    Thread-safe: command() and tick() may be called from different threads.
    """

    def __init__(self):
        self._lock = threading.RLock()
        self._backend = _MotorBackend()
        self._closed = False

        self._left = 0.0  # signed duty currently applied
        self._right = 0.0
        self._last_command_at = time.monotonic()
        self._moving_since = None  # when the motors last went nonzero
        self._last_stop_reason = "startup"
        self._run_limit_tripped = False  # latched until the operator commands zero
        self._armed = False  # no run open -> no movement

        atexit.register(self.close)

    # --- properties ---

    @property
    def hardware_available(self):
        return self._backend.available

    @property
    def armed(self):
        with self._lock:
            return self._armed

    @property
    def duties(self):
        """(left, right) signed duty currently applied. For the estimators."""
        with self._lock:
            return self._left, self._right

    # --- control ---

    def arm(self, armed, reason="run"):
        """Allow or forbid movement. Disarming stops the motors immediately.

        Runs own this: the robot arms when a run opens and disarms when it
        closes. It lives here rather than in the API layer for the same reason
        every other protection does -- so it still holds when the web code is
        what broke.
        """
        with self._lock:
            if self._armed == armed:
                return
            self._armed = armed
            if not armed:
                self._apply(0.0, 0.0)
                self._last_stop_reason = f"disarmed: {reason}"
        log.info("motors %s (%s)", "armed" if armed else "disarmed", reason)

    def command(self, left, right):
        """Accept a raw -1.0..1.0 tank command. Returns the duties actually applied."""
        with self._lock:
            if self._closed:
                return 0.0, 0.0

            # No run open, nothing moves. A command arriving here is not an
            # error -- the console sends a zero throttle continuously whether or
            # not a run is going -- so this refuses quietly rather than raising.
            if not self._armed:
                self._last_command_at = time.monotonic()
                if self._left != 0.0 or self._right != 0.0:
                    self._apply(0.0, 0.0)
                self._last_stop_reason = "no run started"
                return 0.0, 0.0

            self._last_command_at = time.monotonic()
            left = clamp_command(left)
            right = clamp_command(right)

            # The run limit stays latched until the operator lets go. Otherwise
            # holding a key down would re-trip and re-drive forever, which is
            # exactly the jammed-in-a-pipe case we are guarding against.
            if self._run_limit_tripped:
                if left == 0.0 and right == 0.0:
                    self._run_limit_tripped = False
                    self._last_stop_reason = "ready"
                else:
                    self._apply(0.0, 0.0)
                    return 0.0, 0.0

            if left != 0.0 or right != 0.0:
                self._last_stop_reason = None
            elif self._last_stop_reason is None:
                self._last_stop_reason = "commanded zero"

            self._apply(left, right)
            return self._left, self._right

    def self_test(self, seconds=SELF_TEST_S, reverse=False):
        """Pivot the chassis on the spot, briefly, so the caller can see it move.

        Both motors run together, opposed. They are never tested one at a time:
        a single motor has to drag the chassis and the other, unpowered gearbox
        with it, and at MIN_DUTY that is the case most likely to stall -- so
        testing them separately would manufacture the failure it went looking
        for. `reverse` swaps which way the pivot goes; see motor_probe, which
        uses it to tell a gearbox that is stuck from one that is broken.

        Deliberately bypasses `armed`: the whole point is to test the motors
        BEFORE a run opens. Every other protection still applies -- the duty is
        MIN_DUTY, the direction is opposed so there is no net travel, and the
        lock is held for the whole pulse so no command, watchdog tick or second
        self test can interleave with it.

        Returns (ran, reason). It never raises: a preflight probe that throws
        would leave the motors in whatever state it died in.
        """
        try:
            seconds = float(seconds)
        except (TypeError, ValueError):
            seconds = SELF_TEST_S
        # Bounded here rather than trusted from the caller. A self test is a
        # fixed, known movement; a caller that could lengthen it could drive.
        seconds = max(0.05, min(SELF_TEST_S, seconds))

        with self._lock:
            if self._closed:
                return False, "drive is closed"
            if not self._backend.available:
                return False, "no motor hardware"

            try:
                duty = -MIN_DUTY if reverse else MIN_DUTY
                self._apply(duty, -duty)
                time.sleep(seconds)
            finally:
                # Every exit path stops the motors, including an exception
                # inside the sleep. This is the one place in the file where a
                # missed stop would leave a robot driving with no run open.
                self._apply(0.0, 0.0)
                self._last_command_at = time.monotonic()
                self._last_stop_reason = "self test complete"

        log.info(
            "motor self test: pivoted %s for %.2fs",
            "counter-clockwise" if reverse else "clockwise",
            seconds,
        )
        return True, ""

    def stop(self, reason="stop"):
        """Immediate all-stop. Safe to call from anywhere, including a dead socket."""
        with self._lock:
            if self._closed:
                return
            self._apply(0.0, 0.0)
            self._last_stop_reason = reason
            log.info("motors stopped: %s", reason)

    def tick(self):
        """Enforce the time-based limits. Call this at >= 10 Hz.

        Kept here rather than in the web layer so the protections hold even if
        the server, the socket, or the browser is the thing that broke.
        """
        with self._lock:
            if self._closed:
                return
            now = time.monotonic()

            # Before the limits, because a backend that came up late has to be
            # picked up whether or not the robot is moving -- and if it is not
            # available, it is not moving, so this is the only path that runs.
            if self._backend.retry_due(now) and self._backend.open():
                # Come up STOPPED, never at whatever was last commanded.
                # command() keeps recording duties while the hardware is down,
                # so an operator who was holding a key against a dead robot has
                # a nonzero duty sitting here -- writing that to freshly claimed
                # pins would make the robot lurch the instant it recovered.
                # This also drives both direction pins to a known state rather
                # than inheriting whatever the last process left on them.
                self._apply(0.0, 0.0)
                self._last_command_at = now
                self._last_stop_reason = "motors reconnected"
                log.info("motors reconnected, stopped -- command again to drive")

            if self._left == 0.0 and self._right == 0.0:
                return

            if now - self._last_command_at > COMMAND_TIMEOUT_S:
                self._apply(0.0, 0.0)
                self._last_stop_reason = "watchdog: no command for 500 ms"
                log.warning("WATCHDOG TRIPPED - motors cut")
                return

            if (
                MAX_CONTINUOUS_RUN_S > 0
                and self._moving_since is not None
                and now - self._moving_since > MAX_CONTINUOUS_RUN_S
            ):
                self._apply(0.0, 0.0)
                self._run_limit_tripped = True
                self._last_stop_reason = (
                    f"run limit: {MAX_CONTINUOUS_RUN_S:.0f} s continuous, "
                    "release to reset"
                )
                log.warning("RUN LIMIT TRIPPED - motors cut")

    def _apply(self, left, right):
        """Write to hardware and maintain the continuous-run clock. Holds _lock."""
        now = time.monotonic()
        moving = left != 0.0 or right != 0.0
        if moving and self._moving_since is None:
            self._moving_since = now
        elif not moving:
            self._moving_since = None

        self._left = left
        self._right = right
        try:
            self._backend.apply(left, right)
        except Exception as exc:  # noqa: BLE001 - never let a GPIO glitch kill control
            log.error("motor write failed: %s", exc)

    # --- telemetry ---

    def status(self):
        with self._lock:
            now = time.monotonic()
            run_elapsed = (
                now - self._moving_since if self._moving_since is not None else 0.0
            )
            return {
                "left_duty": round(self._left, 3),
                "right_duty": round(self._right, 3),
                "commanded_speed_m_s": round(
                    (self._left + self._right) / 2.0 * TOP_SPEED_M_S, 3
                ),
                "moving": self._left != 0.0 or self._right != 0.0,
                # False until a run is open. The console reads this to explain
                # why the keys do nothing, rather than leaving an operator
                # jabbing at W wondering whether the robot has died.
                "armed": self._armed,
                "run_seconds": round(run_elapsed, 1),
                "run_limit_tripped": self._run_limit_tripped,
                "last_stop_reason": self._last_stop_reason,
                "hardware": self._backend.available,
                # Why the motors are down, for the console to show instead of
                # leaving an operator to guess. None whenever hardware is True.
                "hardware_error": self._backend.error,
                "max_duty": MAX_DUTY,
                "min_duty": MIN_DUTY,
            }

    # --- teardown ---

    def close(self):
        """Release PWM. Idempotent, so atexit and an explicit call cannot double-free."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._backend.close()
            self._left = 0.0
            self._right = 0.0
            log.info("drive closed, PWM released")
