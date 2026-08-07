/**
 * ============================================================================
 *  THE COUPLING FILE
 * ============================================================================
 *
 * This mirrors the envelope built by `server/pipepatrol/telemetry.py`. It is the
 * only thing binding the console to the server — no codegen, no shared package.
 * Change the shape there and this is wrong until someone changes it here.
 *
 * The three quality tiers are the load-bearing idea. Every reading is one of
 * them and the console renders each differently, so an operator can never
 * mistake a derived number for a measured one, or a blank for a zero.
 */

import type { Origin } from '@/components/map/geo'

export type Quality = 'measured' | 'estimated' | 'unavailable'

/** IMU health. `degraded` still carries values; `absent` never does. */
export type SensorState = 'ok' | 'degraded' | 'absent'

export interface DriveStatus {
  left_duty: number
  right_duty: number
  commanded_speed_m_s: number
  moving: boolean
  /**
   * False until a run is open. The robot refuses every drive command while it
   * is false — see hardware/drive.py — so this is the state of the motors, not
   * a hint about the UI.
   */
  armed: boolean
  run_seconds: number
  run_limit_tripped: boolean
  last_stop_reason: string | null
  /** False when the GPIO could not be claimed. The console locks driving. */
  hardware: boolean
  max_duty: number
  min_duty: number
}

export interface Orientation {
  quality: Quality | SensorState
  pitch_deg: number | null
  roll_deg: number | null
  /**
   * Relative to startup, and drifting. Game rotation vector has no
   * magnetometer, so this is NOT a compass bearing — never label it north.
   */
  yaw_deg: number | null
  yaw_is_relative: true
  /**
   * Absolute compass bearing, 0..360. Null until an operator has set the north
   * reference from Settings, and null again if the IMU reconnects and
   * invalidates it — never a silent fall back to the relative yaw.
   */
  heading_deg: number | null
  north_set: boolean
  /** Set once, then the sensor restarted. It has to be done again. */
  north_stale: boolean
  accel_m_s2: number | null
  state: SensorState
}

/** Distance and speed. Always estimated — there are no wheel encoders. */
export interface Motion {
  quality: 'estimated'
  /** Odometer. Never decreases, even reversing. */
  distance_travelled_m: number
  /** Signed distance from where the run started. */
  chainage_m: number
  speed_m_s: number
  /** Grows monotonically. Nothing underground can re-fix it. */
  uncertainty_m: number
  heading_deg: number
  position: { x: number; y: number }
  /**
   * Which estimator produced the current speed. The `inertial` pair integrate
   * IMU acceleration; the others are the fallback when no accelerometer is
   * fitted. See estimation/odometry.py.
   */
  source: 'inertial' | 'inertial+flow' | 'fused' | 'duty' | 'stopped'
  /** Wheels turning, picture not. */
  slipping: boolean
  calibrated: boolean
  accel_m_s2: number | null
}

/** A reading with no sensor behind it. `percent` is always null today. */
export interface UnavailableReading {
  quality: 'unavailable'
  available: false
  note: string
  percent?: number | null
  volts?: number | null
  amps?: number | null
}

/**
 * State of charge. `available` is false and `percent` null until a sensor is
 * fitted, and the console must keep saying so rather than drawing a full cell:
 * see BudgetStrip, which prints "no sensor" instead of a number.
 */
export interface BatteryReading {
  quality: Quality
  available: boolean
  note: string
  percent: number | null
  volts?: number | null
  amps?: number | null
}

export interface Power {
  battery: BatteryReading
  motor_current: UnavailableReading
}

export interface CameraStatus {
  available: boolean
  source: 'csi' | 'usb' | null
  resolution: string | null
  /**
   * Orientation is absent on purpose. The frame is turned 180° on the robot to
   * correct how the camera is mounted, before anything downstream sees it — so
   * there is nothing here to set and nothing for the console to undo.
   */
  tuning: {
    brightness: number
    contrast: number
    /** Both of these run a pixel worker on the robot; the sensor controls do not. */
    dehaze: boolean
    /** 0..1. Unsharp-mask amount; 0 is off. */
    sharpness: number
  }
  error: string | null
}

export interface LightsStatus {
  /** Raw duty. The hardware cap lives server-side; the console never sees it. */
  duty: number
  /** 0..1 of the usable range. This is what the slider binds to. */
  level: number
  available: boolean
}

export interface HostStatus {
  cpu_temp_c: number | null
  temp_state: 'ok' | 'warm' | 'critical' | 'unknown'
  uptime_s: number | null
  wifi: { interface: string; quality_pct: number; signal_dbm: number } | null
  storage: { total_bytes: number; free_bytes: number; used_pct: number | null } | null
}

/** Air temperature and humidity from the DHT on GPIO4. Blank when silent. */
export interface ClimateReading {
  quality: Quality
  available: boolean
  temperature_c: number | null
  humidity_pct: number | null
}

export interface Hazards {
  /** Inferred, not measured — no current sensor. Raises an alert, never stops. */
  stalled: boolean
  obstruction: {
    level: 'warning' | 'critical'
    estimated_distance_m: number | null
  } | null
  /** Seconds, from the reciprocal of flow divergence. Needs no calibration. */
  time_to_contact_s: number | null
}

export interface Detection {
  id: string
  label: string
  confidence: number
  /** Normalised xyxy against the whole frame, or null when unlocalised. */
  box: [number, number, number, number] | null
  /** Epoch seconds. The overlay fades these out rather than implying currency. */
  at: number
  chainage_m: number | null
}

export interface RunStatus {
  active: boolean
  id: string | null
  name: string | null
  started_at: number | null
  defect_count?: number
  snapshot_count?: number
}

export interface RecordingStatus {
  active: boolean
  run_id: string | null
  frames: number
  bytes: number
  elapsed_s: number | null
  error: string | null
}

/** The single line across the top. One at a time, most urgent wins. */
export interface Alert {
  level: 'warning' | 'critical'
  message: string
}

export interface Telemetry {
  type: 'telemetry'
  at: number
  drive: DriveStatus
  orientation: Orientation
  motion: Motion
  power: Power
  camera: CameraStatus
  lights: LightsStatus
  host: HostStatus
  climate: ClimateReading
  hazards: Hazards
  detections: Detection[]
  perception: {
    backend: string
    available: boolean
    last_inference_ms: number | null
    error: string | null
  }
  flow: {
    available: boolean
    error: string | null
    divergence_per_s: number
    magnitude_px_s: number
    features: number
    valid: boolean
  }
  run: RunStatus
  recording: RecordingStatus
  alert: Alert | null
}

// ---------------------------------------------------------------------------
// REST shapes
// ---------------------------------------------------------------------------

export interface Health {
  service: 'pipepatrol'
  version: string
  hostname: string | null
  capabilities: {
    motors: boolean
    camera: boolean
    lights: boolean
    imu: boolean
    optical_flow: boolean
    detector: boolean
  }
  /** Names of readings with no sensor. The console draws its blanks from this. */
  unavailable: string[]
  active_run_id: string | null
}

export interface RunSummary {
  id: string
  name: string
  started_at: number
  ended_at: number | null
  duration_s: number
  /**
   * Where the operator placed the run on a map, and which way the robot faced
   * going in. Null when they did not — the track is then drawn in its own local
   * frame with no map behind it. See components/map/geo.ts.
   */
  origin: Origin | null
  distance_m: number
  uncertainty_m: number
  /** Never ended — a crash or a power cut. Offered back to the operator. */
  interrupted: boolean
  defect_count: number
  snapshot_count: number
  has_recording: boolean
}

/** A box drawn over the frame, normalised 0..1 against the video area. */
export interface DefectRegion {
  x: number
  y: number
  w: number
  h: number
}

export interface Defect {
  id: string
  at: number
  code: string
  severity: number
  clock_position: number | null
  note: string
  chainage_m: number | null
  /** Travels with the chainage so a report can say how sure it is. */
  chainage_uncertainty_m: number | null
  snapshot_id: string | null
  detection_id: string | null
  /** Where on the frame the operator boxed the defect. Null if not placed. */
  region: DefectRegion | null
}

export interface Snapshot {
  id: string
  at: number
  chainage_m: number | null
  file: string
}

export interface PathPoint {
  chainage_m: number
  x: number
  y: number
  heading_deg: number
  uncertainty_m: number
  at: number
}

export interface Run extends Omit<
  RunSummary,
  'defect_count' | 'snapshot_count' | 'has_recording'
> {
  note: string
  defects: Defect[]
  snapshots: Snapshot[]
  recording: { file: string; index_file: string; frames: number; bytes: number } | null
  path: PathPoint[]
}
