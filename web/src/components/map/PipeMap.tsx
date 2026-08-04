import { PathMap } from '@/components/map/PathMap'
import type { Motion, PathPoint } from '@/robot/types'

interface PipeMapProps {
  path: PathPoint[]
  motion: Motion
}

/**
 * The track, floating at the bottom-left of the video.
 *
 * Small on purpose. It answers "which way am I pointing and roughly how far in
 * am I" at a glance, and anything larger would be spending pipe on a drawing
 * that is an estimate anyway.
 */
export function PipeMap({ path, motion }: PipeMapProps) {
  return (
    <div className="panel w-[220px] p-2">
      <PathMap path={path} motion={motion} height={120} />
    </div>
  )
}
