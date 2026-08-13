import { DefectBox } from '@/components/overlay/DefectBox'
import { defectClassName, defectLabel } from '@/constants/defects'
import { useDetectionColors } from '@/lib/detectionColors'
import type { Defect } from '@/robot/types'

/**
 * Defects already logged on this run, drawn back onto the live feed as the
 * robot passes the chainage they were filed at.
 *
 * A defect is a fact about a place in the pipe, not about a moment, so it
 * should be visible whenever the robot is at that place — including on the way
 * back out, which is when an operator most often wants it. Without this the box
 * exists only in the seconds between drawing it and saving it, and coming back
 * past a crack looks identical to pipe nobody has ever inspected.
 *
 * ONLY BOXES THAT WERE PLACED. A defect logged with no region has no position
 * on the frame, and putting one in the middle would claim something nobody
 * recorded.
 *
 * The position on the frame is the one the operator drew, held fixed. It is not
 * re-projected as the robot creeps — the odometry is dead reckoning and the
 * frame is a moving camera, so a box that tried to track the wall would drift
 * off it and look authoritative doing so. Fading with distance is the honest
 * version: near the chainage it is solid, and it thins out as the claim gets
 * weaker.
 */

/** How far either side of a defect its box is drawn. */
const RANGE_M = 1.2

/** Never fainter than this while in range, or it reads as a rendering fault. */
const MIN_OPACITY = 0.35

interface MarkerBoxesProps {
  defects: Defect[]
  chainage_m: number
  /** From settings. How far either side of a defect its box is drawn. */
  range_m?: number
}

export function MarkerBoxes({
  defects,
  chainage_m,
  range_m = RANGE_M,
}: MarkerBoxesProps) {
  useDetectionColors()

  const nearby = defects.filter(
    (defect) =>
      defect.region !== null &&
      defect.chainage_m !== null &&
      Math.abs(defect.chainage_m - chainage_m) <= range_m,
  )
  if (nearby.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0">
      {nearby.map((defect) => {
        const distance = Math.abs((defect.chainage_m ?? 0) - chainage_m)
        return (
          <DefectBox
            key={defect.id}
            rect={defect.region!}
            label={defectClassName(defect.code)}
            fallbackText={defectLabel(defect.code)}
            opacity={MIN_OPACITY + (1 - distance / range_m) * (1 - MIN_OPACITY)}
          />
        )
      })}
    </div>
  )
}
