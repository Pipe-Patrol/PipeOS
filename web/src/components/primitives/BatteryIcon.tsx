import { opticalStrokePx } from '@/components/primitives/iconStroke'

interface BatteryIconProps {
  /** null when no voltage sensor is fitted, which is the case today. */
  percent: number | null
  /** Rendered height in px. Sets the stroke, as everywhere else in the set. */
  height?: number
  className?: string
}

/** The glyph is wider than it is tall, so height is what the eye measures. */
const VIEWBOX_H = 12

/**
 * A battery, or an honest statement that there is no battery reading.
 *
 * The struck-through state is the one that ships: no voltage sensor is wired to
 * the pack (docs/HARDWARE.md), so a filled cell here would be an invention. It
 * is drawn struck through rather than left blank because an empty space reads
 * as a rendering fault, where this reads as "there is nothing to show".
 */
export function BatteryIcon({
  percent,
  height = VIEWBOX_H,
  className,
}: BatteryIconProps) {
  const stroke = (opticalStrokePx(height) * VIEWBOX_H) / height
  const unknown = percent == null
  const clamped = unknown ? 0 : Math.max(0, Math.min(100, percent))
  // 17.5 is the inner width of the body in viewBox units.
  const fill = (clamped / 100) * 17.5

  const tone = unknown
    ? 'text-ink-500'
    : clamped <= 15
      ? 'text-state-fault-signal'
      : clamped <= 30
        ? 'text-state-warning-signal'
        : 'text-ink-100'

  return (
    <svg
      viewBox="0 0 26 12"
      aria-hidden="true"
      className={`${tone} ${className ?? ''}`}
    >
      <rect
        x="0.5"
        y="0.5"
        width="21"
        height="11"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
      />
      <rect x="22.5" y="3.5" width="3" height="5" rx="1" fill="currentColor" />
      {!unknown && (
        <rect x="2" y="2" width={fill} height="8" rx="1" fill="currentColor" />
      )}
      {unknown && (
        <line
          x1="3.5"
          y1="9.5"
          x2="18.5"
          y2="2.5"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}
