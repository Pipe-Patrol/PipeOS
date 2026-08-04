import type { LinkState } from '@/robot/client'

interface SignalBarsProps {
  /** 0-4. Zero whenever the link is down. */
  strength: number
  state: LinkState
}

/**
 * Four bars, tallest last.
 *
 * Drawn rather than iconised so the lit count is data, not a picture of data:
 * an operator watching this decide to turn around is reading the number of
 * bars, and it has to change the instant the strength does.
 */
export function SignalBars({ strength, state }: SignalBarsProps) {
  const lit = state === 'down' ? 0 : Math.max(0, Math.min(4, Math.round(strength)))
  const tone =
    state === 'down'
      ? 'bg-state-fault-signal'
      : state === 'stale'
        ? 'bg-state-warning-signal'
        : 'bg-ink-100'

  return (
    <span className="flex items-end gap-[2px]" aria-label={`Signal ${lit} of 4`}>
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className={`w-[3px] rounded-[1px] ${index < lit ? tone : 'bg-ink-700'}`}
          style={{ height: `${5 + index * 3}px` }}
        />
      ))}
    </span>
  )
}

/** WiFi quality percentage to a 0-4 bar count. */
export function strengthFromQuality(qualityPct: number | null | undefined): number {
  if (qualityPct == null) return 0
  if (qualityPct >= 75) return 4
  if (qualityPct >= 50) return 3
  if (qualityPct >= 25) return 2
  return 1
}
