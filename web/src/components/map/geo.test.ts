import { describe, expect, it } from 'vitest'

import {
  compassPoint,
  normaliseBearing,
  project,
  projectPath,
  type Origin,
} from '@/components/map/geo'

/** Somewhere flat and unambiguous. Bearing 0 = the robot went in facing north. */
const NORTH: Origin = { lat: 51.5, lon: -0.12, bearing_deg: 0 }

/** One degree of latitude in metres, as used by the projection. */
const M_PER_DEG_LAT = 111_320

describe('project', () => {
  it('leaves the origin exactly where it is', () => {
    expect(project(NORTH, 0, 0)).toEqual({ lat: NORTH.lat, lon: NORTH.lon })
  })

  it('sends forward travel north when the robot entered facing north', () => {
    const point = project(NORTH, 100, 0)

    expect(point.lat).toBeCloseTo(NORTH.lat + 100 / M_PER_DEG_LAT, 8)
    expect(point.lon).toBeCloseTo(NORTH.lon, 8)
  })

  it('sends forward travel east when the robot entered facing east', () => {
    const east: Origin = { ...NORTH, bearing_deg: 90 }
    const point = project(east, 100, 0)

    expect(point.lat).toBeCloseTo(east.lat, 8)
    expect(point.lon).toBeGreaterThan(east.lon)
  })

  it('puts +y to the LEFT of the heading, matching the odometer', () => {
    // Facing north, left is west, which is a smaller longitude.
    const point = project(NORTH, 0, 50)

    expect(point.lon).toBeLessThan(NORTH.lon)
    expect(point.lat).toBeCloseTo(NORTH.lat, 8)
  })

  it('reverses when the robot backs out', () => {
    const point = project(NORTH, -30, 0)

    expect(point.lat).toBeLessThan(NORTH.lat)
  })

  it('accounts for longitude degrees narrowing away from the equator', () => {
    const equator = project({ lat: 0, lon: 0, bearing_deg: 90 }, 1000, 0)
    const arctic = project({ lat: 70, lon: 0, bearing_deg: 90 }, 1000, 0)

    // The same 1000 m east is many more degrees of longitude up north.
    expect(Math.abs(arctic.lon)).toBeGreaterThan(Math.abs(equator.lon))
  })

  it('does not produce a NaN at the pole', () => {
    const point = project({ lat: 90, lon: 10, bearing_deg: 90 }, 100, 0)

    expect(Number.isFinite(point.lat)).toBe(true)
    expect(Number.isFinite(point.lon)).toBe(true)
  })

  it('is reversible through a full turn of the bearing', () => {
    const there = project({ ...NORTH, bearing_deg: 0 }, 100, 0)
    const back = project({ ...NORTH, bearing_deg: 180 }, 100, 0)

    expect(there.lat - NORTH.lat).toBeCloseTo(NORTH.lat - back.lat, 10)
  })
})

describe('projectPath', () => {
  it('keeps the points in order', () => {
    const track = projectPath(NORTH, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ])

    expect(track).toHaveLength(3)
    expect(track[0].lat).toBeLessThan(track[1].lat)
    expect(track[1].lat).toBeLessThan(track[2].lat)
  })

  it('drops a point with no usable coordinates rather than drawing to NaN', () => {
    const track = projectPath(NORTH, [
      { x: 0, y: 0 },
      { x: Number.NaN, y: 0 },
      { x: 10, y: 0 },
    ])

    expect(track).toHaveLength(2)
  })
})

describe('normaliseBearing', () => {
  it('folds any angle into 0..360, which is what the server accepts', () => {
    expect(normaliseBearing(0)).toBe(0)
    expect(normaliseBearing(360)).toBe(0)
    expect(normaliseBearing(-90)).toBe(270)
    expect(normaliseBearing(450)).toBe(90)
  })

  it('treats a missing angle as north rather than passing NaN to the robot', () => {
    expect(normaliseBearing(Number.NaN)).toBe(0)
  })
})

describe('compassPoint', () => {
  it('names the cardinals', () => {
    expect(compassPoint(0)).toBe('N')
    expect(compassPoint(90)).toBe('E')
    expect(compassPoint(180)).toBe('S')
    expect(compassPoint(270)).toBe('W')
  })

  it('rounds to the nearest of eight', () => {
    expect(compassPoint(44)).toBe('NE')
    expect(compassPoint(359)).toBe('N')
  })
})
