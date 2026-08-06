/**
 * Formatting, with one rule: a missing reading is never a zero.
 *
 * Every formatter returns BLANK for null or undefined. A `0.0 m` where the
 * truth is "we do not know" is the exact failure the quality tiers exist to
 * prevent, and it is one careless `?? 0` away at all times.
 */

import type { TempUnit } from '@/lib/units'

export const BLANK = '—'

export function metres(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return BLANK
  return `${value.toFixed(digits)} m`
}

export function speed(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return BLANK
  return `${(value * 100).toFixed(0)} cm/s`
}

export function degrees(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return BLANK
  return `${value.toFixed(0)}°`
}

/**
 * A temperature. The value is always Celsius — that is what the robot sends —
 * and `unit` only decides how it is shown.
 *
 * The scale letter is not decoration. It was safe to print a bare `°` while
 * there was only one scale on the console; now that an operator can change it,
 * a number with no letter is a number two people can read differently, and this
 * one goes into reports.
 */
export function temperature(
  value: number | null | undefined,
  unit: TempUnit = 'C',
): string {
  if (value == null || !Number.isFinite(value)) return BLANK
  const shown = unit === 'F' ? value * 1.8 + 32 : value
  return `${shown.toFixed(0)}°${unit}`
}

export function percent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return BLANK
  return `${Math.round(value)}%`
}

export function milliseconds(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return BLANK
  return `${Math.round(value)}`
}

export function acceleration(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return BLANK
  return `${value.toFixed(2)} m/s²`
}

/** Compact clock: `4:07`, or `1:04:07` once it runs past an hour. */
export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return BLANK
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

export function bytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return BLANK
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** Wall-clock date for run lists. Locale-aware, no library. */
export function timestamp(epochSeconds: number | null | undefined): string {
  if (epochSeconds == null || !Number.isFinite(epochSeconds)) return BLANK
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function relativeTime(epochSeconds: number | null | undefined): string {
  if (epochSeconds == null || !Number.isFinite(epochSeconds)) return BLANK
  const seconds = Date.now() / 1000 - epochSeconds
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86400)} d ago`
}
