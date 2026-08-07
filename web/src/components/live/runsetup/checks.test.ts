import { describe, expect, it } from 'vitest'

import {
  BATTERY_BLOCK_PCT,
  READING,
  STORAGE_BLOCK_BYTES,
  blockers,
  buildChecks,
  type Check,
} from '@/components/live/runsetup/checks'
import type { LinkState } from '@/robot/client'
import type { Telemetry } from '@/robot/types'

/** A robot with everything working. Each test breaks exactly one thing. */
const HEALTHY = {
  type: 'telemetry',
  at: 1_700_000_000,
  drive: {
    left_duty: 0,
    right_duty: 0,
    commanded_speed_m_s: 0,
    moving: false,
    armed: false,
    run_seconds: 0,
    run_limit_tripped: false,
    last_stop_reason: null,
    hardware: true,
    max_duty: 0.6,
    min_duty: 0.2,
  },
  orientation: {
    quality: 'measured',
    pitch_deg: 1,
    roll_deg: 0,
    yaw_deg: 12,
    yaw_is_relative: true,
    heading_deg: 90,
    north_set: true,
    north_stale: false,
    accel_m_s2: 9.8,
    state: 'ok',
  },
  motion: {
    quality: 'estimated',
    distance_travelled_m: 0,
    chainage_m: 0,
    speed_m_s: 0,
    uncertainty_m: 0,
    heading_deg: 0,
    position: { x: 0, y: 0 },
    source: 'stopped',
    slipping: false,
    calibrated: true,
    accel_m_s2: 9.8,
  },
  power: {
    battery: { quality: 'measured', available: true, note: '', percent: 88 },
    motor_current: { quality: 'unavailable', available: false, note: 'no sensor' },
  },
  camera: {
    available: true,
    source: 'csi',
    resolution: '1280x720',
    tuning: { brightness: 0, contrast: 0, dehaze: false, sharpness: 0 },
    error: null,
  },
  lights: { duty: 0, level: 0, available: true },
  host: {
    cpu_temp_c: 44,
    temp_state: 'ok',
    uptime_s: 900,
    wifi: { interface: 'wlan0', quality_pct: 72, signal_dbm: -55 },
    storage: { total_bytes: 32e9, free_bytes: 20e9, used_pct: 37 },
  },
  climate: {
    quality: 'measured',
    available: true,
    temperature_c: 18,
    humidity_pct: 62,
  },
  hazards: { stalled: false, obstruction: null, time_to_contact_s: null },
  detections: [],
  perception: {
    backend: 'ncnn',
    available: true,
    last_inference_ms: 42,
    error: null,
  },
  flow: {
    available: true,
    error: null,
    divergence_per_s: 0,
    magnitude_px_s: 0,
    features: 40,
    valid: true,
  },
  run: { active: false, id: null, name: null, started_at: null },
  recording: {
    active: false,
    run_id: null,
    frames: 0,
    bytes: 0,
    elapsed_s: null,
    error: null,
  },
  alert: null,
} as unknown as Telemetry

function check(telemetry: Telemetry, id: string, link: LinkState = 'connected'): Check {
  const found = buildChecks(telemetry, link).find((row) => row.id === id)
  if (!found) throw new Error(`no check named ${id}`)
  return found
}

function blockerIds(telemetry: Telemetry, link: LinkState = 'connected'): string[] {
  return blockers(buildChecks(telemetry, link)).map((row) => row.id)
}

describe('buildChecks', () => {
  it('passes every row on a healthy robot', () => {
    const rows = buildChecks(HEALTHY, 'connected')

    expect(rows.every((row) => row.status === 'pass')).toBe(true)
    expect(blockers(rows)).toEqual([])
  })

  it('fails the link row with no telemetry at all', () => {
    expect(blockerIds(null as unknown as Telemetry)).toEqual(['link'])
  })

  it('blocks a stale link, which is not the same as a disconnected one', () => {
    expect(blockerIds(HEALTHY, 'stale')).toEqual(['link'])
    expect(check(HEALTHY, 'link', 'stale').value).toBe(READING.disconnected)
  })
})

describe('the blocking rows', () => {
  it('blocks when the motor GPIO could not be claimed', () => {
    const telemetry = { ...HEALTHY, drive: { ...HEALTHY.drive, hardware: false } }

    expect(blockerIds(telemetry)).toEqual(['motors'])
  })

  it('blocks when the camera is missing or faulted', () => {
    const missing = { ...HEALTHY, camera: { ...HEALTHY.camera, available: false } }
    const faulted = { ...HEALTHY, camera: { ...HEALTHY.camera, error: 'device busy' } }

    expect(blockerIds(missing)).toEqual(['camera'])
    expect(blockerIds(faulted)).toEqual(['camera'])
    expect(check(faulted, 'camera').value).toBe(READING.fault)
    expect(check(missing, 'camera').value).toBe(READING.notDetected)
  })

  it('blocks when there is no acceleration reading, however the IMU reports', () => {
    const telemetry = {
      ...HEALTHY,
      orientation: { ...HEALTHY.orientation, accel_m_s2: null },
    }

    expect(blockerIds(telemetry)).toEqual(['accelerometer'])
  })

  it('blocks below the battery floor and only warns above it', () => {
    const flat = {
      ...HEALTHY,
      power: {
        ...HEALTHY.power,
        battery: { ...HEALTHY.power.battery, percent: BATTERY_BLOCK_PCT - 1 },
      },
    } as unknown as Telemetry
    const low = {
      ...HEALTHY,
      power: {
        ...HEALTHY.power,
        battery: { ...HEALTHY.power.battery, percent: BATTERY_BLOCK_PCT + 5 },
      },
    } as unknown as Telemetry

    expect(blockerIds(flat)).toEqual(['battery'])
    expect(check(low, 'battery').status).toBe('warn')
    expect(blockerIds(low)).toEqual([])
  })

  it('never blocks on a battery that has no sensor behind it', () => {
    const telemetry = {
      ...HEALTHY,
      power: {
        ...HEALTHY.power,
        battery: { quality: 'unavailable', available: false, note: 'no sensor' },
      },
    } as unknown as Telemetry

    expect(check(telemetry, 'battery').status).toBe('absent')
    expect(blockerIds(telemetry)).toEqual([])
  })

  it('blocks a throttling Pi and warns about a warm one', () => {
    const critical = {
      ...HEALTHY,
      host: { ...HEALTHY.host, temp_state: 'critical', cpu_temp_c: 85 },
    } as unknown as Telemetry
    const warm = {
      ...HEALTHY,
      host: { ...HEALTHY.host, temp_state: 'warm', cpu_temp_c: 72 },
    } as unknown as Telemetry

    expect(blockerIds(critical)).toEqual(['cpu_temp'])
    expect(check(warm, 'cpu_temp').status).toBe('warn')
    expect(blockerIds(warm)).toEqual([])
  })

  it('blocks when there is not enough room to record a run', () => {
    const telemetry = {
      ...HEALTHY,
      host: {
        ...HEALTHY.host,
        storage: { total_bytes: 32e9, free_bytes: STORAGE_BLOCK_BYTES - 1, used_pct: 99 },
      },
    } as unknown as Telemetry

    expect(blockerIds(telemetry)).toEqual(['storage'])
  })
})

describe('the advisory rows', () => {
  it('warns rather than blocks when the IMU is missing entirely', () => {
    const telemetry = {
      ...HEALTHY,
      orientation: { ...HEALTHY.orientation, state: 'absent' },
    } as unknown as Telemetry

    expect(check(telemetry, 'imu').status).toBe('warn')
    // The accelerometer is still reporting here, so nothing blocks.
    expect(blockerIds(telemetry)).toEqual([])
  })

  it('warns when north was set and then lost', () => {
    const telemetry = {
      ...HEALTHY,
      orientation: { ...HEALTHY.orientation, north_stale: true },
    }

    expect(check(telemetry, 'north').status).toBe('warn')
    expect(check(telemetry, 'north').value).toBe(READING.notSet)
  })

  it('folds the flow estimator into the model row', () => {
    const telemetry = { ...HEALTHY, flow: { ...HEALTHY.flow, available: false } }
    const row = check(telemetry, 'model')

    expect(row.status).toBe('warn')
    expect(row.value).toBe(READING.degraded)
    expect(buildChecks(telemetry, 'connected').some((r) => r.id === 'flow')).toBe(false)
  })

  it('warns, and never blocks, when no model is loaded', () => {
    const telemetry = {
      ...HEALTHY,
      perception: { ...HEALTHY.perception, available: false },
    }

    expect(check(telemetry, 'model').status).toBe('warn')
    expect(blockerIds(telemetry)).toEqual([])
  })

  it('warns when the light array is missing', () => {
    const telemetry = { ...HEALTHY, lights: { ...HEALTHY.lights, available: false } }

    expect(check(telemetry, 'lights').status).toBe('warn')
    expect(blockerIds(telemetry)).toEqual([])
  })

  it('warns when the climate sensor is silent', () => {
    const telemetry = {
      ...HEALTHY,
      climate: { ...HEALTHY.climate, available: false, temperature_c: null },
    } as unknown as Telemetry

    expect(check(telemetry, 'climate').status).toBe('warn')
    expect(blockerIds(telemetry)).toEqual([])
  })
})
