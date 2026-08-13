import { DefectBox } from '@/components/overlay/DefectBox'
import { detectionColor, useDetectionColors } from '@/lib/detectionColors'
import type { Detection } from '@/robot/types'

/**
 * Model output drawn over the video.
 *
 * ONE FRAME AT A TIME. What arrives is the whole answer for the most recent
 * frame the model saw, and it replaces the previous answer outright — including
 * when it is empty. Nothing accumulates and nothing fades. Detections used to
 * age out individually, which made sense when inference was seconds per frame
 * on the Pi and boxes trickled in one stale rectangle at a time; with the model
 * on a laptop the results arrive fast enough that overlapping generations of
 * boxes for the same crack were the only thing that ever produced.
 *
 * The server does the same thing at source: DetectionService keeps the last
 * inference, not a list, and drops it wholesale once it goes stale. So an empty
 * overlay here means the model currently sees nothing, not that a box expired.
 *
 * It still deliberately does NOT invent a box. A detection can arrive without
 * localisation, and those are listed rather than drawn — a box in the middle of
 * the frame because we had nowhere else to put it is a lie about where the
 * defect is.
 *
 * Colour and label come from DefectBox, which is the same component the defect
 * panel and the finished-run views draw with, so a class means the same colour
 * everywhere in the app.
 */
interface DetectionBoxesProps {
  detections: Detection[]
  /** Press a box to file it. Omitted when there is no run to file into. */
  onFlag?: (detection: Detection) => void
}

export function DetectionBoxes({ detections, onFlag }: DetectionBoxesProps) {
  // Subscribed rather than read, so recolouring a class in settings repaints
  // the boxes already on screen instead of waiting for the next detection.
  useDetectionColors()

  if (detections.length === 0) return null

  const localised = detections.filter((detection) => detection.box !== null)
  const unlocalised = detections.filter((detection) => detection.box === null)

  return (
    <div className="pointer-events-none absolute inset-0">
      {localised.map((detection) => {
        const [x1, y1, x2, y2] = detection.box!
        return (
          <DefectBox
            key={detection.id}
            rect={{ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }}
            label={detection.label}
            confidence={detection.confidence}
            onFlag={onFlag ? () => onFlag(detection) : undefined}
          />
        )
      })}

      {unlocalised.length > 0 && (
        <ul className="absolute top-1/2 left-3 flex -translate-y-1/2 flex-col gap-1">
          {unlocalised.map((detection) => (
            <li
              key={detection.id}
              className="overlay-shadow text-[11px] font-semibold tracking-[0.06em] uppercase"
              style={{ color: detectionColor(detection.label) }}
              title="Classified, but not localised — no box available"
            >
              {detection.label} {Math.round(detection.confidence * 100)}%
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
