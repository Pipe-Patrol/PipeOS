import { useEffect } from 'react'

import * as format from '@/lib/format'
import { clearNotice, raiseNotice } from '@/lib/notices'
import { useReturnHome } from '@/robot/ReturnHomeProvider'
import type { RthBudget } from '@/robot/rth'

/**
 * Three numbers: what the run has spent, what is left, and what is committed to
 * getting back out.
 *
 * THIS IS THE ONE THING ON SCREEN THAT ANSWERS "TURN AROUND YET?". A robot
 * forty metres in has no route home except the way it came, so RTH is not a
 * share of the pack the operator may spend — it is a wall that Left closes on,
 * and it grows every metre further in. The reading is the comparison between
 * the middle number and the right-hand one.
 *
 * IT USED TO BE A GAUGE. A stacked bar of spent/free/reserved plus two readouts
 * was a picture of the arithmetic rather than the answer to the question, and
 * at 18 px tall the bands were three grey slivers nobody could price. Three
 * labelled pairs are the whole thing said outright.
 *
 * EACH ONE CARRIES A DISTANCE AND A PERCENTAGE. Neither is sufficient alone: a
 * percentage cannot answer "can I reach the next joint and get back", and a
 * distance cannot be compared against the pack. Both are estimates and neither
 * says so, because everything on this console is an estimate and hedging three
 * numbers would imply the others are measured.
 *
 * The reserve carries a tenth on top of the computed cost (robot/rth.ts), and
 * two lines hang off it: five points above, this asks for a return; five points
 * below, the console engages one itself and the bar says so.
 *
 * Edge to edge with no inset, because this is one reading that should never
 * look like a component sitting on a page.
 */
export function BudgetStrip() {
  const { budget, mode, engage } = useReturnHome()

  /**
   * The two lines either side of the reserve, said in the one place errors are
   * said.
   *
   * Approaching it is a warning and the operator's call, so the bar offers the
   * return rather than taking it. Past it the decision is no longer theirs —
   * ReturnHomeProvider has already engaged one — and this is a fault, because
   * from here on every metre further in is charge that will not come back.
   */
  useEffect(() => {
    if (mode !== null) {
      clearNotice('rth')
      return
    }
    if (budget.state === 'warn') {
      raiseNotice(
        'rth',
        'warning',
        `Approaching the return-home reserve — ${format.metres(budget.distance_m)} to get out`,
        { label: 'Begin RTH', run: () => engage('manual') },
      )
    } else if (budget.state === 'critical') {
      raiseNotice('rth', 'fault', 'Past the return-home reserve — returning now')
    } else {
      clearNotice('rth')
    }
  }, [budget.state, budget.distance_m, mode, engage])

  useEffect(() => () => clearNotice('rth'), [])

  if (mode !== null) return <Returning budget={budget} auto={mode === 'auto'} />

  // No run, no budget. Three bands of zero is a bar that looks broken rather
  // than one that is honestly empty, and the strip is on every screen.
  if (budget.distance_m === 0 && budget.used_m === 0) {
    return (
      <div className="flex h-[26px] shrink-0 items-center border-b border-ink-800 bg-ink-850 px-3">
        <span className="text-[11px] text-ink-500">
          Return budget starts with the run
        </span>
      </div>
    )
  }

  const bands = bandsOf(budget)
  const total = bands.reduce((sum, band) => sum + band.weight, 0) || 1

  return (
    <div
      className={`flex h-[26px] shrink-0 items-stretch gap-px border-b transition-colors ${SURFACE[budget.state]}`}
      role="img"
      aria-label={bands
        .map((band) => `${band.label} ${format.metres(band.distance)}`)
        .join(', ')}
    >
      {bands.map((band) => (
        <Band key={band.label} {...band} share={band.weight / total} />
      ))}
    </div>
  )
}

/**
 * The three bands, sized by what they represent.
 *
 * THE WIDTHS ARE THE READING. Three numbers side by side told the operator the
 * same facts but made them do the comparison — and the comparison is the whole
 * point, because the question is whether Left has closed on RTH. Drawn as
 * widths it is answered by looking: Used grows from the left as the run goes
 * on, RTH grows from the right with every metre further in, and Left is what is
 * being squeezed between them. When Left disappears, the run is at the wall.
 *
 * PROPORTIONED BY DISTANCE, NOT BY CHARGE. Distance is the half that is live
 * today — there is no voltage sensor yet — and it is a real total: driven so
 * far, plus what is left in the pack, plus what it costs to get out. The
 * percentages ride along inside each band and blank honestly until a pack
 * reading exists.
 */
function bandsOf(budget: RthBudget) {
  const used = Math.max(0, budget.used_m)
  const home = Math.max(0, budget.distance_m)
  // Without a charge sensor there is no answer for how much further it could
  // go, so the band is given the run's own scale rather than left at zero —
  // which would collapse the strip to two blocks and hide the comparison.
  const left = budget.left_m ?? Math.max(used + home, MIN_SPAN_M)

  return [
    {
      label: 'Used',
      distance: used,
      percent: budget.used_pct,
      weight: used,
      fill: 'var(--color-gauge-spent)',
      text: 'text-ink-100',
    },
    {
      label: 'Left',
      distance: left,
      percent: budget.left_pct,
      weight: left,
      fill:
        budget.state === 'critical'
          ? 'var(--color-state-fault-surface)'
          : budget.state === 'warn'
            ? 'var(--color-state-warning-surface)'
            : 'var(--color-gauge-good)',
      text: 'text-ink-0',
    },
    {
      label: 'RTH',
      distance: home,
      percent: budget.reserve_pct,
      weight: home,
      fill: 'var(--color-gauge-reserve)',
      text: 'text-ink-1000',
    },
  ]
}

/** Below this the whole strip is one band wide and says nothing. */
const MIN_SPAN_M = 1

/**
 * One band. Its label and figures live inside it, and drop out as it narrows —
 * a band too small for its own text is still a band, and clipping the words
 * would be worse than not showing them.
 */
function Band({
  label,
  distance,
  percent,
  weight,
  share,
  fill,
  text,
}: {
  label: string
  distance: number
  percent: number | null
  weight: number
  share: number
  fill: string
  text: string
}) {
  // Below this the band is narrower than its own label, and half a clipped
  // word reads as a rendering fault. The band still holds its width — it is
  // the width that carries the meaning — it just stops trying to caption it.
  const roomy = share >= 0.14
  return (
    <div
      title={`${label} — ${format.metres(distance)}`}
      className={`flex min-w-0 items-center gap-2 overflow-hidden px-2 whitespace-nowrap transition-[flex-grow] duration-500 ease-out ${text}`}
      // A floor on the basis so a band at zero is still a sliver rather than
      // vanishing — an operator needs to see that RTH exists before it matters.
      style={{ flexGrow: Math.max(weight, 0.001), flexBasis: 26, background: fill }}
    >
      {roomy && (
        <>
          <span className="shrink-0 text-[10px] font-semibold tracking-[0.06em] uppercase opacity-70">
            {label}
          </span>
          <span className="tnum shrink-0 text-[11.5px] font-semibold">
            {format.metres(distance)}
          </span>
          {percent !== null && (
            <span className="tnum shrink-0 text-[10.5px] opacity-70">
              {format.percent(percent)}
            </span>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The bar in a return.
 *
 * Flashing yellow and one sentence. Everything else is cleared off it on
 * purpose: once the decision has been made the three-way comparison is no
 * longer the thing to read, and the distance home is what the operator is
 * driving against. The ellipsis is doing real work — it says this is a state
 * the console is holding, not an event that has finished.
 *
 * NOTHING HERE STEERS. There is no autonomy on this robot; an automatic return
 * is automatic about deciding, and the operator drives it out.
 */
function Returning({ budget, auto }: { budget: RthBudget; auto: boolean }) {
  return (
    <div
      role="status"
      className="animate-rth-flash flex h-[22px] shrink-0 items-center gap-3 border-b border-state-warning-signal/25 px-3"
    >
      <span className="text-[11.5px] font-semibold text-ink-1000">
        Returning to home…
      </span>
      <span className="tnum text-[11px] font-semibold text-ink-1000/75">
        {format.metres(budget.distance_m)} · {format.duration(budget.seconds)}
      </span>
      {auto && (
        <span className="text-[10.5px] font-semibold tracking-[0.06em] text-ink-1000/60 uppercase">
          Automatic
        </span>
      )}
    </div>
  )
}

const SURFACE = {
  unknown: 'border-ink-800 bg-ink-800',
  ok: 'border-ink-800 bg-ink-800',
  warn: 'border-state-warning-signal/25 bg-state-warning-surface/45',
  critical: 'border-state-fault-signal/28 bg-state-fault-surface/50',
} as const
