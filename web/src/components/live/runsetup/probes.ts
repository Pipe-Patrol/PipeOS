/**
 * The active probe results, folded into the check list.
 *
 * `buildChecks` reads what each subsystem SAYS. This is what happened when the
 * robot was asked to do the thing: bytes written to the card and read back, the
 * frame counter moving, the picture getting brighter, the chassis turning.
 *
 * Where a probe ran, it wins. A camera that reports `available` and has not
 * produced a frame in a second and a half is a failed camera, whatever the flag
 * says, and that disagreement is the entire reason the probes exist.
 */

import { READING, type Check } from '@/components/live/runsetup/checks'

export interface ProbeResult {
  /** False when there was nothing to test, e.g. no light array fitted. */
  ran: boolean
  ok: boolean
  reason: string
  /** True when something outside the software observed the outcome. */
  confirmed: boolean
  evidence: Record<string, number | string>
}

export interface ProbeReport {
  at: number
  probes: Record<string, ProbeResult>
}

export function applyProbes(checks: Check[], report: ProbeReport | null): Check[] {
  if (!report) return checks

  return checks.map((check) => {
    const probe = report.probes[check.id]
    // A probe that did not run has nothing to add: the row already says the
    // hardware is absent, and overwriting it would replace a specific answer
    // with a vaguer one.
    if (!probe || !probe.ran) return check

    if (!probe.ok) {
      return {
        ...check,
        status: check.blocking ? 'fail' : 'warn',
        value: READING.testFailed,
        note: probe.reason,
      }
    }

    return {
      ...check,
      tested: true,
      confirmed: probe.confirmed,
      note: probe.confirmed ? undefined : probe.reason || undefined,
    }
  })
}

/** How many rows were proved rather than reported. For the section summary. */
export function confirmedCount(checks: Check[]): number {
  return checks.filter((check) => check.confirmed).length
}
