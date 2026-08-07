/**
 * The return-home budget: what it costs to get back out, and whether there is
 * still enough charge left to pay for it.
 *
 * A robot forty metres into a pipe has no way home except the way it came, and
 * a pack that dies at 40 m is a rod-and-winch recovery. So the console holds a
 * running answer to one question — "if I turned around right now, could I make
 * it?" — and it holds it as a number rather than as a feeling.
 *
 * THE ARITHMETIC. Three quantities, each derived from something already on the
 * wire:
 *
 *   distance   |chainage|. Signed distance from the entry point is exactly the
 *              ground still to cover, because the only route out is back.
 *   time       distance ÷ the pace the run has actually been making. Not the
 *              instantaneous speed: that is zero whenever the operator pauses
 *              to look at something, and an ETA of infinity is not an ETA.
 *   charge     distance × the burn rate this pack has shown on this run. Not a
 *              datasheet figure — a cold pack, a silted pipe and a steep grade
 *              all land in the observed rate and in none of the published ones.
 *
 * THE BUFFER. The reserve is the computed cost plus ten percent, because every
 * input above is an estimate and the failure is asymmetric: coming out with
 * charge to spare costs nothing, and coming out ten percent short costs a
 * recovery. Two thresholds hang off that line — a warning five points above it
 * while turning around is still the operator's decision, and an automatic
 * return five points below it, when it is not.
 *
 * WHAT THIS CANNOT DO. There is no voltage sensor on the pack (hardware/host.py
 * returns `available: false`), so the charge half is dark on today's hardware
 * and `state` reports `unknown` rather than inventing a percentage. Distance
 * and time are computed regardless — those need no sensor that is missing — and
 * they are the two an operator can act on. When an INA260 lands, the rest of
 * this lights up with no further change.
 */

/** Held on top of the computed cost, because every input to it is an estimate. */
export const BUFFER_FRACTION = 0.1

/** How far either side of the reserve the two thresholds sit, in points. */
export const WARN_BAND_PCT = 5

/**
 * Below this the burn rate is dominated by the noise in a percentage that only
 * moves in whole numbers. Asking for a reserve off two metres of driving would
 * produce a figure that swings by a factor of ten between telemetry ticks.
 */
export const MIN_BURN_SAMPLE_M = 5

/** The pace assumed before the run has driven far enough to have averaged one. */
export const NOMINAL_RETURN_SPEED_M_S = 0.15

/**
 * Nothing slower than this counts as returning. Without a floor, a run that
 * spent twenty minutes parked at one defect would average its way to an ETA of
 * several hours and the strip would read as a fault.
 */
export const MIN_RETURN_SPEED_M_S = 0.03

export type RthState = 'unknown' | 'ok' | 'warn' | 'critical'

export interface RthInput {
  /** Signed distance from the entry point, metres. */
  chainage_m: number
  /** The run odometer. Counts the way back too, which is why it is not chainage. */
  distance_travelled_m: number
  /** Seconds the run has been open. */
  run_seconds: number
  /** Charge now, 0..100. Null when no sensor is fitted. */
  charge_pct: number | null
  /** Charge when this run opened, captured by the caller. Null until seen. */
  charge_at_start_pct: number | null
  /** Odometer when this run opened, so the burn rate is this run's alone. */
  distance_at_start_m: number
}

export interface RthBudget {
  /** Ground still to cover to be back at the entry point. */
  distance_m: number
  /** The pace the estimate is drawn at. */
  speed_m_s: number
  /** How long the return should take at that pace. */
  seconds: number
  /** Points of charge per metre, as this pack has actually spent them. */
  burn_pct_per_m: number | null
  /** What the return alone is expected to cost. */
  cost_pct: number | null
  /** Cost plus the buffer — the line the run must not spend past. */
  reserve_pct: number | null
  /** Charge above the reserve. Negative means the reserve is being eaten. */
  margin_pct: number | null
  /** Passed through so one object carries everything the strip draws. */
  charge_pct: number | null
  state: RthState
  /** Why there is no reserve, when there is none. Null once there is one. */
  note: string | null
}

/**
 * The pace a return should be planned at: what this run has actually averaged,
 * floored so a long pause cannot turn into an ETA of hours, and replaced by the
 * nominal figure until there is enough driving to average.
 */
export function returnSpeed(distance_travelled_m: number, run_seconds: number): number {
  if (
    run_seconds > 0 &&
    Number.isFinite(run_seconds) &&
    Number.isFinite(distance_travelled_m) &&
    distance_travelled_m >= MIN_BURN_SAMPLE_M
  ) {
    return Math.max(distance_travelled_m / run_seconds, MIN_RETURN_SPEED_M_S)
  }
  return NOMINAL_RETURN_SPEED_M_S
}

/**
 * Points of charge spent per metre driven, on this run's own evidence.
 *
 * Null in the two cases where an answer would be a guess dressed up as a
 * measurement: too little driving to average over, and a pack whose reading has
 * not moved yet. A rate of zero is the more dangerous of the two — it would
 * price every return at nothing and never raise a warning at all.
 */
export function burnRate(input: RthInput): number | null {
  const { charge_pct, charge_at_start_pct, distance_travelled_m, distance_at_start_m } =
    input
  if (charge_pct == null || charge_at_start_pct == null) return null
  if (!Number.isFinite(charge_pct) || !Number.isFinite(charge_at_start_pct)) return null

  const driven = distance_travelled_m - distance_at_start_m
  if (!Number.isFinite(driven) || driven < MIN_BURN_SAMPLE_M) return null

  const spent = charge_at_start_pct - charge_pct
  // A pack that has not visibly dropped yet gives no rate. Reporting zero would
  // price the whole run at free.
  if (!(spent > 0)) return null

  return spent / driven
}

/** The whole budget, from one telemetry tick and the two run-start readings. */
export function returnBudget(input: RthInput): RthBudget {
  const distance_m = Math.abs(
    Number.isFinite(input.chainage_m) ? input.chainage_m : 0,
  )
  const speed_m_s = returnSpeed(input.distance_travelled_m, input.run_seconds)
  const seconds = distance_m / speed_m_s

  const burn = burnRate(input)
  const charge_pct =
    input.charge_pct != null && Number.isFinite(input.charge_pct)
      ? input.charge_pct
      : null

  if (burn == null || charge_pct == null) {
    return {
      distance_m,
      speed_m_s,
      seconds,
      burn_pct_per_m: null,
      cost_pct: null,
      reserve_pct: null,
      margin_pct: null,
      charge_pct,
      state: 'unknown',
      note: noteFor(input, charge_pct),
    }
  }

  const cost_pct = burn * distance_m
  const reserve_pct = cost_pct * (1 + BUFFER_FRACTION)
  const margin_pct = charge_pct - reserve_pct

  return {
    distance_m,
    speed_m_s,
    seconds,
    burn_pct_per_m: burn,
    cost_pct,
    reserve_pct,
    margin_pct,
    charge_pct,
    state:
      margin_pct <= -WARN_BAND_PCT
        ? 'critical'
        : margin_pct <= WARN_BAND_PCT
          ? 'warn'
          : 'ok',
    note: null,
  }
}

/**
 * Why the reserve is dark. Said in the operator's terms rather than the
 * model's: "no charge sensor" is a fact about the robot they can check, where
 * "burn rate unavailable" is a fact about this file.
 */
function noteFor(_input: RthInput, charge_pct: number | null): string {
  return charge_pct == null ? 'no charge sensor' : 'learning'
}
