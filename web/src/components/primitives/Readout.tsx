import type { ReactNode } from 'react'

import { useFlashOnChange } from '@/lib/useFlashOnChange'

/**
 * One telemetry value, in the overlay style: white text, no panel behind it.
 *
 * `estimated` and `unavailable` are rendered differently from a plain reading,
 * and that difference is the whole reason this component exists rather than a
 * span. An operator must never have to remember which numbers the robot
 * actually measures.
 */

interface ReadoutProps {
  label: string
  value: string
  /** Sub-value on its own line, e.g. acceleration under distance. */
  detail?: string
  quality?: 'measured' | 'estimated' | 'unavailable'
  state?: 'normal' | 'warn' | 'bad'
  size?: 'sm' | 'lg'
  icon?: ReactNode
}

const STATE_CLASS = {
  normal: '',
  warn: 'text-state-warning-signal',
  bad: 'text-state-fault-signal',
} as const

export function Readout({
  label,
  value,
  detail,
  quality = 'measured',
  state = 'normal',
  size = 'sm',
  icon,
}: ReadoutProps) {
  const flashing = useFlashOnChange(value)
  const unavailable = quality === 'unavailable'

  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <span className="label flex items-center gap-1">
        {icon}
        {label}
      </span>

      {unavailable ? (
        <Unavailable size={size} />
      ) : (
        <span
          className={`overlay-text tnum ${size === 'lg' ? 'text-[26px] leading-none' : 'text-[15px] leading-none'} ${STATE_CLASS[state]} ${flashing ? 'overlay-flash' : ''}`}
        >
          {value}
        </span>
      )}

      {detail && (
        <span className="overlay-text text-[10px] leading-none opacity-70">
          {detail}
        </span>
      )}
    </div>
  )
}

/**
 * A reading with no sensor behind it.
 *
 * Struck through rather than blank: an empty space reads as a layout bug, where
 * this reads as a deliberate "there is nothing here to show". Both are better
 * than a zero, which reads as a measurement.
 */
export function Unavailable({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span
      className={`relative text-ink-500 ${size === 'lg' ? 'text-[26px] leading-none' : 'text-[15px] leading-none'}`}
      title="No sensor fitted — see docs/HARDWARE.md"
    >
      <span className="opacity-60">—</span>
    </span>
  )
}
