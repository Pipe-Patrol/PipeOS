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
 * otherwise.
 *
 * IT DRAGS AND ZOOMS, BUT IT NEVER TAKES A KEY. Being able to pull the view up
 * the street to see which cover the robot is heading for is most of what a map
 * on a driving screen is for. Arrow keys are the exception and they stay with
 * the robot: Leaflet would otherwise pan the map with them whenever a click had
 * left it focused, and a drive command that silently moved a map instead of the
 * robot is the worst bug this console could have. Once the operator moves the
 * view it stops reframing itself, and a Recentre button appears to give it back.
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
          interactive
          keyboard={false}
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
 * Return to home: the H, and nothing else.
 *
 * It carried the distance and the time back on its face for a while, and that
 * was one readout too many on a 268 px map — the budget bar across the top of
 * the console already states both, continuously, and a second copy on the glass
 * was two places to read the same number and one place for them to disagree.
 * The numbers are still here, in the tooltip and in the accessible name, for
 * anyone who wants them without looking up.
 *
 * Bottom left, tucked into the corner: hard away from the Leaflet attribution
 * on the other side, and out of the middle of a map whose whole job is to show
 * street.
 *
 * Nothing here steers. There is no autonomy on this robot, so engaging a return
 * puts the console into a mode — the banner and the budget strip both say so —
 * and the operator drives it out.
 */
function ReturnControl({ home }: { home: ReturnHomeValue }) {
  const { budget, mode, engage, cancel } = home
  const returning = mode !== null
  const reading = `${format.metres(budget.distance_m, 0)} · ${format.duration(
    budget.seconds,
  )}`

  return (
    <div className="absolute bottom-2 left-2 z-[800]">
      <button
        type="button"
        onClick={() => (returning ? cancel() : engage('manual'))}
        className={`panel flex size-9 items-center justify-center rounded-panel transition-colors ${
          returning
            ? 'border-[color:var(--color-position)]/70 bg-[color:var(--color-position)]/25'
            : 'hover:bg-white/10'
        }`}
        aria-pressed={returning}
        aria-label={
          returning
            ? `Returning home, ${reading}. Stand the return down`
            : `Return home, ${reading}`
        }
        title={
          returning
            ? `Returning — ${reading}. Click to stand it down`
            : `Return to the entry point — ${reading}`
        }
      >
        <span className="home-badge">H</span>
      </button>
    </div>
  )
}
