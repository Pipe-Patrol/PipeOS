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
 * 2. Invent a box. Most classifiers here have no localisation head, so `box` is
 *    null far more often than not. Those are listed, not drawn — a box in the
 *    middle of the frame because we had nowhere else to put it is a lie about
 *    where the defect is.
 *
 * No model ships yet, so today this renders nothing. It is wired so that
 * landing one is a server change alone.
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
}

export function DetectionBoxes({ detections, now }: DetectionBoxesProps) {
  if (detections.length === 0) return null

  const localised = detections.filter((detection) => detection.box !== null)
  const unlocalised = detections.filter((detection) => detection.box === null)

  return (
    <div className="pointer-events-none absolute inset-0">
      {localised.map((detection) => {
        const [x1, y1, x2, y2] = detection.box!
        const age = now - detection.at
        return (
          <div
            key={detection.id}
            className="absolute border border-state-warning-signal"
            style={{
              left: `${x1 * 100}%`,
              top: `${y1 * 100}%`,
              width: `${(x2 - x1) * 100}%`,
              height: `${(y2 - y1) * 100}%`,
              opacity: fade(age),
            }}
          >
            <span className="overlay-shadow absolute -top-5 left-0 bg-state-warning-signal/20 px-1 text-[10px] tracking-[0.06em] text-state-warning-signal uppercase">
              {detection.label} {Math.round(detection.confidence * 100)}%
            </span>
          </div>
        )
      })}

      {unlocalised.length > 0 && (
        <ul className="absolute top-1/2 left-3 flex -translate-y-1/2 flex-col gap-1">
          {unlocalised.map((detection) => (
            <li
              key={detection.id}
              className="overlay-shadow text-[11px] tracking-[0.06em] text-state-warning-signal uppercase"
              style={{ opacity: fade(now - detection.at) }}
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
