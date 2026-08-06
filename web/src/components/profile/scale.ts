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
  const min = Math.min(0, here, ...points) + 0
  let max = Math.max(0, here, highWaterMark, ...points) + 0

  // A run seconds old has everything at 0 m. Widening forward keeps the start
  // pinned to the left edge, which is where it stays for the rest of the run.
  if (max - min < MIN_SPAN_M) max = min + MIN_SPAN_M

  return { min, max }
}

/** Where a chainage sits across the track, 0..1 from the left edge. */
export function profileX(chainage_m: number, domain: ProfileDomain): number {
  const span = domain.max - domain.min
  if (span <= 0) return 0
  const fraction = (chainage_m - domain.min) / span
  return Math.min(1, Math.max(0, fraction))
}
