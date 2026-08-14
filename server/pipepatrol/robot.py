"""One object that owns every subsystem, and the loops that drive them.

The API layer holds a reference to this and nothing else. That keeps the web
code from reaching into hardware directly, and it means the shutdown path is a
single call that cannot miss a device.

Two loops, deliberately separate:

  watchdog    20 Hz. Only calls drive.tick(). Nothing else is allowed in here --
              it is the loop that has to keep running when everything else is
              broken, so it has as little to break as possible.

  estimators  10 Hz. Odometry, hazards, and the run's path samples.

Path samples are buffered in memory and flushed to disk on an interval. Writing
run.json on every sample would rewrite the whole file at walking pace, and the
disk underneath is an SD card with a finite write budget.
"""

import logging
import time

from pipepatrol import config, telemetry
from pipepatrol.estimation import Hazards, OpticalFlow, Odometry
from pipepatrol.hardware import Camera, Climate, Drive, IMU, Lights, host
from pipepatrol.perception import DetectionService, best_detector, rediscover_detector
from pipepatrol.runs import Recorder, RunStore

log = logging.getLogger(__name__)

PATH_FLUSH_INTERVAL_S = 10.0


class Robot:
    def __init__(self, store=None):
        self.drive = Drive()
        self.lights = Lights()
        self.imu = IMU()
        self.climate = Climate()
        self.camera = Camera()

        self.flow = OpticalFlow(self.camera)
        self.odometry = Odometry(self.flow)
        self.hazards = Hazards(self.drive, self.imu, self.flow)

        self.store = store or RunStore()
        self.recorder = Recorder(
            self.camera,
            self.store,
            # Stamps each clip with the stretch of pipe it covers, which is what
            # lets the longitudinal view draw where a recording was taken.
            chainage=lambda: self.odometry.status()["chainage_m"],
        )
        self.detections = DetectionService(
            self.camera,
            # Whichever backend is selected, and an honest absence when none
            # is usable. Either way the console renders detections the same way.
            detector=best_detector(),
            chainage_source=lambda: self.odometry.status()["chainage_m"],
            # The robot is almost always up before the laptop joins its network,
            # so the host chosen above is routinely stale by the first frame.
            # This is what lets it correct itself mid-run.
            rediscover=rediscover_detector,
        )

        self._active_run_id = None
        self._path_buffer = []
        self._path_dirty = False
        self._last_path_flush = time.monotonic()
        self._closed = False

    # --- lifecycle ---

    def start(self):
        self.flow.start()
        self.detections.start()
        log.info(
            "robot up: motors=%s imu=%s camera=%s leds=%s flow=%s climate=%s",
            self.drive.hardware_available,
            self.imu.status()["state"],
            self.camera.available,
            self.lights.available,
            self.flow.available,
            # State, not availability: the sensor takes a few seconds to
            # produce its first reading, so `available` is False at this point
            # even when it is wired and working.
            self.climate.status()["state"],
        )

    def close(self, reason="shutdown"):
        """Release everything. Idempotent -- atexit, signals and lifespan all call it."""
        if self._closed:
            return
        self._closed = True
        log.info("releasing hardware (%s)", reason)

        # End the run first: it is the only step that can still be saved, and
        # the hardware teardown below must not be able to skip it.
        if self._active_run_id is not None:
            try:
                self.end_run()
            except Exception as exc:  # noqa: BLE001
                log.error("could not close the active run: %s", exc)

        for name, closer in (
            ("drive", self.drive.close),
            ("recorder", self.recorder.stop),
            ("detections", self.detections.close),
            ("flow", self.flow.close),
            ("lights", self.lights.close),
            ("imu", self.imu.close),
            ("climate", self.climate.close),
            ("camera", self.camera.close),
        ):
            try:
                closer()
            except Exception as exc:  # noqa: BLE001 - one failure must not skip the rest
                log.error("error closing %s: %s", name, exc)

    # --- loops ---

    def tick_watchdog(self):
        """20 Hz. Motor safety only."""
        self.drive.tick()

    def tick_estimators(self, now=None):
        """10 Hz. Everything derived."""
        now = time.monotonic() if now is None else now
        state = self.odometry.update(now)
        self.hazards.update(speed_m_s=state.speed_m_s, now=now)
        self._sample_path(state, now)

    def _sample_path(self, state, now):
        if self._active_run_id is None:
            return

        last = self._path_buffer[-1] if self._path_buffer else None
        moved = (
            abs(state.chainage_m - last["chainage_m"])
            if last
            else abs(state.chainage_m)
        )
        room = len(self._path_buffer) < config.PATH_MAX_POINTS
        if room and (last is None or moved >= config.PATH_SAMPLE_INTERVAL_M):
            self._path_buffer.append(
                {
                    "chainage_m": round(state.chainage_m, 2),
                    "x": round(state.x_m, 2),
                    "y": round(state.y_m, 2),
                    "heading_deg": round(state.heading_deg, 1),
                    "uncertainty_m": round(state.uncertainty_m, 2),
                    "at": round(time.time(), 1),
                }
            )
            self._path_dirty = True

        if self._path_dirty and now - self._last_path_flush >= PATH_FLUSH_INTERVAL_S:
            self.flush_path()

    def flush_path(self):
        if self._active_run_id is None or not self._path_dirty:
            return
        self.store.update(self._active_run_id, path=list(self._path_buffer))
        self._path_dirty = False
        self._last_path_flush = time.monotonic()

    # --- run control ---

    @property
    def active_run_id(self):
        return self._active_run_id

    def start_run(self, name="", record=False, origin=None):
        """Begin a run. Ends any run already open, so there is only ever one.

        `origin` is where the operator says the robot went in: {"lat", "lon",
        "bearing_deg"}, or None when they did not place it. Everything the
        odometer produces is relative to that point.
        """
        if self._active_run_id is not None:
            self.end_run()

        run = self.store.create(name, origin=self._resolve_bearing(origin))
        self._active_run_id = run.id
        self._path_buffer = []
        self._path_dirty = False
        self._last_path_flush = time.monotonic()
        self.odometry.reset()
        # Movement is a thing that belongs to a run. Nothing drives until here.
        self.drive.arm(True, reason=f"run {run.id}")

        if record:
            self.recorder.start(run.id)
        return run

    def _resolve_bearing(self, origin):
        """Fill in the entry bearing the operator did not give.

        If north has been set (hardware/imu.py set_north) the robot knows which
        way it is pointing right now, and that is exactly the number wanted. If
        it has not, the track is drawn as though the robot entered heading
        north -- which is a guess, and the console says so rather than dressing
        it up as a measurement.
        """
        if not isinstance(origin, dict) or origin.get("bearing_deg") is not None:
            return origin
        heading = self.imu.heading_deg
        return {**origin, "bearing_deg": heading if heading is not None else 0.0}

    def end_run(self):
        if self._active_run_id is None:
            return None
        run_id = self._active_run_id

        # Before anything that can fail. The run closing is the moment the
        # robot must stop being drivable, and a store write throwing must not
        # leave it armed.
        self.drive.arm(False, reason="run ended")

        if self.recorder.active:
            self.recorder.stop()

        self.flush_path()
        state = self.odometry.status()
        run = self.store.end(
            run_id,
            distance_m=state["distance_travelled_m"],
            uncertainty_m=state["uncertainty_m"],
        )
        self._active_run_id = None
        self._path_buffer = []
        return run

    def resume_run(self, run_id):
        """Reopen an interrupted run so its recording continues into the same file.

        Odometry is NOT reset: the robot is wherever it was left, and pretending
        the chainage is zero would put every defect logged afterwards in the
        wrong place.
        """
        run = self.store.get(run_id)
        if run is None or not run.interrupted:
            return None
        if self._active_run_id is not None:
            self.end_run()
        self._active_run_id = run_id
        self._path_buffer = list(run.path)
        self._path_dirty = False
        self.drive.arm(True, reason=f"resumed run {run_id}")
        log.info("resumed interrupted run %s", run_id)
        return run

    def snapshot(self):
        """Save the current frame into the active run. None if either is missing."""
        if self._active_run_id is None:
            return None
        jpeg = self.camera.latest_jpeg()
        if jpeg is None:
            return None
        return self.store.add_snapshot(
            self._active_run_id,
            jpeg,
            chainage_m=self.odometry.status()["chainage_m"],
        )

    # --- telemetry helpers, called by telemetry.build ---

    def telemetry(self):
        return telemetry.build(self)

    def host_status(self):
        return host.status()

    def battery(self):
        return host.battery()

    def motor_current(self):
        return host.motor_current()

    def run_status(self):
        if self._active_run_id is None:
            return {"active": False, "id": None, "name": None, "started_at": None}
        run = self.store.get(self._active_run_id)
        if run is None:
            return {"active": False, "id": None, "name": None, "started_at": None}
        return {
            "active": True,
            "id": run.id,
            "name": run.name,
            "started_at": run.started_at,
            "defect_count": len(run.defects),
            "snapshot_count": len(run.snapshots),
        }
