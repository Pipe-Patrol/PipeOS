import { DefectBox } from '@/components/overlay/DefectBox'
import { detectionColor, useDetectionColors } from '@/lib/detectionColors'
import type { Detection } from '@/robot/types'

/** Detections older than this have faded out entirely. Matches DETECTION_TTL_S. */
const TTL_S = 6

/**
 * Model output drawn over the video.
 *
 * Two things this deliberately does NOT do:
 *
 * 1. Pretend a detection is current. Inference on the Pi takes long enough that
 *    the robot has moved by the time a box arrives, so each one fades with age
 *    rather than sitting crisply over a frame it does not describe.
 *
 * 2. Invent a box. A detection can arrive without localisation, and those are
 *    listed rather than drawn — a box in the middle of the frame because we had
 *    nowhere else to put it is a lie about where the defect is.
 *
 * Colour and label come from DefectBox, which is the same component the defect
 * panel and the finished-run views draw with, so a class means the same colour
 * everywhere in the app.
 */
interface DetectionBoxesProps {
  detections: Detection[]
  /**
   * The server's clock, from the telemetry envelope — NOT `Date.now()`.
   *
   * Detection timestamps are stamped on the Pi, and a laptop whose clock is a
   * few seconds off would otherwise fade every box in instantly or never. Both
   * ends of the subtraction have to come from the same clock.
   */
  now: number
  /** Press a box to file it. Omitted when there is no run to file into. */
  onFlag?: (detection: Detection) => void
}

export function DetectionBoxes({ detections, now, onFlag }: DetectionBoxesProps) {
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
            opacity={fade(now - detection.at)}
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
              style={{
                color: detectionColor(detection.label),
                opacity: fade(now - detection.at),
              }}
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

function fade(ageSeconds: number): number {
  return Math.max(0, Math.min(1, 1 - ageSeconds / TTL_S))
}
