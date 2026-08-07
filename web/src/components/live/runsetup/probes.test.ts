import { describe, expect, it } from 'vitest'

import { READING, type Check } from '@/components/live/runsetup/checks'
import {
  applyProbes,
  confirmedCount,
  type ProbeReport,
  type ProbeResult,
} from '@/components/live/runsetup/probes'

function check(overrides: Partial<Check> = {}): Check {
  return {
    id: 'camera',
    label: 'Camera',
    status: 'pass',
    value: READING.ready,
    blocking: true,
    ...overrides,
  }
}

function report(id: string, probe: Partial<ProbeResult>): ProbeReport {
  return {
    at: 1_700_000_000,
    probes: {
      [id]: { ran: true, ok: true, reason: '', confirmed: true, evidence: {}, ...probe },
    },
  }
}

describe('applyProbes', () => {
  it('leaves the list alone when nothing has been probed yet', () => {
    const checks = [check()]

    expect(applyProbes(checks, null)).toBe(checks)
  })

  it('fails a row the robot said was fine but the probe could not verify', () => {
    // The case the probes exist for: `available` is true because the camera
    // opened at boot, and no frame has arrived since.
    const [row] = applyProbes(
      [check()],
      report('camera', { ok: false, reason: 'no new frame in 1.5s', confirmed: false }),
    )

    expect(row.status).toBe('fail')
    expect(row.value).toBe(READING.testFailed)
    expect(row.note).toBe('no new frame in 1.5s')
  })

  it('warns rather than fails when the failed row does not block a run', () => {
    const [row] = applyProbes(
      [check({ id: 'lights', label: 'Lights', blocking: false })],
      report('lights', { ok: false, reason: 'the LED channel did not take the value' }),
    )

    expect(row.status).toBe('warn')
  })

  it('marks a passing row as confirmed once something observed it', () => {
    const [row] = applyProbes([check()], report('camera', { ok: true, confirmed: true }))

    expect(row.confirmed).toBe(true)
    expect(row.tested).toBe(true)
    expect(row.status).toBe('pass')
    expect(row.value).toBe(READING.ready)
  })

  it('keeps an unconfirmed pass honest, and says why', () => {
    const [row] = applyProbes(
      [check({ id: 'lights', label: 'Lights', blocking: false })],
      report('lights', {
        ok: true,
        confirmed: false,
        reason: 'no camera to confirm the light landed',
      }),
    )

    expect(row.status).toBe('pass')
    expect(row.confirmed).toBe(false)
    expect(row.note).toBe('no camera to confirm the light landed')
  })

  it('does not overwrite a row whose probe never ran', () => {
    // Absent hardware. The telemetry row already says so, and more precisely.
    const original = check({ status: 'fail', value: READING.notDetected })
    const [row] = applyProbes(
      [original],
      report('camera', { ran: false, ok: false, reason: 'no camera' }),
    )

    expect(row).toEqual(original)
  })

  it('ignores probes for rows that are not in the list', () => {
    const checks = [check({ id: 'storage', label: 'Storage' })]

    expect(applyProbes(checks, report('motors', { ok: false }))).toEqual(checks)
  })
})

describe('confirmedCount', () => {
  it('counts only what was proved, not what was reported', () => {
    const checks = [
      check({ id: 'a', confirmed: true }),
      check({ id: 'b', confirmed: false }),
      check({ id: 'c' }),
    ]

    expect(confirmedCount(checks)).toBe(1)
  })
})
