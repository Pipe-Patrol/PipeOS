/**
 * The simulated robot: physics, sensors, and the telemetry envelope.
 *
 * Ticks at 10 Hz, the same rate `api/control.py` pushes at. The numbers it
 * produces are meant to be *plausible*, not merely non-null — a UI built
 * against a robot that always reads 0.00 m at 0.00 m/s hides every bug that
 * only shows up once something is moving.
 *
 * Three behaviours are copied from the real server on purpose, because the
 * console has code that only runs when they happen:
 *
 *   armed      the motors refuse every command until a run is open
 *   watchdog   500 ms without a command is a full stop
 *   duty floor anything under MIN_DUTY snaps to zero (hardware/drive.py)
 *
 * The envelope is `web/src/robot/types.ts`. Change that file and this is wrong
 * until someone changes it here too.
 */

import type { Detection, Telemetry } from '../web/src/robot/types'

import * as runs from './runs'

// --- constants, lifted from the server so the numbers agree ---

/** hardware/drive.py */
const MAX_DUTY = 0.75
const MIN_DUTY = 0.25
const COMMAND_TIMEOUT_MS = 500
/**
 * 43 RPM on a 90 mm wheel — about 0.203 m/s at 100% duty.
 *
 * Nothing ever commands 100%: MAX_DUTY caps it at 0.75, so full throttle is
 * 0.152 m/s. Speed is duty x this, exactly as `drive.status()` computes
 * `commanded_speed_m_s` — do not rescale it by MAX_DUTY, or the simulator
 * drives a third faster than the robot reports.
 */
const TOP_SPEED_M_S = (43.0 / 60.0) * (Math.PI * 0.09)

/** config.py */
const TICK_MS = 100

/** Matches DETECTION_TTL_S on the server, so injected boxes age out as real ones do. */
const DETECTION_TTL_S = 6
const PATH_SAMPLE_INTERVAL_M = 0.25

/** Full differential turns this fast. Guessed, but the right order of size. */
const MAX_YAW_RATE_DEG_S = 55
/** How long the drivetrain takes to reach a new commanded speed. */
const SPEED_LAG_S = 0.35

/**
 * Clamp a raw -1..1 command to a legal signed duty.
 *
 * Straight out of `drive.clamp_command`. The floor is the interesting half: a
 * duty under MIN_DUTY buzzes the gearbox without turning the wheel, so it is
 * treated as a stop rather than as a slow crawl. It means the robot does not
 * move at all until roughly a third of throttle.
 */
function clampCommand(value: number): number {
  if (!Number.isFinite(value)) return 0
  const duty = Math.min(Math.abs(value), 1) * MAX_DUTY
  if (duty < MIN_DUTY) return 0
  return value < 0 ? -duty : duty
}

interface Tuning {
  brightness: number
  contrast: number
  dehaze: boolean
  sharpness: number
}

class SimRobot {
  // commands
  private left = 0
  private right = 0
  private lastCommandAt = 0
  private lastStopReason: string | null = null

  // pose and odometry
  private speed = 0
  private lastSpeed = 0
  private headingDeg = 0
  private x = 0
  private y = 0
  private distanceM = 0
  private chainageM = 0
  private lastPathAtM = -Infinity

  // sensors
  private bootedAt = Date.now()
  private yawDeg = 0
  private northOffsetDeg: number | null = null
  private northStale = false

  // devices
  private ledLevel = 0
  private tuning: Tuning = { brightness: 0, contrast: 0, dehaze: false, sharpness: 0 }

  // recording
  private recordingSince: number | null = null
  private recordedFrames = 0

  // Deliberate air spike and fake model output, both driven from the console's
  // testing keys. Neither happens on its own.
  private climateOffset: { temp: number; humidity: number; until: number } | null = null
  private injected: Detection[] = []
  /** Real model output for a supplied frame. See demo-bridge.ts. */
  supplied: Detection[] = []

  private movingSince: number | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private listeners = new Set<(telemetry: Telemetry) => void>()
  private latest: Telemetry | null = null
  private halted = false

  // --- lifecycle ---

  start(): void {
    if (this.timer !== null) return
    runs.seed()
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  /**
   * Everything stops, as it would on a real halt.
   *
   * The console's shutdown flow is worth being able to test end to end, and the
   * half of it that matters is what happens *after* — the socket dying and the
   * link going red. So the simulator really does go away. Reload the page and
   * press T twice to bring it back.
   */
  halt(): void {
    this.halted = true
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.stop('shutdown')
  }

  get isHalted(): boolean {
    return this.halted
  }

  /** The last envelope pushed. Backs `GET /api/telemetry`. */
  telemetry(): Telemetry | null {
    return this.latest
  }

  subscribe(listener: (telemetry: Telemetry) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // --- commands ---

  drive(left: number, right: number): void {
    this.left = clampCommand(left)
    this.right = clampCommand(right)
    this.lastCommandAt = Date.now()
    if (this.left !== 0 || this.right !== 0) this.lastStopReason = null
  }

  stop(reason: string): void {
    this.left = 0
    this.right = 0
    this.lastStopReason = reason
  }

  setLed(level: number): number {
    this.ledLevel = Math.min(1, Math.max(0, Number(level) || 0))
    return this.ledLevel
  }

  get led(): number {
    return this.ledLevel
  }

  setTuning(patch: Partial<Tuning>): Tuning {
    if (typeof patch.brightness === 'number') {
      this.tuning.brightness = Math.min(1, Math.max(-1, patch.brightness))
    }
    if (typeof patch.contrast === 'number') {
      this.tuning.contrast = Math.min(1, Math.max(-1, patch.contrast))
    }
    if (typeof patch.dehaze === 'boolean') this.tuning.dehaze = patch.dehaze
    if (typeof patch.sharpness === 'number') {
      this.tuning.sharpness = Math.min(1, Math.max(0, patch.sharpness))
    }
    return { ...this.tuning }
  }

  /** Anchor the relative yaw to a real bearing. */
  setNorth(facingDeg: number): { facing_deg: number; yaw_deg: number } {
    this.northOffsetDeg = (facingDeg - this.yawDeg + 360) % 360
    this.northStale = false
    return { facing_deg: facingDeg, yaw_deg: this.yawDeg }
  }

  clearNorth(): void {
    this.northOffsetDeg = null
    this.northStale = false
  }

  startRecording(): void {
    this.recordingSince = Date.now()
    this.recordedFrames = 0
  }

  stopRecording(): void {
    this.recordingSince = null
    this.recordedFrames = 0
  }

  get recording(): boolean {
    return this.recordingSince !== null
  }

  /**
   * Push the air, and put something in front of the camera.
   *
   * Both of the things Phase 2 added — the spike warning and auto flagging —
   * only ever fire on a real pipe, which makes them the two features most
   * likely to ship broken. The simulator drifts the climate smoothly and
   * reports no detections at all by design, so neither can happen by accident
   * here; these are the deliberate way to make them happen.
   */
  injectClimateSpike(): void {
    // Big enough to clear the console's threshold several times over, and held
    // long enough to survive its baseline window.
    this.climateOffset = { temp: 6.5, humidity: 22, until: Date.now() + 25_000 }
  }

  injectDetection(label: string): void {
    // Roughly centred, roughly a quarter of the frame — the shape of a real
    // box rather than a full-frame rectangle that would hide the label test.
    const x = 0.28 + Math.random() * 0.2
    const y = 0.24 + Math.random() * 0.2
    this.injected.push({
      id: `sim-${Date.now().toString(36)}`,
      label,
      confidence: 0.62 + Math.random() * 0.33,
      box: [x, y, x + 0.26, y + 0.3],
      at: Date.now() / 1000,
      chainage_m: round(this.chainageM, 3),
    })
  }

  /** What api.ts stamps onto a defect. Mirrors `odometry.status()`. */
  motion(): { chainage_m: number; uncertainty_m: number } {
    return { chainage_m: round(this.chainageM, 3), uncertainty_m: round(this.uncertainty(), 3) }
  }

  /** A run that has just opened starts its odometer from here. */
  resetOdometer(): void {
    this.chainageM = 0
    this.x = 0
    this.y = 0
    this.headingDeg = 0
    this.lastPathAtM = -Infinity
  }

  // --- the tick ---

  private uncertainty(): number {
    // Grows with distance and never comes back down — nothing underground can
    // re-fix the estimate. The time term is the drift while parked.
    const runSeconds = (Date.now() - this.bootedAt) / 1000
    return 0.03 * this.distanceM + 0.0015 * runSeconds
  }

  private tick(): void {
    const dt = TICK_MS / 1000
    const now = Date.now()

    // The watchdog. A console that stopped sending is indistinguishable from a
    // console that went away, and both mean stop.
    if (this.lastCommandAt && now - this.lastCommandAt > COMMAND_TIMEOUT_MS) {
      if (this.left !== 0 || this.right !== 0) this.stop('command timeout')
    }

    const activeRunId = runs.activeId()
    const armed = activeRunId !== null
    const left = armed ? this.left : 0
    const right = armed ? this.right : 0

    if (left !== 0 || right !== 0) {
      this.movingSince ??= now
    } else {
      this.movingSince = null
    }

    // First-order lag toward the commanded speed, so the readout ramps the way
    // a gearbox does instead of stepping.
    const target = ((left + right) / 2) * TOP_SPEED_M_S
    this.lastSpeed = this.speed
    this.speed += (target - this.speed) * (1 - Math.exp(-dt / SPEED_LAG_S))
    if (Math.abs(this.speed) < 0.001) this.speed = 0

    const yawRate = ((right - left) / (2 * MAX_DUTY)) * MAX_YAW_RATE_DEG_S
    this.headingDeg = (this.headingDeg + yawRate * dt + 360) % 360
    // Yaw drifts against the heading — that is the whole reason it is labelled
    // relative and never called a compass bearing.
    this.yawDeg = (this.headingDeg + 0.004 * ((now - this.bootedAt) / 1000) + 360) % 360

    const step = this.speed * dt
    const radians = (this.headingDeg * Math.PI) / 180
    this.x += step * Math.cos(radians)
    this.y += step * Math.sin(radians)
    this.distanceM += Math.abs(step)
    this.chainageM += step

    if (activeRunId) {
      runs.updateOdometry(activeRunId, round(this.distanceM, 3), round(this.uncertainty(), 3))
      // Sampled by distance, not by time: a robot parked for two minutes should
      // not add two minutes of identical points.
      if (Math.abs(this.chainageM - this.lastPathAtM) >= PATH_SAMPLE_INTERVAL_M) {
        this.lastPathAtM = this.chainageM
        runs.addPathPoint(activeRunId, {
          chainage_m: round(this.chainageM, 3),
          x: round(this.x, 3),
          y: round(this.y, 3),
          heading_deg: round(this.headingDeg, 1),
          uncertainty_m: round(this.uncertainty(), 3),
          at: now / 1000,
        })
      }
    }

    if (this.recordingSince !== null) this.recordedFrames += 1

    const telemetry = this.envelope(now, left, right, armed, activeRunId)
    this.latest = telemetry
    for (const listener of this.listeners) listener(telemetry)
  }

  // --- the envelope ---

  /** Slow, bounded wander so a readout is never frozen and never jumps. */
  private drift(periodS: number, amplitude: number, phase = 0): number {
    const t = (Date.now() - this.bootedAt) / 1000
    return amplitude * Math.sin((2 * Math.PI * t) / periodS + phase)
  }

  private envelope(
    now: number,
    left: number,
    right: number,
    armed: boolean,
    activeRunId: string | null,
  ): Telemetry {
    const run = activeRunId ? runs.get(activeRunId) : null
    const uptimeS = (now - this.bootedAt) / 1000
    const accel = (this.speed - this.lastSpeed) / (TICK_MS / 1000)

    const headingDeg =
      this.northOffsetDeg === null || this.northStale
        ? null
        : round((this.yawDeg + this.northOffsetDeg) % 360, 1)

    // Both injections expire on their own, so a test does not leave the
    // simulator permanently hot or permanently seeing cracks.
    if (this.climateOffset && now > this.climateOffset.until) this.climateOffset = null
    const spike = this.climateOffset ?? { temp: 0, humidity: 0 }
    if (this.injected.length > 0) {
      this.injected = this.injected.filter(
        (detection) => now / 1000 - detection.at < DETECTION_TTL_S,
      )
    }

    return {
      type: 'telemetry',
      at: now / 1000,

      drive: {
        left_duty: round(left, 3),
        right_duty: round(right, 3),
        commanded_speed_m_s: round(((left + right) / 2) * TOP_SPEED_M_S, 3),
        moving: left !== 0 || right !== 0,
        armed,
        run_seconds: this.movingSince === null ? 0 : round((now - this.movingSince) / 1000, 1),
        run_limit_tripped: false,
        last_stop_reason: this.lastStopReason,
        hardware: true,
        max_duty: MAX_DUTY,
        min_duty: MIN_DUTY,
      },

      orientation: {
        quality: 'measured',
        pitch_deg: round(this.drift(23, 3.5) + this.drift(6.1, 0.8), 1),
        roll_deg: round(this.drift(31, 2.5, 1.1) + this.drift(4.7, 0.6), 1),
        yaw_deg: round(this.yawDeg, 1),
        yaw_is_relative: true,
        heading_deg: headingDeg,
        north_set: this.northOffsetDeg !== null,
        north_stale: this.northStale,
        accel_m_s2: round(accel + this.drift(2.3, 0.05), 3),
        state: 'ok',
      },

      motion: {
        quality: 'estimated',
        distance_travelled_m: round(this.distanceM, 3),
        chainage_m: round(this.chainageM, 3),
        speed_m_s: round(this.speed, 3),
        uncertainty_m: round(this.uncertainty(), 3),
        heading_deg: round(this.headingDeg, 1),
        position: { x: round(this.x, 3), y: round(this.y, 3) },
        source: this.speed === 0 ? 'stopped' : 'inertial+flow',
        slipping: false,
        calibrated: true,
        accel_m_s2: round(accel, 3),
      },

      // No voltage or current sensor is fitted. The console draws its blanks
      // from exactly this, so faking a battery percentage here would hide the
      // unavailable-reading UI entirely.
      power: {
        battery: {
          quality: 'unavailable',
          available: false,
          note: 'no battery sensor fitted',
          percent: null,
          volts: null,
        },
        motor_current: {
          quality: 'unavailable',
          available: false,
          note: 'no current sensor fitted',
          amps: null,
        },
      },

      camera: {
        available: true,
        source: 'csi',
        resolution: '1280x720',
        tuning: { ...this.tuning },
        error: null,
      },

      lights: {
        duty: round(this.ledLevel * MAX_DUTY, 3),
        level: round(this.ledLevel, 3),
        available: true,
      },

      host: {
        cpu_temp_c: round(48 + this.drift(47, 4) + this.drift(11, 1.2), 1),
        temp_state: 'ok',
        uptime_s: Math.round(uptimeS),
        wifi: {
          interface: 'wlan0',
          quality_pct: Math.round(68 + this.drift(19, 9)),
          signal_dbm: Math.round(-54 + this.drift(19, 5)),
        },
        // A 64 GB card. Free space falls as a recording is written, so the
        // storage readout is not a constant the eye learns to skip.
        storage: (() => {
          const total = 62_914_560_000
          const free = Math.max(0, 41_300_000_000 - this.recordedFrames * 48_000)
          return {
            total_bytes: total,
            free_bytes: free,
            used_pct: round(((total - free) / total) * 100, 1),
          }
        })(),
      },

      climate: {
        quality: 'measured',
        available: true,
        temperature_c: round(19.5 + this.drift(97, 1.4) + spike.temp, 1),
        humidity_pct: round(64 + this.drift(61, 5.5) + spike.humidity, 1),
      },

      // Nothing synthetic here by choice — see README. The obstacle and stall
      // estimators are left quiet so the alert bar reflects what the operator
      // does, not a script.
      hazards: { stalled: false, obstruction: null, time_to_contact_s: null },

      // Hand-injected boxes, plus whatever the real model returned for a
      // supplied frame.
      detections: [...this.injected, ...this.supplied],

      perception: {
        backend: 'simulated',
        available: this.supplied.length > 0,
        last_inference_ms: null,
        error: 'the detector is not simulated',
      },

      flow: {
        available: true,
        error: null,
        divergence_per_s: round(this.speed * 0.8 + this.drift(3.7, 0.03), 3),
        magnitude_px_s: round(Math.abs(this.speed) * 240 + this.drift(2.9, 3), 1),
        features: 120 + Math.round(this.drift(13, 25)),
        valid: true,
      },

      run: {
        active: run !== null && run !== undefined,
        id: activeRunId,
        name: run?.name ?? null,
        started_at: run?.started_at ?? null,
        defect_count: run?.defects.length ?? 0,
        snapshot_count: run?.snapshots.length ?? 0,
      },

      recording: {
        active: this.recordingSince !== null,
        run_id: this.recordingSince !== null ? activeRunId : null,
        frames: this.recordedFrames,
        // ~48 KB a frame, which is what a 720p MJPEG frame off this camera runs.
        bytes: this.recordedFrames * 48_000,
        elapsed_s:
          this.recordingSince === null ? null : round((now - this.recordingSince) / 1000, 1),
        error: null,
      },

      alert: null,
    }
  }
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export const robot = new SimRobot()
