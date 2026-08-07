import * as format from '@/lib/format'
import { useReturnHome } from '@/robot/ReturnHomeProvider'
import type { RthBudget } from '@/robot/rth'

/**
 * The power budget as one full-bleed bar: what has been spent, what is free to
 * spend, and what is reserved to get back out.
 *
 * THIS IS THE ONE THING ON SCREEN THAT ANSWERS "TURN AROUND YET?". A robot
 * forty metres in has no route home except the way it came, so the free band is
 * the only charge that is genuinely the operator's to spend — everything to the
 * right of it is already committed to the return, and it grows every metre
 * further in. Watching it close is the whole reading.
 *
 * The reserve is priced continuously off distance to the entry point and the
 * burn rate this pack has actually shown on this run, plus a tenth on top
 * because every input to it is an estimate (robot/rth.ts). Two lines hang off
 * it: five points above, the bar asks; five points below, the console engages
 * the return itself and says so.
 *
 * WHAT IT DOES NOT DO. There is no voltage sensor on the pack — hardware/host.py
 * reports `available: false` — so the bands cannot be drawn today and the bar
 * does not draw a gauge from a guess. It shows what it does know, which is
 * distance and time home, and names the missing sensor. Both halves of the
 * arithmetic are already written and tested; fitting an INA260 lights them up.
 *
 * Edge to edge with no inset, because this is one reading that should never
 * look like a component sitting on a page.
 */
export function BudgetStrip() {
  const { budget, mode } = useReturnHome()
  const returning = mode !== null

  return (
    <div
      className={`flex h-[18px] shrink-0 items-center gap-3 border-b px-3 transition-colors ${SURFACE[budget.state]}`}
    >
      <Bands budget={budget} />

      <div className="flex shrink-0 items-center gap-3">
        {/* Distance and time back are the two an operator can act on, and the
            two that need no sensor this robot is missing. They are never blank.
            There is no separate "out" reading beside them: how far out the
            robot is and how far it has to come back are the same metre, and
            printing it twice under two labels invites the reading that they
            are two facts that could differ. */}
        <Reading label="Home" state={budget.state}>
          {format.metres(budget.distance_m)} · {format.duration(budget.seconds)}
        </Reading>

        <Reading label="Reserve" state={budget.state} muted={budget.reserve_pct == null}>
          {budget.reserve_pct == null
            ? budget.note
            : `${format.percent(budget.reserve_pct)} of ${format.percent(budget.charge_pct)}`}
        </Reading>

        {returning && (
          <span className="rounded-sm px-1.5 text-[10.5px] font-semibold tracking-[0.06em] uppercase text-[color:var(--color-position)]">
            {mode === 'auto' ? 'Auto return' : 'Returning'}
          </span>
        )}
      </div>
    </div>
  )
}

const SURFACE = {
  unknown: 'border-ink-800 bg-ink-800',
  ok: 'border-ink-800 bg-ink-800',
  warn: 'border-state-warning-signal/40 bg-state-warning-surface/45',
  critical: 'border-state-fault-signal/50 bg-state-fault-surface/50',
} as const

const VALUE = {
  unknown: 'text-ink-200',
  ok: 'text-ink-200',
  warn: 'text-state-warning-signal',
  critical: 'text-state-fault-signal',
} as const

/**
 * Spent, free, reserved — left to right, squeezed from both sides as a run goes
 * on. Charge is spent from the left; the reserve grows from the right with
 * every metre further in.
 *
 * With no charge sensor there are no bands to draw, and the space says what is
 * missing rather than showing an empty trough that reads as a flat pack.
 */
function Bands({ budget }: { budget: RthBudget }) {
  if (budget.charge_pct == null || budget.reserve_pct == null) {
    return (
      <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-500">
        Return budget needs a charge sensor — distance and time home are live
      </span>
    )
  }

  const spent = clamp(100 - budget.charge_pct)
  const reserved = clamp(budget.reserve_pct)
  const free = clamp(100 - spent - reserved)

  return (
    <div
      className="flex h-[8px] min-w-0 flex-1 overflow-hidden rounded-full bg-ink-900"
      role="img"
      aria-label={`${format.percent(budget.charge_pct)} charge, ${format.percent(
        budget.reserve_pct,
      )} reserved to return ${format.metres(budget.distance_m)}`}
    >
      <span style={{ width: `${spent}%`, background: 'var(--color-gauge-spent)' }} />
      <span style={{ width: `${free}%`, background: 'var(--color-gauge-good)' }} />
      {/* The reserve is drawn last and hard against the right edge, because it
          is the wall the free band closes on rather than a share of a total. */}
      <span
        style={{ width: `${reserved}%`, background: 'var(--color-gauge-reserve)' }}
      />
    </div>
  )
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function Reading({
  label,
  muted,
  state = 'ok',
  children,
}: {
  label: string
  muted?: boolean
  state?: RthBudget['state']
  children: React.ReactNode
}) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-[10.5px] font-medium text-ink-400">{label}</span>
      <span
        className={`tnum text-[11px] font-semibold ${muted ? 'text-ink-500' : VALUE[state]}`}
      >
        {children}
      </span>
    </span>
  )
}
