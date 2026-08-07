import type { ComponentType, CSSProperties } from 'react'

/**
 * One optical weight for the icon set at every size it is drawn at. Stroke is a
 * function of rendered size and grows sub-linearly. BASE_PX and GROWTH are the
 * dial: BASE_PX makes the whole set heavier, GROWTH spreads the ends apart.
 */

const BASE_PX = 1.15
const GROWTH = 0.018
const VIEWBOX = 24

/** Rendered stroke weight in CSS px for an icon drawn at `size` px. */
export function opticalStrokePx(size: number): number {
  return BASE_PX + size * GROWTH
}

/** `strokeWidth` for a 24-unit glyph, dividing out the scale the SVG applies. */
export function opticalStroke(size: number): number {
  return (opticalStrokePx(size) * VIEWBOX) / size
}

export type PhosphorWeight = 'light' | 'regular' | 'bold'

/** The Phosphor tier nearest the curve at this size. */
export function phosphorWeight(size: number): PhosphorWeight {
  const ratio = opticalStrokePx(size) / size
  if (ratio >= 0.079) return 'bold'
  if (ratio >= 0.054) return 'regular'
  return 'light'
}

export type PhosphorIcon = ComponentType<{
  size?: number
  weight?: PhosphorWeight
  className?: string
  style?: CSSProperties
  'aria-hidden'?: boolean | 'true' | 'false'
}>

const PHOSPHOR_VIEWBOX = 256
const PHOSPHOR_RATIO: Record<PhosphorWeight, number> = {
  light: 0.047,
  regular: 0.0625,
  bold: 0.094,
}

/**
 * A hairline stroke to paint on a Phosphor glyph so its fixed tier meets the
 * curve. Returns 0 when the tier is already at or above target.
 */
export function phosphorBoost(size: number, weight = 1): number {
  const tierPx = PHOSPHOR_RATIO[phosphorWeight(size)] * size
  const extraPx = opticalStrokePx(size) * weight - tierPx
  return extraPx <= 0 ? 0 : (extraPx * PHOSPHOR_VIEWBOX) / size
}
