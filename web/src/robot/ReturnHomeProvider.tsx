import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'

import { useRobot } from '@/robot/RobotProvider'
import { returnBudget, type RthBudget } from '@/robot/rth'

/**
 * The return-home budget, held above the router so one answer serves the whole
 * console.
 *
 * The budget strip in the shell and the map on the driving screen are showing
 * the same decision — "can I still get back?" — and two components each doing
 * their own arithmetic is two components that can disagree about it in front of
 * an operator. So it is computed once, here, and both read it.
 *
 * ENGAGEMENT IS STATE, NOT AN ACTION. There is no autonomy on this robot: it
 * cannot drive itself out, and nothing here pretends otherwise. Engaging a
 * return puts the console into a mode that says how far it is, how long it
 * should take and which way to point — and it is the operator who drives. The
 * automatic trigger is automatic about *deciding*, not about steering.
 *
 * The run-start readings are captured here rather than passed in, because the
 * burn rate has to be this run's own. A console opened halfway through a run
 * has no start reading and says `unknown` rather than borrowing the previous
 * run's.
 */

/** How the console came to be in a return. Null means it is not. */
export type ReturnMode = 'manual' | 'auto' | null

export interface ReturnHomeValue {
  budget: RthBudget
  mode: ReturnMode
  /** True while the reserve is inside the warning band and not yet acted on. */
  advising: boolean
  engage: (mode: 'manual' | 'auto') => void
  cancel: () => void
  /** Stand the warning down without engaging. It returns if the state worsens. */
  dismiss: () => void
}

const IDLE: RthBudget = {
  distance_m: 0,
  speed_m_s: 0,
  seconds: 0,
  burn_pct_per_m: null,
  cost_pct: null,
  reserve_pct: null,
  margin_pct: null,
  charge_pct: null,
  state: 'unknown',
  note: null,
  used_m: 0,
  used_pct: null,
  left_m: null,
  left_pct: null,
}

const ReturnHomeContext = createContext<ReturnHomeValue | null>(null)

interface RunBaseline {
  runId: string | null
  charge_pct: number | null
  distance_m: number
}

export function ReturnHomeProvider({ children }: { children: ReactNode }) {
  const { telemetry } = useRobot()

  const [mode, setMode] = useState<ReturnMode>(null)
  const [dismissed, setDismissed] = useState(false)
  const [baseline, setBaseline] = useState<RunBaseline>({
    runId: null,
    charge_pct: null,
    distance_m: 0,
  })

  const runId = telemetry?.run.active ? telemetry.run.id : null
  const charge = telemetry?.power.battery.percent ?? null
  const odometer = telemetry?.motion.distance_travelled_m ?? 0

  // A new run is a new pack budget. State rather than a ref, and adjusted
  // during render rather than in an effect, which is the documented React
  // pattern for state derived from changing props: an effect would price the
  // first tick of a run against the *previous* run's baseline and then correct
  // itself a frame later. Every branch below converges — after each one its own
  // condition is false — so the re-render settles immediately.
  if (baseline.runId !== runId) {
    setBaseline({ runId, charge_pct: charge, distance_m: odometer })
  } else if (baseline.charge_pct == null && charge != null) {
    // A pack reading that only appears part-way through a run — a sensor fitted
    // between runs, or one that took a while to answer — still gives a usable
    // baseline. It just starts from where it appeared rather than from the
    // manhole, which is the honest reading of it.
    setBaseline({ runId, charge_pct: charge, distance_m: odometer })
  }

  const budget = useMemo(() => {
    if (!telemetry || !runId || baseline.runId !== runId) return IDLE
    return returnBudget({
      chainage_m: telemetry.motion.chainage_m,
      distance_travelled_m: telemetry.motion.distance_travelled_m,
      run_seconds: telemetry.drive.run_seconds,
      charge_pct: telemetry.power.battery.percent,
      charge_at_start_pct: baseline.charge_pct,
      distance_at_start_m: baseline.distance_m,
    })
  }, [telemetry, runId, baseline])

  const engage = useCallback((next: 'manual' | 'auto') => {
    setMode(next)
    setDismissed(false)
  }, [])

  const cancel = useCallback(() => {
    setMode(null)
    // Standing a return down re-arms the warning rather than silencing it: the
    // robot is still as far out as it was a second ago.
    setDismissed(false)
  }, [])

  const dismiss = useCallback(() => setDismissed(true), [])

  // Below the reserve the decision stops being the operator's. Adjusted during
  // render for the same reason the baseline is: an effect would leave one paint
  // showing a critical budget with no return engaged, which is the one frame
  // this must never draw. The condition is false immediately after, so it
  // settles in a single extra render.
  if (budget.state === 'critical' && mode === null) {
    setMode('auto')
    setDismissed(false)
  }

  // Back in the clear, and the automatic return has done its job. A manual one
  // is the operator's and stays until they stand it down.
  if (budget.state === 'ok' && mode === 'auto') {
    setMode(null)
  }

  // Cleared with the run, so the next one does not open mid-return.
  if (!runId && mode !== null) {
    setMode(null)
  }

  const value = useMemo<ReturnHomeValue>(
    () => ({
      budget,
      mode,
      advising: budget.state === 'warn' && mode === null && !dismissed,
      engage,
      cancel,
      dismiss,
    }),
    [budget, mode, dismissed, engage, cancel, dismiss],
  )

  return <ReturnHomeContext value={value}>{children}</ReturnHomeContext>
}

export function useReturnHome(): ReturnHomeValue {
  const value = use(ReturnHomeContext)
  if (!value) throw new Error('useReturnHome must be used inside ReturnHomeProvider')
  return value
}
