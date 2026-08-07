import * as format from '@/lib/format'
import { useReturnHome } from '@/robot/ReturnHomeProvider'

/**
 * The one line that says the run has stopped being about surveying.
 *
 * Two states, and they are deliberately different objects rather than one
 * banner with a colour swap:
 *
 *   ASKING     the reserve is inside its warning band. The decision is still
 *              the operator's, so this has buttons and it can be stood down.
 *   RETURNING  a return is engaged. There is nothing to decide, so it states
 *              the two numbers that matter and offers only the way back out
 *              of the mode.
 *
 * NOTHING HERE DRIVES. There is no autonomy on this robot — no path following,
 * no reverse-the-track — so an automatic return is automatic about *deciding*,
 * not about steering. The banner says "head back", the map says how far, and
 * the operator drives it. Wording that implied the robot had taken over would
 * be the most dangerous sentence on the console: an operator who believes the
 * robot is coming out by itself is an operator who stops driving it.
 *
 * It sits under the telemetry readout in the same centre column, because it is
 * about the run rather than about a fault — AlertBanner keeps its own line for
 * things that are broken.
 */
export function ReturnHomeBanner() {
  const { budget, mode, advising, engage, cancel, dismiss } = useReturnHome()

  if (mode !== null) {
    const automatic = mode === 'auto'
    return (
      <div
        role="status"
        className="pointer-events-auto flex items-center gap-3 rounded-panel border px-3 py-1.5 text-[12px] backdrop-blur-sm"
        style={{
          borderColor: 'color-mix(in srgb, var(--color-position) 70%, transparent)',
          background: 'color-mix(in srgb, var(--color-position) 18%, transparent)',
        }}
      >
        <span className="home-badge">H</span>
        <span className="text-ink-100">
          {automatic ? 'Returning — reserve spent.' : 'Returning.'} Drive back{' '}
          <span className="tnum font-semibold">
            {format.metres(budget.distance_m)}
          </span>{' '}
          to the entry, about{' '}
          <span className="tnum font-semibold">{format.duration(budget.seconds)}</span>
        </span>
        <button
          type="button"
          onClick={cancel}
          className="shrink-0 rounded-sm px-2 py-0.5 text-[11.5px] text-ink-300 underline-offset-2 hover:text-ink-100 hover:underline"
        >
          Stand down
        </button>
      </div>
    )
  }

  if (!advising) return null

  return (
    <div
      role="alert"
      className="pointer-events-auto flex items-center gap-3 rounded-panel border border-state-warning-signal/60 bg-state-warning-surface/40 px-3 py-1.5 text-[12px] backdrop-blur-sm"
    >
      <span className="text-state-warning-signal">
        Charge is close to the return reserve —{' '}
        <span className="tnum font-semibold">{format.metres(budget.distance_m)}</span>{' '}
        back, about{' '}
        <span className="tnum font-semibold">{format.duration(budget.seconds)}</span>
      </span>
      <button
        type="button"
        onClick={() => engage('manual')}
        className="shrink-0 rounded-sm bg-state-warning-signal px-2 py-0.5 text-[11.5px] font-semibold text-ink-1000"
      >
        Start return
      </button>
      {/* Standing the warning down does not stand the arithmetic down: it comes
          back the moment the budget gets worse, and the automatic return below
          the reserve is not dismissible at all. */}
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded-sm px-2 py-0.5 text-[11.5px] text-ink-300 hover:text-ink-100"
      >
        Not yet
      </button>
    </div>
  )
}
