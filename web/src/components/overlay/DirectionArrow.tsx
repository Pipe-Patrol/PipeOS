import type { DriveDirection, DriveSource } from '@/input/useDriveInput'
import { ArrowUpIcon } from '@/components/primitives/icons'

interface DirectionArrowProps {
  direction: DriveDirection
  source: DriveSource
  /** -1..1. Drawn as opacity so a nudge of the stick looks like a nudge. */
  throttle: number
}

/**
 * The only on-screen trace of a drive command.
 *
 * There is no d-pad and no throttle panel — the operator drives from the
 * keyboard or the gamepad, and the screen is for the pipe. But a control with
 * no feedback at all is a control you cannot trust, so pressing forward paints
 * an arrow over the video for exactly as long as the key is held.
 *
 * It sits low and centred, clear of the readout above it.
 */
export function DirectionArrow({ direction, source, throttle }: DirectionArrowProps) {
  if (!direction) return null

  const magnitude = Math.min(1, Math.abs(throttle))
  return (
    <div
      className="pointer-events-none absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 rounded-2xl border border-ink-0/10 bg-ink-1000/60 px-4 py-3 backdrop-blur-sm"
      style={{ opacity: 0.4 + magnitude * 0.5 }}
    >
      <ArrowUpIcon
        className={`size-11 overlay-text ${direction === 'reverse' ? 'rotate-180' : ''}`}
      />
      {source === 'gamepad' && (
        <span className="label text-[8px]">{Math.round(magnitude * 100)}%</span>
      )}
    </div>
  )
}
