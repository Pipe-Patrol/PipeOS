import { useState } from 'react'

/**
 * The track as it is being driven, accumulated on this device.
 *
 * WHY THIS EXISTS. The robot samples the path every 0.25 m into `run.path`, but
 * the console only re-reads a run when something happens to it — a snapshot, a
 * defect, the run ending. Between those the map had exactly two points to draw:
 * the vertex from the last refetch and the live position. So the track came out
 * as straight lines with a corner wherever a marker had been logged, which is a
 * drawing of when the operator pressed a button, not of where the robot went.
 *
 * Telemetry already carries the position ten times a second. Accumulating it
 * here costs one array and no requests, and gives a line that actually follows
 * the curve.
 *
 * The robot's own copy stays the record of truth — it is what ends up in
 * run.json, it survives the console being closed, and it is what the run detail
 * page draws. This is the live view only, and it is seeded from the robot's copy
 * so that a console opened halfway through a run still shows the first half.
 */

export interface TrailPoint {
  x: number
  y: number
}

/**
 * Mirrors `config.PATH_SAMPLE_INTERVAL_M` on the robot. Sampling by distance
 * rather than by time is what keeps a parked robot from filling the array with
 * thousands of identical points.
 */
export const SAMPLE_INTERVAL_M = 0.25

/** Mirrors `config.PATH_MAX_POINTS`. At 0.25 m that is 500 m of pipe. */
export const MAX_POINTS = 2000

/**
 * The trail with `point` added, or the same array back when it is too close to
 * matter. Returning the identical reference is what stops a 10 Hz telemetry
 * feed from re-rendering the map ten times a second.
 */
export function appendPoint(trail: TrailPoint[], point: TrailPoint): TrailPoint[] {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return trail
  if (trail.length >= MAX_POINTS) return trail

  const last = trail[trail.length - 1]
  if (last) {
    const moved = Math.hypot(point.x - last.x, point.y - last.y)
    if (moved < SAMPLE_INTERVAL_M) return trail
  }
  return [...trail, { x: point.x, y: point.y }]
}

interface TrailState {
  runId: string | null
  trail: TrailPoint[]
}

/**
 * Adjusted during render rather than in an effect, which is the documented
 * React pattern for state derived from changing props. An effect would render
 * the map once with the stale trail and again with the new one, ten times a
 * second, for a line that is meant to be smooth.
 *
 * Every branch converges: after each update its own condition is false, so the
 * re-render settles immediately.
 */
export function useLiveTrail(
  runId: string | null,
  position: TrailPoint | null,
  seed: TrailPoint[] | undefined,
): TrailPoint[] {
  const [state, setState] = useState<TrailState>({ runId, trail: [] })

  let current = state

  // A new run is a new track. Nothing from the last one belongs on it.
  if (current.runId !== runId) {
    current = { runId, trail: [] }
    setState(current)
  }

  // Seed from the robot's copy, which covers anything driven before this
  // console connected. Only ever grows the trail: once it has been extended
  // locally past what the last refetch returned, a later refetch must not
  // truncate it back to the marker it was fetched at.
  if (seed && seed.length > current.trail.length) {
    current = { ...current, trail: seed.map((p) => ({ x: p.x, y: p.y })) }
    setState(current)
  }

  if (runId && position) {
    const grown = appendPoint(current.trail, position)
    // Identical reference back means the robot has not moved far enough to be
    // worth a vertex, and nothing needs to change.
    if (grown !== current.trail) {
      current = { ...current, trail: grown }
      setState(current)
    }
  }

  return current.trail
}
