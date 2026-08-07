import { describe, expect, it } from 'vitest'

import {
  BUFFER_FRACTION,
  MIN_RETURN_SPEED_M_S,
  NOMINAL_RETURN_SPEED_M_S,
  burnRate,
  returnBudget,
  returnSpeed,
  type RthInput,
} from '@/robot/rth'

/** A run 40 m in, half an hour old, that opened on a full pack. */
function input(over: Partial<RthInput> = {}): RthInput {
  return {
    chainage_m: 40,
    distance_travelled_m: 40,
    run_seconds: 400,
    charge_pct: 80,
    charge_at_start_pct: 100,
    distance_at_start_m: 0,
    ...over,
  }
}

describe('returnSpeed', () => {
  it('averages the pace the run has actually made', () => {
    expect(returnSpeed(40, 400)).toBeCloseTo(0.1)
  })

  it('falls back to the nominal pace before there is enough to average', () => {
    expect(returnSpeed(2, 400)).toBe(NOMINAL_RETURN_SPEED_M_S)
    expect(returnSpeed(40, 0)).toBe(NOMINAL_RETURN_SPEED_M_S)
  })

  it('floors the pace so a long pause is not an ETA of hours', () => {
    // 40 m in six hours. Without the floor this is 0.0019 m/s.
    expect(returnSpeed(40, 21_600)).toBe(MIN_RETURN_SPEED_M_S)
  })
})

describe('burnRate', () => {
  it('is the charge this run spent over the ground this run covered', () => {
    // 20 points across 40 m.
    expect(burnRate(input())).toBeCloseTo(0.5)
  })

  it('measures from the run start, not from the odometer zero', () => {
    const rate = burnRate(
      input({ distance_travelled_m: 140, distance_at_start_m: 100 }),
    )
    expect(rate).toBeCloseTo(0.5)
  })

  it('is null with no charge sensor', () => {
    expect(burnRate(input({ charge_pct: null }))).toBeNull()
    expect(burnRate(input({ charge_at_start_pct: null }))).toBeNull()
  })

  it('is null before there is enough driving to divide by', () => {
    expect(burnRate(input({ distance_travelled_m: 3, chainage_m: 3 }))).toBeNull()
  })

  it('is null rather than zero while the pack has not visibly dropped', () => {
    // Zero would price every return at free and never raise a warning.
    expect(burnRate(input({ charge_pct: 100 }))).toBeNull()
  })
})

describe('returnBudget', () => {
  it('prices the return at the observed burn rate plus the buffer', () => {
    const budget = returnBudget(input())
    // 40 m home at 0.5 points/m is 20 points, plus ten percent.
    expect(budget.cost_pct).toBeCloseTo(20)
    expect(budget.reserve_pct).toBeCloseTo(20 * (1 + BUFFER_FRACTION))
    expect(budget.margin_pct).toBeCloseTo(80 - 22)
    expect(budget.state).toBe('ok')
  })

  it('takes the distance home from chainage, not from the odometer', () => {
    // Drove 40 m out and 15 m back: 25 m from the entry, 55 m on the clock.
    const budget = returnBudget(input({ chainage_m: 25, distance_travelled_m: 55 }))
    expect(budget.distance_m).toBe(25)
  })

  it('reads a reversal past the entry as distance, not as a negative', () => {
    expect(returnBudget(input({ chainage_m: -8 })).distance_m).toBe(8)
  })

  it('times the return at the run pace', () => {
    // 40 m at 0.1 m/s.
    expect(returnBudget(input()).seconds).toBeCloseTo(400)
  })

  /**
   * A run 50 m out with 100 m on the odometer, so half of what the pack has
   * spent buys the return. Spending charge both lowers what is left AND raises
   * the reserve, because it raises the measured burn rate — that coupling is
   * real, so the thresholds are solved for rather than assumed:
   *
   *   reserve = 1.1 × (100 − c) × 50/100        margin = 1.55c − 55
   *
   * which puts the warning at c = 38.7 and the automatic return at c = 32.3.
   */
  function halfWayOut(charge_pct: number): RthInput {
    return input({
      chainage_m: 50,
      distance_travelled_m: 100,
      charge_at_start_pct: 100,
      charge_pct,
    })
  }

  it('warns five points above the reserve', () => {
    expect(returnBudget(halfWayOut(39)).state).toBe('ok')
    expect(returnBudget(halfWayOut(38.5)).state).toBe('warn')
    expect(returnBudget(halfWayOut(33)).state).toBe('warn')
  })

  it('goes critical five points below the reserve', () => {
    expect(returnBudget(halfWayOut(33)).state).toBe('warn')
    expect(returnBudget(halfWayOut(32)).state).toBe('critical')
  })

  it('holds the buffer above the bare cost of getting back', () => {
    const budget = returnBudget(halfWayOut(40))
    expect(budget.cost_pct).toBeCloseTo(30)
    expect(budget.reserve_pct).toBeCloseTo(33)
    expect(budget.reserve_pct! - budget.cost_pct!).toBeCloseTo(
      budget.cost_pct! * BUFFER_FRACTION,
    )
  })

  it('scales the reserve with how far out the robot is', () => {
    const near = returnBudget(input({ chainage_m: 10 }))
    const far = returnBudget(input({ chainage_m: 80 }))
    expect(near.reserve_pct!).toBeLessThan(far.reserve_pct!)
  })

  it('still gives distance and time with no charge sensor', () => {
    const budget = returnBudget(input({ charge_pct: null }))
    expect(budget.distance_m).toBe(40)
    expect(budget.seconds).toBeCloseTo(400)
    expect(budget.reserve_pct).toBeNull()
    expect(budget.state).toBe('unknown')
    expect(budget.note).toBe('no charge sensor')
  })

  it('says it is still learning before the burn rate means anything', () => {
    const budget = returnBudget(input({ charge_pct: 100 }))
    expect(budget.state).toBe('unknown')
    expect(budget.note).toBe('learning')
  })

  it('never reports a NaN distance from a NaN chainage', () => {
    expect(returnBudget(input({ chainage_m: Number.NaN })).distance_m).toBe(0)
  })
})
