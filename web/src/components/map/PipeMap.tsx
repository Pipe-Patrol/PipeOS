import { GeoTraceMap } from '@/components/map/GeoTraceMap'
import { PathMap } from '@/components/map/PathMap'
import type { Origin } from '@/components/map/geo'
import type { TrailPoint } from '@/robot/useLiveTrail'
import type { Motion } from '@/robot/types'

interface PipeMapProps {
  path: TrailPoint[]
  motion: Motion
  /** Set when the operator placed the run. Null draws it in its own frame. */
  origin?: Origin | null
}

/**
 * The track, floating at the bottom-left of the video.
 *
 * Small on purpose. It answers "which way am I pointing and roughly how far in
 * am I" at a glance, and anything larger would be spending pipe on a drawing
 * that is an estimate anyway.
 *
 * Over map tiles once the run has an entry point, in the bare local frame
 * otherwise. Non-interactive either way: this sits on top of the driving
 * screen, and a map that swallows a scroll or drags out from under a stray
 * click is a map that has taken attention away from the pipe.
 */
export function PipeMap({ path, motion, origin = null }: PipeMapProps) {
  return (
    <div className="panel w-[220px] p-2">
      {origin ? (
        <GeoTraceMap
          origin={origin}
          path={path}
          head={motion.position}
          height={120}
          interactive={false}
        />
      ) : (
        <PathMap path={path} motion={motion} height={120} />
      )}
    </div>
  )
}
