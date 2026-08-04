import type { ReactNode } from 'react'

/**
 * Hand-drawn icon set, carried over from PipePatrolApp.
 *
 * No icon library. Drawing them here keeps the stroke weight and optical size
 * consistent with the type rather than approximately consistent with someone
 * else's grid — and a missing icon font would degrade to boxes on exactly the
 * controls an operator needs to find fastest, on a van network with no
 * internet.
 *
 * All are drawn on a 24-unit viewBox, 1.5 stroke, round caps, and sized by
 * className so the caller controls optical size.
 */

interface IconProps {
  className?: string
}

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
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

/** Live: a camera iris. The thing the operator is actually looking through. */
export function LiveIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v5M20.5 12h-5M12 20.5v-5M3.5 12h5" />
    </Svg>
  )
}

/** Runs: a pipe run with a defect marked on it. */
export function RunsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 8h18M3 16h18" />
      <path d="M9 8v8" />
      <circle cx="15" cy="12" r="1.75" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** Settings: faders, not a gear. This is a console, not a preferences pane. */
export function SettingsIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 4v6M5 14v6M12 4v3M12 11v9M19 4v9M19 17v3" />
      <path d="M3 12h4M10 9h4M17 15h4" />
    </Svg>
  )
}

/** The product mark: a pipe bore seen head-on, which is the operator's view. */
export function PipeMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <circle
        cx="12"
        cy="12"
        r="9.25"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      />
      <circle
        cx="12"
        cy="12"
        r="4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        opacity={0.55}
      />
      <path
        d="M12 2.75v3.5"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  )
}

// --- tools ---

export function LightIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </Svg>
  )
}

export function SnapshotIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 8.5A1.5 1.5 0 014.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </Svg>
  )
}

export function RecordIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function GalleryIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M3 15l4.5-4.5 3.5 3.5 3-3L21 16" />
      <circle cx="8.5" cy="9" r="1.2" />
    </Svg>
  )
}

export function TuneIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 6h14M5 12h14M5 18h14" />
      <circle cx="9" cy="6" r="2" fill="var(--color-ink-950)" />
      <circle cx="15" cy="12" r="2" fill="var(--color-ink-950)" />
      <circle cx="8" cy="18" r="2" fill="var(--color-ink-950)" />
    </Svg>
  )
}

/** Defect: a flag planted on the pipe wall. */
export function DefectIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 21V4M5 4h11l-2 3.5L16 11H5" />
    </Svg>
  )
}

export function KeyboardIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 13h.01M18 13h.01M9.5 13h5" />
    </Svg>
  )
}

// --- indicators ---

export function GamepadIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7 8h10a4 4 0 013.9 3.1l.8 4A3 3 0 0118.8 19c-.9 0-1.7-.4-2.2-1.1L15 16H9l-1.6 1.9c-.5.7-1.3 1.1-2.2 1.1a3 3 0 01-2.9-3.9l.8-4A4 4 0 017 8z" />
      <path d="M7.5 12v2.5M6.25 13.25h2.5M15.5 12.5h.01M17.5 14.5h.01" />
    </Svg>
  )
}

export function RobotIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="8" width="18" height="10" rx="2" />
      <path d="M12 4v4M7 18v2M17 18v2" />
      <circle cx="8.5" cy="13" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="13" r="1.4" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** Clock: the hands read the defect's position on the pipe wall. */
export function ClockIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  )
}

/** Safety: a shield with a check. Shown on the pre-run safety gate. */
export function ShieldIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 3l7 2.5v5.5c0 4.5-3 7.7-7 9.5-4-1.8-7-5-7-9.5V5.5z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  )
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 20V5M5.5 11.5L12 5l6.5 6.5" />
    </Svg>
  )
}
