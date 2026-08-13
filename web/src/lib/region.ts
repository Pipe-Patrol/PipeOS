import type { DefectRegion } from '@/robot/types'

/**
 * Where on the pipe wall a box sits, as a clock face.
 *
 * The convention every inspection report uses: 12 is the crown, 6 the invert, 3
 * and 9 the springlines. Read off the box rather than typed, so the picture and
 * the recorded position can never disagree.
 */
export function clockFromRegion(region: DefectRegion): number {
  const cx = region.x + region.w / 2
  const cy = region.y + region.h / 2
  let angle = Math.atan2(cx - 0.5, -(cy - 0.5)) // 0 at 12 o'clock, clockwise
  if (angle < 0) angle += Math.PI * 2
  const hour = Math.round((angle / (Math.PI * 2)) * 12) % 12
  return hour === 0 ? 12 : hour
}

/** A model's normalised xyxy box as the xywh a defect region is stored in. */
export function regionFromBox(
  box: [number, number, number, number] | null,
): DefectRegion | null {
  if (!box) return null
  const [x1, y1, x2, y2] = box
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
