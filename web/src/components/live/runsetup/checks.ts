/**
 * The preflight check list, derived from telemetry.
 *
 * Pure on purpose: everything the panel shows is a function of one telemetry
 * frame plus the link state, so the checks can be tested without a robot and
 * stay live afterwards rather than freezing on whatever was true at the moment
 * the operator scrolled past them.
 *
 * Every row reads the same way: a name on the left and one short value on the
 * right. When something is wrong the value comes from the fixed vocabulary in
 * READING and nowhere else — twelve subsystems inventing twelve ways to say
 * "missing" is twelve things to read at 7am instead of one, and the operator
 * only has to learn the word once.
 *
 * `blocking` is the only field that decides anything. A blocking row that comes
 * back `fail` disables the start button; everything else is information the
 * operator carries into the pipe with them.
 */

import * as format from '@/lib/format'
import type { TempUnit } from '@/lib/units'
import type { LinkState } from '@/robot/client'
import type { Telemetry } from '@/robot/types'

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'absent'

/** Every word a check is allowed to say when it is not showing a reading. */
export const READING = {
  ready: 'Ready',
  moving: 'Moving',
  disconnected: 'Disconnected',
  notDetected: 'Not detected',
  notFitted: 'Not fitted',
  notSet: 'Not set',
  unreadable: 'Could not read',
  degraded: 'Degraded',
  fault: 'Fault',
  /** The row was actively tested and the test did not pass. See probes.ts. */
  testFailed: 'Test failed',
} as const

export interface Check {
  id: string
  label: string
  status: CheckStatus
  /** A reading, or one word from READING. Sits at the right of the row. */
  value: string
  /** A `fail` here stops the run. A `warn` never does, blocking or not. */
  blocking: boolean
  /** Set once an active probe has run against this row. See probes.ts. */
  tested?: boolean
  /** True when something outside the software observed the result. */
  confirmed?: boolean
  /** Why a probe failed, or why it could not confirm a pass. */
  note?: string
}

/** Below this the run cannot start. */
export const BATTERY_BLOCK_PCT = 25
export const BATTERY_WARN_PCT = 40

/** A run writes JPEGs and, with recording on, video. Both need room. */
export const STORAGE_BLOCK_BYTES = 500 * 1024 * 1024
export const STORAGE_WARN_BYTES = 2 * 1024 * 1024 * 1024

export function buildChecks(
  telemetry: Telemetry | null,
  link: LinkState,
  unit: TempUnit = 'C',
): Check[] {
  if (!telemetry) {
    return [
      {
        id: 'link',
        label: 'Robot link',
        status: 'fail',
        value: READING.disconnected,
        blocking: true,
      },
    ]
  }

  return [
    linkCheck(link),
    motorCheck(telemetry),
    batteryCheck(telemetry),
    cameraCheck(telemetry),
    lightsCheck(telemetry),
    imuCheck(telemetry),
    accelerometerCheck(telemetry),
    northCheck(telemetry),
    modelCheck(telemetry),
    cpuTempCheck(telemetry, unit),
    climateCheck(telemetry, unit),
    storageCheck(telemetry),
  ]
}

/** The blocking rows that came back failed, in list order. */
export function blockers(checks: Check[]): Check[] {
  return checks.filter((check) => check.blocking && check.status === 'fail')
}

function linkCheck(link: LinkState): Check {
  const base = { id: 'link', label: 'Robot link', blocking: true } as const
  if (link === 'connected') {
    return { ...base, status: 'pass', value: READING.ready }
  }
  return { ...base, status: 'fail', value: READING.disconnected }
}

function motorCheck(telemetry: Telemetry): Check {
  const base = { id: 'motors', label: 'Motors', blocking: true } as const
  if (!telemetry.drive.hardware) {
    return { ...base, status: 'fail', value: READING.notDetected }
  }
  if (telemetry.drive.moving) {
    return { ...base, status: 'warn', value: READING.moving }
  }
  return { ...base, status: 'pass', value: READING.ready }
}

/**
 * The percentage stays on show at every severity. The mark carries how bad it
 * is, so replacing 18% with the word "low" would drop the only number that
 * tells an operator whether this is a swap or the end of the day.
 */
function batteryCheck(telemetry: Telemetry): Check {
  const base = { id: 'battery', label: 'Battery', blocking: true } as const
  const battery = telemetry.power.battery
  const percent = battery.percent

  if (!battery.available) {
    return { ...base, status: 'absent', value: READING.notFitted }
  }
  if (percent == null || !Number.isFinite(percent)) {
    return { ...base, status: 'fail', value: READING.unreadable }
  }
  const shown = format.percent(percent)
  if (percent < BATTERY_BLOCK_PCT) return { ...base, status: 'fail', value: shown }
  if (percent < BATTERY_WARN_PCT) return { ...base, status: 'warn', value: shown }
  return { ...base, status: 'pass', value: shown }
}

function cameraCheck(telemetry: Telemetry): Check {
  const base = { id: 'camera', label: 'Camera', blocking: true } as const
  const camera = telemetry.camera
  if (camera.error) return { ...base, status: 'fail', value: READING.fault }
  if (!camera.available) return { ...base, status: 'fail', value: READING.notDetected }
  return { ...base, status: 'pass', value: READING.ready }
}

function lightsCheck(telemetry: Telemetry): Check {
  const base = { id: 'lights', label: 'Lights', blocking: false } as const
  if (!telemetry.lights.available) {
    return { ...base, status: 'warn', value: READING.notDetected }
  }
  return { ...base, status: 'pass', value: READING.ready }
}

/**
 * Presence and health in one row. Nothing about the IMU stops a run: without it
 * the distance estimate falls back to duty integration and says so, which is
 * worse data but still a run.
 */
function imuCheck(telemetry: Telemetry): Check {
  const base = { id: 'imu', label: 'IMU', blocking: false } as const
  const state = telemetry.orientation.state
  if (state === 'absent') return { ...base, status: 'warn', value: READING.notDetected }
  if (state === 'degraded') return { ...base, status: 'warn', value: READING.degraded }
  return { ...base, status: 'pass', value: READING.ready }
}

function accelerometerCheck(telemetry: Telemetry): Check {
  const base = { id: 'accelerometer', label: 'Accelerometer', blocking: false } as const
  const accel = telemetry.orientation.accel_m_s2
  if (accel == null || !Number.isFinite(accel)) {
    return { ...base, status: 'warn', value: READING.unreadable }
  }
  return { ...base, status: 'pass', value: format.acceleration(accel) }
}

function northCheck(telemetry: Telemetry): Check {
  const base = { id: 'north', label: 'North reference', blocking: false } as const
  const orientation = telemetry.orientation
  const unset =
    orientation.north_stale || !orientation.north_set || orientation.heading_deg == null
  if (unset) return { ...base, status: 'warn', value: READING.notSet }
  return { ...base, status: 'pass', value: format.degrees(orientation.heading_deg) }
}

/**
 * Detection and the flow estimator as one row.
 *
 * They are separate subsystems on the robot and a single answer here, because
 * an operator standing at a manhole needs to know whether the robot will call
 * out what it sees, not which of two backends failed to load.
 */
function modelCheck(telemetry: Telemetry): Check {
  const base = { id: 'model', label: 'ML model', blocking: false } as const
  const detector = telemetry.perception
  const flow = telemetry.flow

  if (detector.error) return { ...base, status: 'warn', value: READING.fault }
  if (!detector.available) {
    return { ...base, status: 'warn', value: READING.notDetected }
  }
  if (!flow.available) return { ...base, status: 'warn', value: READING.degraded }
  const latency = detector.last_inference_ms
  return {
    ...base,
    status: 'pass',
    value: latency == null ? READING.ready : `${format.milliseconds(latency)} ms`,
  }
}

function cpuTempCheck(telemetry: Telemetry, unit: TempUnit): Check {
  const base = { id: 'cpu_temp', label: 'CPU temperature', blocking: true } as const
  const host = telemetry.host

  if (host.cpu_temp_c == null || host.temp_state === 'unknown') {
    return { ...base, status: 'absent', value: READING.unreadable }
  }
  const shown = format.temperature(host.cpu_temp_c, unit)
  if (host.temp_state === 'critical') return { ...base, status: 'fail', value: shown }
  if (host.temp_state === 'warm') return { ...base, status: 'warn', value: shown }
  return { ...base, status: 'pass', value: shown }
}

function climateCheck(telemetry: Telemetry, unit: TempUnit): Check {
  const base = {
    id: 'climate',
    label: 'Air temperature',
    blocking: false,
  } as const
  const climate = telemetry.climate
  if (!climate.available || climate.temperature_c == null) {
    return { ...base, status: 'warn', value: READING.unreadable }
  }
  return {
    ...base,
    status: 'pass',
    value: `${format.temperature(climate.temperature_c, unit)}, ${format.percent(
      climate.humidity_pct,
    )}`,
  }
}

function storageCheck(telemetry: Telemetry): Check {
  const base = { id: 'storage', label: 'Storage', blocking: true } as const
  const storage = telemetry.host.storage
  if (!storage) return { ...base, status: 'absent', value: READING.unreadable }

  const free = storage.free_bytes
  const shown = `${format.bytes(free)} free`
  if (free < STORAGE_BLOCK_BYTES) return { ...base, status: 'fail', value: shown }
  if (free < STORAGE_WARN_BYTES) return { ...base, status: 'warn', value: shown }
  return { ...base, status: 'pass', value: shown }
}
