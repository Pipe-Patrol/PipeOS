import type { ReactNode } from 'react'
import {
  Check,
  ClockCounterClockwise,
  Crosshair,
  Sliders,
  Sparkle,
  SteeringWheel,
} from '@phosphor-icons/react'

import {
  opticalStroke,
  phosphorBoost,
  phosphorWeight,
  type PhosphorIcon,
} from '@/components/primitives/iconStroke'

/**
 * The console icon set.
 *
 * Navigation comes from Phosphor. Everything still drawn here is drawn because
 * it says something a general-purpose set does not — a pipe bore, a defect
 * flag, a throttle arrow sized for a glance at a video overlay.
 *
 * Every icon takes a pixel `size` rather than a sizing class, because size is
 * what sets the stroke — see iconStroke.ts. Passing a `size-[N]` class instead
 * would resize the glyph without telling the weight curve about it, which is
 * exactly the mismatch this set exists to avoid.
 */

/** What an icon is drawn at when the caller does not say. Fits the tool rail. */
export const DEFAULT_ICON_SIZE = 19

interface IconProps {
  /** Rendered size in px. Drives the stroke weight as well as the box. */
  size?: number
  /**
   * Multiplier on the set weight. 1 is the system. Use it to nudge one place
   * in the UI a hair off the curve — not to invent a second weight.
   */
  weight?: number
  className?: string
}

/** Phosphor glyphs, brought onto the same weight curve as the drawn ones. */
function Phosphor({
  icon: Icon,
  size = DEFAULT_ICON_SIZE,
  weight = 1,
  className,
}: IconProps & { icon: PhosphorIcon }) {
  const boost = phosphorBoost(size, weight)
  return (
    <Icon
      size={size}
      weight={phosphorWeight(size)}
      className={className}
      aria-hidden="true"
      style={
        boost > 0
          ? { stroke: 'currentColor', strokeWidth: boost, paintOrder: 'stroke' }
          : undefined
      }
    />
  )
}

function Svg({
  size = DEFAULT_ICON_SIZE,
  className,
  weight = 1,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={opticalStroke(size) * weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}

// --- navigation ---

/** Live: the wheel. This is the screen you drive from. */
export function LiveIcon(props: IconProps) {
  return <Phosphor icon={SteeringWheel} {...props} />
}

/** Runs: history — the inspections already on the drive. */
export function RunsIcon(props: IconProps) {
  return <Phosphor icon={ClockCounterClockwise} {...props} />
}

/** Settings: faders, not a gear. This is a console, not a preferences pane. */
export function SettingsIcon(props: IconProps) {
  return <Phosphor icon={Sliders} {...props} />
}

/** Auto flagging: the robot deciding for itself. */
export function AutoIcon(props: IconProps) {
  return <Phosphor icon={Sparkle} {...props} />
}

/** Recentre: put the robot back under the crosshair. */
export function RecentreIcon(props: IconProps) {
  return <Phosphor icon={Crosshair} {...props} />
}

/** Finish the run. A tick, because the outcome is "done", not "stop". */
export function FinishIcon(props: IconProps) {
  return <Phosphor icon={Check} {...props} />
}

/**
 * The product mark: a pipe bore seen head-on, which is the operator's view.
 *
 * Placeholder — to be replaced with the company logo.
 */
export function PipeMark({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={weight} className={className}>
      <circle cx="12" cy="12" r="9.25" />
      <circle cx="12" cy="12" r="4" opacity={0.55} />
      <path d="M12 2.75v3.5" />
    </Svg>
  )
}

// --- tools ---

export function LightIcon({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={weight} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </Svg>
  )
}

export function SnapshotIcon({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={weight} className={className}>
      <path d="M3 8.5A1.5 1.5 0 014.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </Svg>
  )
}

export function RecordIcon({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={weight} className={className}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function GalleryIcon({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={weight} className={className}>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M3 15l4.5-4.5 3.5 3.5 3-3L21 16" />
      <circle cx="8.5" cy="9" r="1.2" />
    </Svg>
  )
}

export function TuneIcon({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={weight} className={className}>
      <path d="M5 6h14M5 12h14M5 18h14" />
      <circle cx="9" cy="6" r="2" fill="var(--color-ink-950)" />
      <circle cx="15" cy="12" r="2" fill="var(--color-ink-950)" />
      <circle cx="8" cy="18" r="2" fill="var(--color-ink-950)" />
    </Svg>
  )
}

/** Defect: a flag planted on the pipe wall. */
export function DefectIcon({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={weight} className={className}>
      <path d="M5 21V4M5 4h11l-2 3.5L16 11H5" />
    </Svg>
  )
}

export function KeyboardIcon({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={weight} className={className}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 13h.01M18 13h.01M9.5 13h5" />
    </Svg>
  )
}

// --- indicators ---

export function GamepadIcon({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={weight} className={className}>
      <path d="M7 8h10a4 4 0 013.9 3.1l.8 4A3 3 0 0118.8 19c-.9 0-1.7-.4-2.2-1.1L15 16H9l-1.6 1.9c-.5.7-1.3 1.1-2.2 1.1a3 3 0 01-2.9-3.9l.8-4A4 4 0 017 8z" />
      <path d="M7.5 12v2.5M6.25 13.25h2.5M15.5 12.5h.01M17.5 14.5h.01" />
    </Svg>
  )
}

export function RobotIcon({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={weight} className={className}>
      <rect x="3" y="8" width="18" height="10" rx="2" />
      <path d="M12 4v4M7 18v2M17 18v2" />
      <circle cx="8.5" cy="13" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="13" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** Clock: the hands read the defect's position on the pipe wall. */
export function ClockIcon({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={weight} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  )
}

/** Safety: a shield with a check. Shown on the pre-run safety gate. */
export function ShieldIcon({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={weight} className={className}>
      <path d="M12 3l7 2.5v5.5c0 4.5-3 7.7-7 9.5-4-1.8-7-5-7-9.5V5.5z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  )
}

/**
 * Throttle arrow. Drawn a step heavier than the rest of the set: it is read at
 * a glance over moving video, not scanned in a panel.
 */
export function ArrowUpIcon({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={(weight ?? 1) * 1.45} className={className}>
      <path d="M12 20V5M5.5 11.5L12 5l6.5 6.5" />
    </Svg>
  )
}

/** Close. Small enough that the weight curve is doing real work here. */
export function CloseIcon({ size, weight, className }: IconProps) {
  return (
    <Svg size={size} weight={weight} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}
