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
 * IT IS A MAP, SO IT IS SHOWN AS ONE. The tiles run edge to edge and the panel
 * is the map's own frame: no border inside it, no caption below it, nothing
 * between the operator and the street.
 *
 * SMALL, BECAUSE IT IS A REFERENCE AND NOT THE WORK. The video is what the job
 * is done through; this answers "roughly where am I under the street" and gets
 * out of the way. It can be dragged and zoomed when a closer look is wanted,
 * which is the right place to spend that screen rather than holding it open all
 * run.
 *
 * IT DRAGS AND ZOOMS, BUT IT NEVER TAKES A KEY. Arrow keys stay with the robot:
 * Leaflet would otherwise pan the map with them whenever a click had left it
 * focused, and a drive command that silently moved a map instead of the robot
 * is the worst bug this console could have. Once the operator moves the view it
 * stops reframing itself, and a recentre control appears to give it back.
 *
 * THE H IS THE RETURN BUTTON. There is no separate control for it. The entry
 * point is already the mark an operator looks for when the question is "how do
 * I get out", so it is the thing that answers it — a second button beside it
 * meant the map carried two controls for one decision and the H was the one
 * that did nothing.
 */
export function PipeMap({ path, motion, origin = null, home }: PipeMapProps) {
  const { budget, mode, engage, cancel } = home
  const returning = mode !== null
  const reading = `${format.metres(budget.distance_m, 0)} · ${format.duration(
    budget.seconds,
  )}`

  return (
    <div className="panel h-[158px] w-[210px] overflow-hidden">
      {origin ? (
        <GeoTraceMap
          origin={origin}
          path={path}
          head={motion.position}
          interactive
          keyboard={false}
          bare
          home={{
            returning,
            label: returning
              ? `Returning — ${reading}. Click to stand it down`
              : `Return to the entry point — ${reading}`,
            onToggle: () => (returning ? cancel() : engage('manual')),
          }}
        />
      ) : (
        // No entry point placed, so there is nowhere to draw an H and nothing
        // to return to. The track still draws in its own frame.
        <PathMap path={path} motion={motion} bare />
      )}
    </div>
  )
}
