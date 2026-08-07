import { useCallback, useEffect, useRef, useState } from 'react'

import { CheckRow } from '@/components/live/runsetup/CheckRow'
import { blockers, type Check } from '@/components/live/runsetup/checks'
import {
  confirmedCount,
  type ProbeReport,
  type ProbeResult,
} from '@/components/live/runsetup/probes'
import { Button } from '@/components/primitives/Button'
import { readError } from '@/lib/errors'
import type { RobotClient } from '@/robot/client'

interface PreflightSectionProps {
  client: RobotClient
  checks: Check[]
  /** Runs the probes. The panel owns the result so the checks can fold it in. */
  onProbeReport: (report: ProbeReport | null) => void
  /**
   * False until a sweep has run to completion. The panel holds the start button
   * closed on it, so a run cannot begin on reported flags while the probes that
   * would contradict them are still in flight.
   */
  onSettledChange: (settled: boolean) => void
  /** True while the run is open, which is when the motor test is refused. */
  runActive: boolean
}

/**
 * The automatic half of the gate.
 *
 * It starts itself when it scrolls into view rather than on a button, because
 * a check an operator has to remember to press is a check that gets skipped on
 * the third job of the day.
 *
 * Two things happen at once. The rows keep tracking telemetry, so a light that
 * dies while the operator is still reading goes amber under them. And POST
 * /api/preflight runs the probes that actually exercise the hardware — a real
 * write to the card, the camera's frame counter, the lights measured through
 * the camera, the chassis turned under its own power — whose results overwrite
 * the reported ones. See probes.ts.
 *
 * THE SWEEP TURNS THE MOTORS. It is a third of a second of pivot on the spot,
 * and it is in the sweep rather than behind a button because a test an operator
 * has to remember to press is a test that gets skipped. The robot must be on the
 * ground with hands clear before this panel is opened. The server refuses the
 * motor probe outright while a run is open, so this can never fire mid-drive.
 *
 * The button stays for retesting one row without paying for the whole sweep.
 */
export function PreflightSection({
  client,
  checks,
  onProbeReport,
  onSettledChange,
  runActive,
}: PreflightSectionProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = useState(0)
  const [started, setStarted] = useState(false)
  const [swept, setSwept] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [motorBusy, setMotorBusy] = useState(false)
  const [motorResult, setMotorResult] = useState<string | null>(null)

  // Held here as well as in the panel so a single-row retest can be merged into
  // it, rather than costing a second sweep — and, for the motors, a second turn
  // of a robot that has already turned once.
  const [report, setReport] = useState<ProbeReport | null>(null)
  useEffect(() => onProbeReport(report), [report, onProbeReport])

  const runProbes = useCallback(
    async (motors: boolean) => {
      setProbing(true)
      setProbeError(null)
      try {
        setReport(
          await client.request<ProbeReport>('/api/preflight', {
            method: 'POST',
            body: JSON.stringify({ motors }),
          }),
        )
      } catch (caught) {
        setReport(null)
        setProbeError(readError(caught, 'the probes could not be run'))
      } finally {
        setProbing(false)
      }
    },
    [client],
  )

  const sweep = useCallback(() => {
    setRevealed(0)
    setStarted(true)
    setSwept(false)
    // Asked for unconditionally. motor_probe returns `ran: false` when a run is
    // open rather than turning anything, so the decision stays on the robot,
    // which is the only side that knows for certain.
    void runProbes(true).finally(() => setSwept(true))
  }, [runProbes])

  // Start once, the first time any part of the section is on screen.
  useEffect(() => {
    const node = ref.current
    if (!node || started) return

    // No observer means no way to know when this scrolled into view, so run
    // the checks anyway rather than leaving a list of spinners on screen.
    if (typeof IntersectionObserver === 'undefined') {
      const timer = window.setTimeout(sweep, 0)
      return () => window.clearTimeout(timer)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) sweep()
      },
      { threshold: 0.15 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [started, sweep])

  // The rows are revealed on a stagger rather than all at once. The probes take
  // a second or two to come back and the stagger is what makes that read as
  // work happening rather than as a panel that has hung.
  useEffect(() => {
    if (!started || revealed >= checks.length) return
    const timer = window.setTimeout(() => setRevealed((n) => n + 1), 90)
    return () => window.clearTimeout(timer)
  }, [started, revealed, checks.length])

  const testMotors = useCallback(async () => {
    setMotorBusy(true)
    setMotorResult(null)
    try {
      const result = await client.request<ProbeResult>('/api/preflight/motors', {
        method: 'POST',
      })
      setMotorResult(
        result.ok
          ? 'The robot turned on the spot, so the motors are working.'
          : result.reason,
      )
      // Merged rather than re-swept: the robot has just turned, and asking the
      // sweep to carry the result would turn it a second time for an answer
      // already in hand.
      setReport((prev) =>
        prev ? { ...prev, probes: { ...prev.probes, motors: result } } : prev,
      )
    } catch (caught) {
      setMotorResult(readError(caught, 'the motor test could not be run'))
    } finally {
      setMotorBusy(false)
    }
  }, [client])

  const running = (started && revealed < checks.length) || probing || motorBusy
  // Not merely "not running": before the first sweep lands there is nothing to
  // be settled about, and the panel must not read that quiet as a pass. A sweep
  // that errored leaves no report and does not count either — a robot whose
  // probes cannot be run is the last one that should go down a pipe on the
  // strength of what it says about itself.
  const settled = swept && !running && report !== null
  useEffect(() => onSettledChange(settled), [settled, onSettledChange])

  const failed = blockers(checks)
  const warned = checks.filter((check) => check.status === 'warn')
  const verified = confirmedCount(checks)

  return (
    <div ref={ref} className="flex flex-col gap-2">
      <ul className="flex flex-col">
        {checks.map((check, index) => (
          <CheckRow
            key={check.id}
            check={check}
            pending={!started || index >= revealed}
            action={
              check.id === 'motors' && !runActive ? (
                <button
                  type="button"
                  onClick={() => void testMotors()}
                  disabled={motorBusy || probing}
                  className="text-[12px] text-ink-500 underline underline-offset-2 transition-colors hover:text-ink-100 disabled:no-underline disabled:opacity-40"
                >
                  {motorBusy ? 'Turning' : 'Test'}
                </button>
              ) : null
            }
          />
        ))}
      </ul>

      {motorResult && <p className="text-[11.5px] text-ink-400">{motorResult}</p>}
      {probeError && <p className="text-[11.5px] text-ink-400">{probeError}</p>}

      <div className="flex items-start justify-between gap-3 pt-1">
        <p
          role="status"
          className={
            !running && failed.length > 0
              ? 'text-[12.5px] font-medium text-state-fault-signal'
              : 'text-[12px] text-ink-400'
          }
        >
          {running
            ? 'Testing'
            : failed.length > 0
              ? `${failed.length === 1 ? 'One check' : `${failed.length} checks`} must pass before this run can start.`
              : warned.length > 0
                ? `Clear to start, with ${warned.length === 1 ? 'one warning' : `${warned.length} warnings`} you should read first.`
                : verified > 0
                  ? `Everything passed, and ${verified === 1 ? 'one check was' : `${verified} checks were`} confirmed by testing the hardware.`
                  : 'Everything passed.'}
        </p>
        <Button variant="quiet" onClick={sweep} disabled={running} className="shrink-0">
          Run again
        </Button>
      </div>
    </div>
  )
}
