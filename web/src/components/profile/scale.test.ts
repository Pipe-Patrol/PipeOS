import { describe, expect, it } from 'vitest'

import {
  MIN_SPAN_M,
  axisStep,
  profileDomain,
  profileMarkers,
  profileTicks,
  profileX,
  type ProfileMarker,
} from '@/components/profile/scale'
import type { Defect, Run, Snapshot } from '@/robot/types'

function defect(id: string, chainage_m: number | null): Defect {
  return {
    id,
    at: 0,
    code: 'CC',
    severity: 3,
    clock_position: null,
    note: '',
    chainage_m,
    chainage_uncertainty_m: null,
    snapshot_id: null,
    detection_id: null,
    region: null,
  }
}

function snapshot(id: string, chainage_m: number | null): Snapshot {
  return { id, at: 0, chainage_m, file: `${id}.jpg` }
}

function run(defects: Defect[], snapshots: Snapshot[]): Run {
  return {
    id: 'run1',
    name: 'test',
    started_at: 0,
    ended_at: null,
    duration_s: 0,
    distance_m: 0,
    origin: null,
    uncertainty_m: 0,
    interrupted: false,
    note: '',
    defects,
    snapshots,
    recordings: [],
    path: [],
  }
}

function marker(chainage_m: number): ProfileMarker {
  return { id: 'm', kind: 'defect', chainage_m, defect: null, snapshot: null }
}

describe('profileMarkers', () => {
  it('has nothing to draw without a run', () => {
    expect(profileMarkers(null)).toEqual({ markers: [], unplaced: 0 })
  })

  it('places defects and snapshots on the same axis', () => {
    const { markers, unplaced } = profileMarkers(
      run([defect('d1', 12)], [snapshot('s1', 4)]),
    )
    expect(unplaced).toBe(0)
    expect(markers.map((m) => [m.kind, m.chainage_m])).toEqual([
      ['snapshot', 4],
      ['defect', 12],
    ])
  })

  it('orders defects last, so red wins an overlap', () => {
    const { markers } = profileMarkers(
      run([defect('d1', 5)], [snapshot('s1', 5), snapshot('s2', 5)]),
    )
    expect(markers.at(-1)?.kind).toBe('defect')
  })

  it('counts what it cannot place rather than dropping it silently', () => {
    const { markers, unplaced } = profileMarkers(
      run([defect('d1', null), defect('d2', 8)], [snapshot('s1', null)]),
    )
    expect(markers).toHaveLength(1)
    expect(unplaced).toBe(2)
  })

  it('carries the source record so the popover needs no second lookup', () => {
    const { markers } = profileMarkers(run([defect('d1', 3)], [snapshot('s1', 1)]))
    expect(markers[0].snapshot?.id).toBe('s1')
    expect(markers[0].defect).toBeNull()
    expect(markers[1].defect?.id).toBe('d1')
    expect(markers[1].snapshot).toBeNull()
  })
})

describe('profileDomain', () => {
  it('never collapses to nothing at the start of a run', () => {
    const domain = profileDomain([], 0, 0)
    expect(domain.max - domain.min).toBe(MIN_SPAN_M)
    expect(domain.min).toBe(0)
  })

  it('keeps the start on screen when the robot reverses past it', () => {
    const domain = profileDomain([marker(-3)], -3, 0)
    expect(domain.min).toBe(-3)
    expect(domain.max).toBeGreaterThanOrEqual(0)
  })

  it('does not shrink when the robot drives back the way it came', () => {
    const reached = profileDomain([], 30, 30)
    const reversed = profileDomain([], 5, 30)
    expect(reversed.max).toBe(reached.max)
  })

  it('stretches past a marker beyond the high-water mark', () => {
    // 42 m is ruled every 10, so the axis runs to 50 rather than stopping on a
    // number nothing on the strip is labelled with.
    expect(profileDomain([marker(42)], 10, 20).max).toBe(50)
  })

  it('always includes zero, so the run start is never off screen', () => {
    expect(profileDomain([marker(10)], 12, 12).min).toBe(0)
  })

  it('treats an absent chainage as the start, not as a reading', () => {
    expect(profileDomain([], null, 6)).toEqual({ min: 0, max: 6, step: 1 })
  })

  it('lands both ends on a multiple of the ruling interval', () => {
    for (const reach of [0.4, 3, 7, 23, 41, 99, 260, 1234]) {
      const domain = profileDomain([], reach, reach)
      expect(domain.max % domain.step).toBeCloseTo(0)
      expect(domain.min % domain.step).toBeCloseTo(0)
      expect(domain.max).toBeGreaterThanOrEqual(reach)
    }
  })

  it('holds still across a whole interval, then jumps at the edge', () => {
    // The whole point of quantising: an axis that tracked the live chainage
    // would slide every marker leftwards continuously, and nothing an operator
    // reached for would still be under their finger when they got there. So
    // the end is motionless for a whole interval — here, everything from just
    // past 20 m up to and including 25 m draws the same axis — and then steps
    // out in one visible go.
    const held = [20.1, 21, 23.5, 24.99, 25].map(
      (at) => profileDomain([], at, at).max,
    )
    expect(new Set(held)).toEqual(new Set([25]))

    expect(profileDomain([], 25.01, 25.01).max).toBe(30)
  })

  it('jumps by exactly one interval at a time, never further', () => {
    // A jump of two intervals would be the axis rescaling under the operator
    // rather than extending, and every marker would move twice as far.
    let previous = profileDomain([], 0, 0)
    for (let reach = 0; reach < 300; reach += 0.05) {
      const domain = profileDomain([], reach, reach)
      if (domain.max !== previous.max) {
        expect(domain.max - previous.max).toBeLessThanOrEqual(domain.step)
      }
      previous = domain
    }
  })

  it('never steps backwards as the run gets longer', () => {
    let previous = -Infinity
    for (let reach = 0; reach < 400; reach += 0.37) {
      const { max } = profileDomain([], reach, reach)
      expect(max).toBeGreaterThanOrEqual(previous)
      previous = max
    }
  })

  it('snaps a negative floor outwards too, never inwards', () => {
    const domain = profileDomain([marker(-7)], -7, 40)
    expect(domain.min).toBeLessThanOrEqual(-7)
    expect(domain.min % domain.step).toBeCloseTo(0)
  })

  it('never labels the start as negative zero', () => {
    // The odometry reports -0.0 standing still, and Math.min keeps the sign.
    // Left alone it renders as "−0.0 m", which reads as a measurement.
    const domain = profileDomain([], -0, 10)
    expect(Object.is(domain.min, -0)).toBe(false)
    expect(domain.min).toBe(0)
  })
})

describe('axisStep', () => {
  it('rules in numbers a tape measure is marked in', () => {
    const allowed = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]
    for (let reach = 0.1; reach < 900; reach += 0.13) {
      expect(allowed).toContain(axisStep(reach))
    }
  })

  it('keeps the count of intervals readable at any reach', () => {
    for (const reach of [1, 4, 17, 60, 130, 480]) {
      const intervals = reach / axisStep(reach)
      expect(intervals).toBeLessThanOrEqual(6)
      expect(intervals).toBeGreaterThan(1)
    }
  })

  it('has an interval for a run that has not moved', () => {
    expect(axisStep(0)).toBeGreaterThan(0)
    expect(axisStep(Number.NaN)).toBeGreaterThan(0)
  })
})

describe('profileTicks', () => {
  it('rules the whole axis, both ends included', () => {
    expect(profileTicks({ min: 0, max: 30, step: 5 })).toEqual([
      0, 5, 10, 15, 20, 25, 30,
    ])
  })

  it('rules a negative floor as well', () => {
    expect(profileTicks({ min: -10, max: 20, step: 10 })).toEqual([-10, 0, 10, 20])
  })

  it('does not accumulate float dust across a fractional interval', () => {
    // Adding 0.5 repeatedly gives 1.5000000000000002 by the fourth tick, and
    // that renders on screen.
    expect(profileTicks({ min: 0, max: 3, step: 0.5 })).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5, 3,
    ])
  })

  it('survives a degenerate domain instead of looping forever', () => {
    expect(profileTicks({ min: 5, max: 5, step: 0 })).toEqual([5])
  })
})

describe('profileX', () => {
  const domain = { min: 0, max: 20 }

  it('pins the bounds to the edges', () => {
    expect(profileX(0, domain)).toBe(0)
    expect(profileX(20, domain)).toBe(1)
  })

  it('is linear between them', () => {
    expect(profileX(5, domain)).toBeCloseTo(0.25)
    expect(profileX(15, domain)).toBeCloseTo(0.75)
  })

  it('handles a negative floor', () => {
    expect(profileX(0, { min: -10, max: 10 })).toBeCloseTo(0.5)
  })

  it('clamps rather than drawing off the end of the track', () => {
    expect(profileX(99, domain)).toBe(1)
    expect(profileX(-99, domain)).toBe(0)
  })

  it('survives a degenerate domain instead of dividing by zero', () => {
    expect(profileX(5, { min: 5, max: 5 })).toBe(0)
  })
})
