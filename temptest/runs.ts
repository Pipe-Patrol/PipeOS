/**
 * The run store, in memory.
 *
 * Mirrors what `server/pipepatrol/runs/store.py` keeps on the Pi's SD card, so
 * the console cannot tell the difference. Nothing is persisted: a reload gives
 * you the seeds back, which is the behaviour you want from a scratch pad.
 *
 * This module knows nothing about the robot. Chainage and uncertainty are
 * stamped by the caller (api.ts) from the live odometry, exactly as the real
 * server does in `add_defect` — which is what keeps the two from importing each
 * other in a circle.
 */

import type { Origin } from '../web/src/components/map/geo'
import type {
  Defect,
  DefectRegion,
  PathPoint,
  Run,
  RunSummary,
  Snapshot,
} from '../web/src/robot/types'

/** Matches the ids the Pi generates — 12 hex characters. */
export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

/** What the server names a run the operator did not name. */
export function autoName(at = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    'Run',
    at.getFullYear(),
    pad(at.getMonth() + 1),
    pad(at.getDate()),
    pad(at.getHours()),
    pad(at.getMinutes()),
  ].join('-')
}

const runs = new Map<string, Run>()
/** Last moment anything was written to a run. Gives interrupted runs a duration. */
const lastActivity = new Map<string, number>()

let activeRunId: string | null = null

export function activeId(): string | null {
  return activeRunId
}

export function get(id: string): Run | undefined {
  return runs.get(id)
}

function touch(id: string): void {
  lastActivity.set(id, Date.now() / 1000)
}

function durationOf(run: Run): number {
  const end = run.ended_at ?? lastActivity.get(run.id) ?? Date.now() / 1000
  return Math.max(0, end - run.started_at)
}

function isInterrupted(run: Run): boolean {
  return run.ended_at === null && run.id !== activeRunId
}

export function summarise(run: Run): RunSummary {
  return {
    id: run.id,
    name: run.name,
    started_at: run.started_at,
    ended_at: run.ended_at,
    duration_s: durationOf(run),
    origin: run.origin,
    distance_m: run.distance_m,
    uncertainty_m: run.uncertainty_m,
    interrupted: isInterrupted(run),
    defect_count: run.defects.length,
    snapshot_count: run.snapshots.length,
    // The simulator writes no video. See README — the export menu only offers
    // video when there is a recording, so leaving the list empty is what keeps
    // the console from offering a download that could not exist.
    has_recording: run.recordings.length > 0,
  }
}

/** Newest first, the way the run list renders them. */
export function list(): RunSummary[] {
  return [...runs.values()]
    .sort((a, b) => b.started_at - a.started_at)
    .map(summarise)
}

export function interrupted(): RunSummary[] {
  return list().filter((run) => run.interrupted)
}

/** The detail view wants live duration and interrupted state, not the stored ones. */
export function detail(id: string): Run | null {
  const run = runs.get(id)
  if (!run) return null
  const summary = summarise(run)
  return { ...run, duration_s: summary.duration_s, interrupted: summary.interrupted }
}

export function start(name: string, origin: Origin | null): Run {
  const now = Date.now() / 1000
  const run: Run = {
    id: newId(),
    name: name.trim() || autoName(),
    started_at: now,
    ended_at: null,
    duration_s: 0,
    origin,
    distance_m: 0,
    uncertainty_m: 0,
    interrupted: false,
    note: '',
    defects: [],
    snapshots: [],
    recordings: [],
    path: [],
  }
  runs.set(run.id, run)
  touch(run.id)
  activeRunId = run.id
  return run
}

export function end(): Run | null {
  if (!activeRunId) return null
  const run = runs.get(activeRunId)
  activeRunId = null
  if (!run) return null
  run.ended_at = Date.now() / 1000
  run.duration_s = durationOf(run)
  touch(run.id)
  return run
}

/** Reopen a run that was never ended. Ended runs are refused, as on the Pi. */
export function resume(id: string): Run | null {
  const run = runs.get(id)
  if (!run || run.ended_at !== null) return null
  activeRunId = id
  touch(id)
  return run
}

export function remove(id: string): boolean {
  if (id === activeRunId) return false
  lastActivity.delete(id)
  return runs.delete(id)
}

export function addDefect(
  runId: string,
  fields: {
    code: string
    severity: number
    clock_position: number | null
    note: string
    detection_id: string | null
    region: DefectRegion | null
    chainage_m: number | null
    chainage_uncertainty_m: number | null
    snapshot_id: string | null
  },
): Defect | null {
  const run = runs.get(runId)
  if (!run) return null
  const defect: Defect = { id: newId(), at: Date.now() / 1000, ...fields }
  run.defects.push(defect)
  touch(runId)
  return defect
}

export function deleteDefect(runId: string, defectId: string): boolean {
  const run = runs.get(runId)
  if (!run) return false
  const before = run.defects.length
  run.defects = run.defects.filter((defect) => defect.id !== defectId)
  if (run.defects.length === before) return false
  touch(runId)
  return true
}

export function addSnapshot(runId: string, chainageM: number | null): Snapshot | null {
  const run = runs.get(runId)
  if (!run) return null
  const index = run.snapshots.length + 1
  const snapshot: Snapshot = {
    id: newId(),
    at: Date.now() / 1000,
    chainage_m: chainageM,
    // Every snapshot url is answered with sample-pipe.jpg by the dev-server
    // middleware in web/vite.config.ts, so the name only has to be plausible.
    file: `snap-${String(index).padStart(4, '0')}.jpg`,
  }
  run.snapshots.push(snapshot)
  touch(runId)
  return snapshot
}

/** Called by the physics tick, every PATH_SAMPLE_INTERVAL_M of travel. */
export function addPathPoint(runId: string, point: PathPoint): void {
  const run = runs.get(runId)
  if (!run) return
  // PATH_MAX_POINTS in the server's config.py.
  if (run.path.length >= 2000) return
  run.path.push(point)
  touch(runId)
}

/** The odometer values that ride along on the run summary. */
export function updateOdometry(runId: string, distanceM: number, uncertaintyM: number): void {
  const run = runs.get(runId)
  if (!run) return
  run.distance_m = distanceM
  run.uncertainty_m = uncertaintyM
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

/**
 * Enough history that the run list, the run detail page and the map all have
 * something real to render the moment the simulator boots.
 *
 * The origins are around UMD College Park, so the map tiles under the track are
 * somewhere recognisable rather than the middle of the Atlantic.
 */
const UMD = { lat: 38.9869, lon: -76.9426 }

function origin(dLat: number, dLon: number, bearingDeg: number): Origin {
  return { lat: UMD.lat + dLat, lon: UMD.lon + dLon, bearing_deg: bearingDeg }
}

/** A track that runs mostly straight with the wander real dead reckoning has. */
function seedPath(startedAt: number, lengthM: number, headingDeg: number): PathPoint[] {
  const points: PathPoint[] = []
  const step = 0.25
  let x = 0
  let y = 0
  let heading = headingDeg
  for (let travelled = 0; travelled <= lengthM; travelled += step) {
    // Deterministic wander — a couple of degrees, on two beats that do not
    // line up, so the track never looks drawn with a ruler.
    heading =
      headingDeg + 2.5 * Math.sin(travelled / 7.5) + 1.2 * Math.sin(travelled / 2.9)
    const radians = (heading * Math.PI) / 180
    x += step * Math.cos(radians)
    y += step * Math.sin(radians)
    points.push({
      chainage_m: Number(travelled.toFixed(2)),
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
      heading_deg: Number(((heading + 360) % 360).toFixed(1)),
      uncertainty_m: Number((0.03 * travelled).toFixed(3)),
      // 0.2 m/s, near enough the robot's real top speed.
      at: startedAt + travelled / 0.2,
    })
  }
  return points
}

interface SeedDefect {
  code: string
  severity: number
  clock: number | null
  note: string
  chainage: number
  region?: DefectRegion
}

function seedRun(spec: {
  name: string
  startedMinutesAgo: number
  lengthM: number
  headingDeg: number
  origin: Origin | null
  defects: SeedDefect[]
  snapshotCount: number
  /** Never ended — the power cut. Drives the resume prompt. */
  interrupted?: boolean
}): Run {
  const startedAt = Date.now() / 1000 - spec.startedMinutesAgo * 60
  const path = seedPath(startedAt, spec.lengthM, spec.headingDeg)
  const last = path[path.length - 1]
  const endedAt = spec.interrupted ? null : last.at + 20

  const snapshots: Snapshot[] = Array.from({ length: spec.snapshotCount }, (_, index) => {
    const chainage = ((index + 1) / (spec.snapshotCount + 1)) * spec.lengthM
    return {
      id: newId(),
      at: startedAt + chainage / 0.2,
      chainage_m: Number(chainage.toFixed(2)),
      file: `snap-${String(index + 1).padStart(4, '0')}.jpg`,
    }
  })

  const defects: Defect[] = spec.defects.map((defect, index) => ({
    id: newId(),
    at: startedAt + defect.chainage / 0.2,
    code: defect.code,
    severity: defect.severity,
    clock_position: defect.clock,
    note: defect.note,
    chainage_m: defect.chainage,
    chainage_uncertainty_m: Number((0.03 * defect.chainage).toFixed(3)),
    // Pair each defect with a snapshot where there is one to pair it with, so
    // the detail page exercises the "defect has a still" path as well as the
    // bare one.
    snapshot_id: snapshots[index]?.id ?? null,
    detection_id: null,
    region: defect.region ?? null,
  }))

  const run: Run = {
    id: newId(),
    name: spec.name,
    started_at: startedAt,
    ended_at: endedAt,
    duration_s: endedAt === null ? last.at - startedAt : endedAt - startedAt,
    origin: spec.origin,
    distance_m: Number(spec.lengthM.toFixed(2)),
    uncertainty_m: Number((0.03 * spec.lengthM).toFixed(2)),
    interrupted: Boolean(spec.interrupted),
    note: '',
    defects,
    snapshots,
    recordings: [],
    path,
  }
  runs.set(run.id, run)
  lastActivity.set(run.id, last.at)
  return run
}

let seeded = false

export function seed(): void {
  if (seeded) return
  seeded = true

  seedRun({
    name: 'Baltimore Ave 12in',
    startedMinutesAgo: 260,
    lengthM: 62.5,
    headingDeg: 12,
    origin: origin(0.0004, -0.0009, 12),
    snapshotCount: 6,
    defects: [
      {
        code: 'RO',
        severity: 4,
        clock: 12,
        note: 'Fine root mass through the joint, most of the crown.',
        chainage: 11.8,
        region: { x: 0.34, y: 0.12, w: 0.3, h: 0.26 },
      },
      {
        code: 'CR',
        severity: 2,
        clock: 3,
        note: 'Longitudinal, hairline, runs about a metre.',
        chainage: 24.4,
        region: { x: 0.62, y: 0.38, w: 0.14, h: 0.34 },
      },
      {
        code: 'DE',
        severity: 3,
        clock: 6,
        note: 'Silt over the invert, roughly a fifth of the bore.',
        chainage: 41.0,
      },
      {
        code: 'JD',
        severity: 4,
        clock: 9,
        note: 'Joint open and offset — visible daylight gap.',
        chainage: 58.2,
        region: { x: 0.2, y: 0.3, w: 0.42, h: 0.4 },
      },
    ],
  })

  seedRun({
    name: 'Campus Dr lateral',
    startedMinutesAgo: 95,
    lengthM: 24.75,
    headingDeg: 288,
    origin: origin(-0.0006, 0.0011, 288),
    snapshotCount: 3,
    defects: [
      {
        code: 'EN',
        severity: 2,
        clock: 5,
        note: 'Scale on the wall, no loss of section.',
        chainage: 8.5,
      },
      {
        code: 'IN',
        severity: 3,
        clock: 2,
        note: 'Steady weeper at the joint.',
        chainage: 19.25,
        region: { x: 0.48, y: 0.2, w: 0.18, h: 0.22 },
      },
    ],
  })

  // No origin on purpose: the operator never placed this one on the map, so the
  // console has to fall back to drawing the track in its own local frame.
  seedRun({
    name: 'Paint Branch outfall',
    startedMinutesAgo: 1500,
    lengthM: 41.0,
    headingDeg: 205,
    origin: null,
    snapshotCount: 4,
    defects: [
      {
        code: 'SD',
        severity: 3,
        clock: 7,
        note: 'Aggregate showing where the surface has gone.',
        chainage: 6.75,
      },
      {
        code: 'FR',
        severity: 4,
        clock: 11,
        note: 'Circumferential fracture, pieces still in place.',
        chainage: 22.5,
        region: { x: 0.26, y: 0.16, w: 0.36, h: 0.3 },
      },
      {
        code: 'OB',
        severity: 5,
        clock: 6,
        note: 'Brick across the invert. Turned back here.',
        chainage: 40.5,
        region: { x: 0.3, y: 0.52, w: 0.4, h: 0.3 },
      },
    ],
  })

  // Never ended. This is the one the console offers to resume.
  seedRun({
    name: 'Regents Dr trunk',
    startedMinutesAgo: 38,
    lengthM: 17.25,
    headingDeg: 74,
    origin: origin(0.0009, 0.0004, 74),
    snapshotCount: 2,
    interrupted: true,
    defects: [
      {
        code: 'DEF',
        severity: 3,
        clock: 4,
        note: 'Bore out of round, maybe ten percent.',
        chainage: 12.0,
      },
    ],
  })
}
