import { GeoTraceMap } from '@/components/map/GeoTraceMap'
import { PathMap } from '@/components/map/PathMap'
import type { Origin } from '@/components/map/geo'
import * as format from '@/lib/format'
import type { ReturnHomeValue } from '@/robot/ReturnHomeProvider'
import type { TrailPoint } from '@/robot/useLiveTrail'
import type { Motion } from '@/robot/types'

interface PipeMapProps {
  path: TrailPoint[]
  motion: Motion
  /** Set when the operator placed the run. Null draws it in its own frame. */
  origin?: Origin | null
  /** The live return-home budget, and the control that engages one. */
  home: ReturnHomeValue
}

/**
 * The track, floating at the bottom-left of the video.
 *
 * IT IS A MAP, SO IT IS SHOWN AS ONE. It used to be a 120 px drawing inside a
 * bordered panel with a caption under it, which is the shape of a figure in a
 * document rather than of a thing you navigate by — at that size, on a street
 * of terraced houses, there was nothing on it an operator could recognise. Now
 * the tiles run edge to edge and the panel is the map's own frame: no border
 * inside it, no caption below it, nothing between the operator and the street.
 *
 * Over map tiles once the run has an entry point, in the bare local frame
 * otherwise. The map itself is non-interactive either way — this sits on top of
 * the driving screen, and a map that swallows a scroll or drags out from under
 * a stray click is a map that has taken attention away from the pipe. The one
 * control on it is the return, which is the one thing worth taking attention
 * for.
 */
export function PipeMap({ path, motion, origin = null, home }: PipeMapProps) {
  const control = <ReturnControl home={home} />

  return (
    <div className="panel h-[210px] w-[268px] overflow-hidden">
      {origin ? (
        <GeoTraceMap
          origin={origin}
          path={path}
          head={motion.position}
          interactive={false}
          bare
        >
          {control}
        </GeoTraceMap>
      ) : (
        <PathMap path={path} motion={motion} bare>
          {control}
        </PathMap>
      )}
    </div>
  )
}

/**
 * Return to home.
 *
 * It carries its own arithmetic rather than sitting next to it: how far back it
 * is and how long that should take are the two facts that decide whether to
 * press it, and a button that made the operator read them off somewhere else
 * would be a button pressed on a guess.
 *
 * Nothing here steers. There is no autonomy on this robot, so engaging a return
 * puts the console into a mode — the banner, the budget strip and this button
 * all say so — and the operator drives it out. The word is "Returning", not
 * "Returned", for that reason.
 */
function ReturnControl({ home }: { home: ReturnHomeValue }) {
  const { budget, mode, engage, cancel } = home
  const returning = mode !== null

  return (
    <div className="absolute right-2 bottom-2 z-[800]">
      <button
        type="button"
        onClick={() => (returning ? cancel() : engage('manual'))}
        className={`panel flex h-8 items-center gap-2 rounded-panel px-2.5 text-[11.5px] transition-colors ${
          returning
            ? 'border-[color:var(--color-position)]/70 bg-[color:var(--color-position)]/25 text-ink-100'
            : 'text-ink-200 hover:bg-white/10'
        }`}
        aria-pressed={returning}
        title={
          returning
            ? 'Stand the return down and carry on surveying'
            : 'Head back to the entry point'
        }
      >
        <span className="home-badge !h-4 !w-4 !text-[9px]">H</span>
        <span className="tnum">
          {returning ? 'Returning · ' : ''}
          {format.metres(budget.distance_m, 0)} · {format.duration(budget.seconds)}
        </span>
      </button>
    </div>
  )
}
