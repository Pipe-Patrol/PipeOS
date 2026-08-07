import type { Defect, Run, Snapshot } from '@/robot/types'

/**
 * The arithmetic behind the profile strip, kept out of the component so it can
 * be tested without a DOM.
 *
 * One rule is load-bearing: the axis never shrinks under the operator. A run
 * that has reached 30 m still spans 30 m after the robot reverses to 5 m, so
 * every marker stays where the operator last saw it. That is why the domain
 * takes a high-water mark instead of deriving its span from the live chainage —
 * nothing on the wire reports furthest-chainage-reached, and
 * `distance_travelled_m` is an odometer, which counts the way back too.
 */

/** The narrowest axis we will draw. Below this every marker stacks at x=0. */
export const MIN_SPAN_M = 1

/**
 * The intervals an axis is allowed to be ruled in.
 *
 * A round number of metres between ticks or none at all: an axis ruled every
 * 3.7 m is an axis nobody reads a distance off. These are the numbers a tape
 * measure is marked in, for the same reason.
 */
const STEPS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]

/** At most this many intervals on screen. More and the labels touch. */
const MAX_INTERVALS = 6

/**
 * The interval to rule an axis of roughly `reach` metres in.
 *
 * This is what makes the axis STEP rather than CREEP. An axis whose end tracked
 * the live chainage would slide every marker leftwards, continuously, for as
 * long as the robot was moving — so a defect an operator was reaching for would
 * be somewhere else by the time their finger landed, and nothing on the strip
 * would ever hold still. Quantising the end to a round number means the axis is
 * motionless for a whole interval at a time and then jumps once, when the robot
 * reaches the edge: a redraw the operator can see happen, rather than a drift
 * they cannot.
 */
export function axisStep(reach: number): number {
  if (!Number.isFinite(reach) || reach <= 0) return STEPS[0]
  for (const step of STEPS) {
    if (reach <= step * MAX_INTERVALS) return step
  }
  // Past the table — a run longer than any sewer this drives. Keep it round.
  return Math.ceil(reach / MAX_INTERVALS / 1000) * 1000
}

/**
 * The ruled marks across the axis, in metres.
 *
 * Every one of them is labelled, which is the point: without them the strip
 * said only where its two ends were, and the distance to a marker in the middle
 * of it was something an operator had to estimate by eye off a bare line.
 */
export function profileTicks(domain: ProfileDomain): number[] {
  const { min, max, step } = domain
  if (!(step > 0) || !(max > min)) return [min]

  const count = Math.round((max - min) / step)
  const ticks: number[] = []
  for (let i = 0; i <= count; i += 1) {
    // Accumulating `+= step` drifts into 0.30000000000000004 by the fourth
    // tick, and that renders. Multiplying from the floor each time does not.
    ticks.push(round(min + i * step, step))
  }
  return ticks
}

/** Snap to the precision the step itself carries, killing float dust. */
function round(value: number, step: number): number {
  const places = step < 1 ? 1 : 0
  return Number(value.toFixed(places)) + 0
}

export type MarkerKind = 'defect' | 'snapshot'

export interface ProfileMarker {
  id: string
  kind: MarkerKind
  chainage_m: number
  /** Exactly one of these is set, matching `kind`. */
  defect: Defect | null
  snapshot: Snapshot | null
}

export interface ProfileDomain {
  min: number
  max: number
  /** The interval it is ruled in. Both ends sit on a multiple of it. */
  step: number
}

export interface ProfileMarkers {
  markers: ProfileMarker[]
  /**
   * Defects and snapshots with no chainage. They cannot be placed on an axis of
   * metres, and dropping them silently would be the one thing this console does
   * not do — so the strip shows the count instead.
   */
  unplaced: number
}

/**
 * Flatten a run's defects and snapshots into one list of placeable markers.
 *
 * Snapshots come first and defects last, so that where the two overlap the red
 * marker is the one painted on top and the one that receives the click.
 */
export function profileMarkers(run: Run | null): ProfileMarkers {
  if (!run) return { markers: [], unplaced: 0 }

  const markers: ProfileMarker[] = []
  let unplaced = 0

  for (const snapshot of run.snapshots) {
    if (snapshot.chainage_m === null) {
      unplaced += 1
      continue
    }
    markers.push({
      id: snapshot.id,
      kind: 'snapshot',
      chainage_m: snapshot.chainage_m,
      defect: null,
      snapshot,
    })
  }

  for (const defect of run.defects) {
    if (defect.chainage_m === null) {
      unplaced += 1
      continue
    }
    markers.push({
      id: defect.id,
      kind: 'defect',
      chainage_m: defect.chainage_m,
      defect,
      snapshot: null,
    })
  }

  return { markers, unplaced }
}

/**
 * The span the strip draws.
 *
 * Zero is always included: chainage is signed from where the run started, so a
 * robot reversed out past its start point has negative chainage and the start
 * must stay on screen regardless.
 *
 * Both ends are then snapped outwards onto a multiple of the ruling interval,
 * which is what makes the axis hold still — see `axisStep`. Snapping outwards
 * is what keeps that safe: the quantised end is never inside the raw one, so
 * the rule that the axis must not shrink under the operator survives it.
 */
export function profileDomain(
  markers: ProfileMarker[],
  chainage_m: number | null,
  highWaterMark: number,
): ProfileDomain {
  const here = chainage_m ?? 0
  const points = markers.map((marker) => marker.chainage_m)

  // `|| 0` would swallow a NaN; adding zero only ever collapses -0 to 0. The
  // odometry really does report -0.0 when it is sitting still, and Math.min
  // preserves it, which put "−0.0 m" under the start of the run — a blank
  // reading dressed up as a negative measurement.
  const rawMin = Math.min(0, here, ...points) + 0
  const rawMax = Math.max(0, here, highWaterMark, ...points) + 0

  const step = axisStep(Math.max(rawMax - rawMin, MIN_SPAN_M))
  const min = Math.floor(rawMin / step) * step + 0
  let max = Math.ceil(rawMax / step) * step + 0

  // A run seconds old has everything at 0 m. Widening forward — a whole
  // interval at a time, so both ends stay on the grid — keeps the start pinned
  // to the left edge, which is where it stays for the rest of the run.
  while (max - min < MIN_SPAN_M) max += step

  return { min, max, step }
}

/**
 * Where a chainage sits across the track, 0..1 from the left edge.
 *
 * Takes only the two ends, so a caller with a plain span does not have to
 * invent a ruling interval to ask the question.
 */
export function profileX(
  chainage_m: number,
  domain: Pick<ProfileDomain, 'min' | 'max'>,
): number {
  const span = domain.max - domain.min
  if (span <= 0) return 0
  const fraction = (chainage_m - domain.min) / span
  return Math.min(1, Math.max(0, fraction))
}
