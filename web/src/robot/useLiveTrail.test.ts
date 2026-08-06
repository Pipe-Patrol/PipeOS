import { describe, expect, it } from 'vitest'

import { appendPoint, MAX_POINTS, SAMPLE_INTERVAL_M } from '@/robot/useLiveTrail'

/**
 * The rule this protects: a vertex belongs where the robot went, not where the
 * operator pressed a button. Before this existed the console only learned new
 * path points when a snapshot or defect forced a refetch, so a curve came out
 * as straight lines hinged on the markers.
 */
describe('appendPoint', () => {
  it('takes the first point unconditionally', () => {
    expect(appendPoint([], { x: 4, y: 2 })).toEqual([{ x: 4, y: 2 }])
  })

  it('adds a point once the robot has moved far enough', () => {
    const trail = [{ x: 0, y: 0 }]
    const next = appendPoint(trail, { x: SAMPLE_INTERVAL_M, y: 0 })

    expect(next).toHaveLength(2)
  })

  it('samples by distance, so a curve keeps its vertices', () => {
    let trail: { x: number; y: number }[] = []
    // A quarter circle of radius 5, walked in small steps.
    for (let deg = 0; deg <= 90; deg += 1) {
      const radians = (deg * Math.PI) / 180
      trail = appendPoint(trail, { x: 5 * Math.sin(radians), y: 5 - 5 * Math.cos(radians) })
    }

    // ~7.85 m of arc at 0.25 m spacing. A straight line between two markers
    // would have been 2 points.
    expect(trail.length).toBeGreaterThan(25)
  })

  it('returns the SAME array when nothing moved', () => {
    // Identity, not equality: this is what stops a 10 Hz feed re-rendering the
    // map ten times a second while the robot sits still.
    const trail = [{ x: 0, y: 0 }]

    expect(appendPoint(trail, { x: 0.01, y: 0.01 })).toBe(trail)
  })

  it('ignores a step just under the threshold', () => {
    const trail = [{ x: 0, y: 0 }]
    const next = appendPoint(trail, { x: SAMPLE_INTERVAL_M * 0.99, y: 0 })

    expect(next).toBe(trail)
  })

  it('measures the step in two dimensions, not along one axis', () => {
    const trail = [{ x: 0, y: 0 }]
    // 0.2 on each axis is 0.28 diagonally — past the threshold, though neither
    // axis alone is.
    const next = appendPoint(trail, { x: 0.2, y: 0.2 })

    expect(next).toHaveLength(2)
  })

  it('stops at the cap rather than growing without bound', () => {
    const trail = Array.from({ length: MAX_POINTS }, (_, i) => ({ x: i, y: 0 }))

    expect(appendPoint(trail, { x: MAX_POINTS + 10, y: 0 })).toBe(trail)
  })

  it('refuses a position that is not a number', () => {
    const trail = [{ x: 0, y: 0 }]

    expect(appendPoint(trail, { x: Number.NaN, y: 5 })).toBe(trail)
    expect(appendPoint(trail, { x: 5, y: Number.POSITIVE_INFINITY })).toBe(trail)
  })

  it('does not mutate the array it was given', () => {
    const trail = [{ x: 0, y: 0 }]
    appendPoint(trail, { x: 10, y: 0 })

    expect(trail).toHaveLength(1)
  })
})
