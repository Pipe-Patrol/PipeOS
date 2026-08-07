import type { DriveDirection, DriveSource } from '@/input/useDriveInput'
import { ArrowUpIcon } from '@/components/primitives/icons'

interface DirectionArrowProps {
  direction: DriveDirection
  source: DriveSource
  /** -1..1. Drawn as opacity so a nudge of the stick looks like a nudge. */
  throttle: number
  /** Throttle latched by Shift — moving with no key held. */
  locked: boolean
  /** Held long enough that the latch is worth mentioning. */
  lockHint: boolean
}

const CHIP =
  'inline-flex items-center justify-center rounded-[5px] border leading-none backdrop-blur-sm'

/**
 * The only on-screen trace of a drive command.
 *
 * The box is a fixed size and never moves. The stick percentage, the lock state
 * and the hint are all positioned out of flow, so nothing that appears can
 * shove the arrow off its spot mid-drive.
 */
export function DirectionArrow({
  direction,
  source,
  throttle,
  locked,
  lockHint,
}: DirectionArrowProps) {
  if (!direction) return null

  const magnitude = Math.min(1, Math.abs(throttle))
  return (
    <div className="pointer-events-none absolute bottom-14 left-1/2 -translate-x-1/2">
      <div
        className={`relative flex size-[72px] items-center justify-center rounded-2xl border-[3px] backdrop-blur-sm ${
          locked ? 'border-white bg-ink-1000/75' : 'border-ink-0/10 bg-ink-1000/60'
        }`}
        style={{ opacity: locked ? 1 : 0.4 + magnitude * 0.5 }}
      >
        <ArrowUpIcon
          size={44}
          className={`overlay-text ${locked ? 'text-white' : ''} ${
            direction === 'reverse' ? 'rotate-180' : ''
          }`}
        />

        {source === 'gamepad' && (
          <span className="label absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[8px]">
            {Math.round(magnitude * 100)}%
          </span>
        )}
      </div>

      <div className="absolute top-full left-1/2 mt-[14px] flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap">
        {locked ? (
          <span
            className={`${CHIP} h-[22px] border-white bg-white px-2 text-[11px] font-semibold text-ink-1000`}
          >
            Locked
          </span>
        ) : (
          lockHint && (
            <>
              <kbd
                className={`${CHIP} h-[19px] min-w-[19px] border-ink-0/25 bg-ink-1000/60 px-1.5 text-[10px] font-medium text-white/75`}
              >
                Shift
              </kbd>
              <span className="overlay-label text-white/95">to lock throttle</span>
            </>
          )
        )}
      </div>
    </div>
  )
}
