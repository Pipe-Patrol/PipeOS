/**
 * The REST half of the simulator: a `fetch` shim with a routing table.
 *
 * Every route here answers with the same body and status code as the FastAPI
 * route of the same name, because the console reads both — a 409 with the wrong
 * `error` string surfaces as the wrong sentence in the UI.
 *
 * Two paths are deliberately NOT intercepted:
 *
 *   GET /api/camera                      the live feed
 *   GET /api/runs/<id>/snapshots/<file>  every still
 *
 * Those are `<img>` loads, not fetches, and the dev-server middleware in
 * web/vite.config.ts already answers them with sample-pipe.jpg. Letting them
 * fall through to the real fetch keeps one answer for both.
 *
 * Anything else under /api/ that has no route here gets a 404 *and* a console
 * warning, so an endpoint nobody stubbed shows up as a message rather than as a
 * mysteriously empty panel.
 */

import type { Origin } from '../web/src/components/map/geo'

import { robot } from './robot'
import * as runs from './runs'

type Handler = (
  match: RegExpMatchArray,
  body: Record<string, unknown>,
) => Response | Promise<Response>

interface Route {
  method: string
  pattern: RegExp
  handler: Handler
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Captured at import, before the shim replaces window.fetch. */
const realFetch = window.fetch.bind(window)

/** Paths the dev-server middleware owns. We must not answer these. */
function isMediaPath(path: string): boolean {
  return path === '/api/camera' || /^\/api\/runs\/[^/]+\/snapshots\/[^/]+$/.test(path)
}

/**
 * The model is real even in test mode. /api/detect goes to the local
 * pipepatrol server (vite proxies it), so detections are the Mac's own
 * inference rather than a stub. detectorReady is what health reports.
 */
export let detectorReady = false

function isModelPath(path: string): boolean {
  return path === '/api/detect'
}

export async function probeDetector(): Promise<void> {
  try {
    const response = await realFetch('/api/health')
    const health = await response.json()
    detectorReady = Boolean(health?.capabilities?.detector)
  } catch {
    detectorReady = false
  }
  console.info(
    detectorReady
      ? '[temptest] model found on the local server — detections are real'
      : '[temptest] no local model. Start it: cd server && .venv/bin/python -m pipepatrol',
  )
}

/** The probes on the robot sleep; answering instantly does not look like work. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** One probe result, shaped exactly as preflight.py's `_result` builds it. */
function probe(
  ran: boolean,
  ok: boolean,
  reason = '',
  confirmed = false,
  evidence: Record<string, number | string> = {},
) {
  return { ran, ok, reason, confirmed, evidence }
}

/**
 * The motor probe. `ran: false` while a run is open, which is the robot's own
 * behaviour — the decision stays on the side that knows for certain whether it
 * is safe to turn, and the console is written to expect that answer.
 */
function motorProbe() {
  if (runs.activeId()) {
    return probe(false, true, 'a run is open, so the motors were not turned')
  }
  return probe(true, true, '', true, { yaw_delta_deg: 11.4 })
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function originFrom(value: unknown): Origin | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.lat !== 'number' || typeof raw.lon !== 'number') return null
  return {
    lat: raw.lat,
    lon: raw.lon,
    // The server fills a missing bearing in from its own heading when north has
    // been set, and falls back to north when it has not.
    bearing_deg: number(raw.bearing_deg, 0),
  }
}

const ROUTES: Route[] = [
  // --- identity ---

  {
    method: 'GET',
    pattern: /^\/api\/health$/,
    handler: () =>
      json({
        service: 'pipepatrol',
        version: '1.0.0-temptest',
        hostname: 'pipepatrol-sim',
        capabilities: {
          motors: true,
          camera: true,
          lights: true,
          imu: true,
          optical_flow: true,
          // Real: /api/detect passes through to the local server.
          detector: detectorReady,
        },
        // No voltage or current sensor is fitted on the real robot either.
        unavailable: ['battery', 'motor_current'],
        active_run_id: runs.activeId(),
      }),
  },

  {
    method: 'GET',
    pattern: /^\/api\/telemetry$/,
    handler: () => {
      const telemetry = robot.telemetry()
      return telemetry
        ? json(telemetry)
        : json({ error: 'no telemetry yet' }, 503)
    },
  },

  // --- driving and devices ---

  {
    method: 'POST',
    pattern: /^\/api\/stop$/,
    handler: () => {
      robot.stop('api stop')
      const telemetry = robot.telemetry()
      return json({ ok: true, drive: telemetry?.drive ?? null })
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/led$/,
    handler: (_match, body) => {
      const level = robot.setLed(number(body.level, 0))
      return json({ ok: true, level, lights: robot.telemetry()?.lights ?? null })
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/north$/,
    handler: (_match, body) =>
      json({ ok: true, north: robot.setNorth(number(body.facing_deg, 0)) }),
  },

  {
    method: 'DELETE',
    pattern: /^\/api\/north$/,
    handler: () => {
      robot.clearNorth()
      return json({ ok: true, north: null })
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/camera\/tuning$/,
    handler: (_match, body) => json({ ok: true, tuning: robot.setTuning(body) }),
  },

  // --- stills and recording ---

  {
    method: 'POST',
    pattern: /^\/api\/snapshot$/,
    handler: () => {
      const runId = runs.activeId()
      if (!runId) return json({ error: 'no active run to save into' }, 409)
      const snapshot = runs.addSnapshot(runId, robot.motion().chainage_m)
      return json({ ok: true, snapshot })
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/recording\/start$/,
    handler: () => {
      const runId = runs.activeId()
      if (!runId) return json({ error: 'no active run to record' }, 409)
      robot.startRecording()
      return json({ ok: true, recording: robot.telemetry()?.recording ?? null })
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/recording\/stop$/,
    handler: () => {
      const was = robot.telemetry()?.recording ?? null
      robot.stopRecording()
      // No file is written, so the run gains no `recording` — see README.
      return json({ ok: true, recording: was })
    },
  },

  // --- preflight ---
  //
  // Mirrors server/pipepatrol/api/preflight.py. Without these the console
  // cannot start a run against the simulator at all: RunSetupPanel holds the
  // gate shut until a probe report comes back, a 404 leaves that report null,
  // and "the preflight checks have to finish before this run can start" is then
  // permanently true with nothing on screen saying why.
  //
  // Every probe passes, because the simulated robot really does have all of
  // this. The battery is deliberately untouched: it is a REPORTED check rather
  // than a probe, it has no sensor behind it, and it must stay unavailable in
  // the list rather than being quietly proved by a stub.

  {
    method: 'POST',
    pattern: /^\/api\/preflight$/,
    handler: async (_match, body) => {
      await pause(700)

      const probes: Record<string, unknown> = {
        storage: probe(true, true, '', true, { free_bytes: 38_000_000_000 }),
        camera: probe(true, true, '', true, { frames: 14, waited_ms: 480 }),
        imu: probe(true, true, '', true, { samples: 20, drift_deg_s: 0.02 }),
        lights: probe(true, true, '', true, { delta_luminance: 26.4 }),
      }

      // Opt-in, exactly as the robot has it: a caller that does not ask for the
      // motors must not turn them.
      if (body.motors === true) probes.motors = motorProbe()

      return json({ at: Math.round(Date.now() / 100) / 10, probes })
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/preflight\/motors$/,
    handler: async () => {
      // Same refusal, same status, same `error` string as the robot: the
      // console turns this one into a sentence on screen.
      if (runs.activeId()) return json({ error: 'a run is already open' }, 409)
      await pause(900)
      return json(motorProbe())
    },
  },

  // --- runs ---

  {
    method: 'GET',
    pattern: /^\/api\/runs$/,
    handler: () => json({ runs: runs.list(), active_run_id: runs.activeId() }),
  },

  {
    method: 'POST',
    pattern: /^\/api\/runs$/,
    handler: (_match, body) => {
      const run = runs.start(
        typeof body.name === 'string' ? body.name : '',
        originFrom(body.origin),
      )
      // Chainage is signed distance from where this run started, so it starts
      // from zero here just as odometry.py does.
      robot.resetOdometer()
      if (body.record === true) robot.startRecording()
      return json({ ok: true, run: runs.detail(run.id) })
    },
  },

  {
    method: 'GET',
    pattern: /^\/api\/runs\/interrupted$/,
    handler: () => json({ runs: runs.interrupted() }),
  },

  {
    method: 'GET',
    pattern: /^\/api\/runs\/([^/]+)$/,
    handler: (match) => {
      const run = runs.detail(match[1])
      return run ? json(run) : json({ error: 'no such run' }, 404)
    },
  },

  {
    method: 'DELETE',
    pattern: /^\/api\/runs\/([^/]+)$/,
    handler: (match) => {
      if (match[1] === runs.activeId()) {
        return json({ error: 'cannot delete the run that is recording' }, 409)
      }
      return runs.remove(match[1])
        ? json({ ok: true })
        : json({ error: 'no such run' }, 404)
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/runs\/([^/]+)\/end$/,
    handler: (match) => {
      if (match[1] !== runs.activeId()) {
        return json({ error: 'that run is not active' }, 409)
      }
      robot.stopRecording()
      const run = runs.end()
      return json({ ok: true, run: run ? runs.detail(run.id) : null })
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/runs\/([^/]+)\/resume$/,
    handler: (match) => {
      const run = runs.resume(match[1])
      return run
        ? json({ ok: true, run: runs.detail(run.id) })
        : json({ error: 'no such run, or it was ended normally' }, 409)
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/runs\/([^/]+)\/defects$/,
    handler: (match, body) => {
      const runId = match[1]
      if (!runs.get(runId)) return json({ error: 'no such run' }, 404)

      const isActive = runId === runs.activeId()
      const withSnapshot = body.with_snapshot !== false
      const motion = robot.motion()

      // Chainage is stamped here rather than sent by the client, so it cannot
      // drift between the operator pressing the key and the request landing.
      const snapshot =
        withSnapshot && isActive ? runs.addSnapshot(runId, motion.chainage_m) : null

      const defect = runs.addDefect(runId, {
        code: typeof body.code === 'string' ? body.code : '',
        severity: Math.min(5, Math.max(1, Math.round(number(body.severity, 3)))),
        clock_position:
          typeof body.clock_position === 'number' ? body.clock_position : null,
        note: typeof body.note === 'string' ? body.note : '',
        detection_id:
          typeof body.detection_id === 'string' ? body.detection_id : null,
        region: (body.region as never) ?? null,
        chainage_m: isActive ? motion.chainage_m : null,
        chainage_uncertainty_m: isActive ? motion.uncertainty_m : null,
        snapshot_id: snapshot?.id ?? null,
      })
      return json({ ok: true, defect })
    },
  },

  {
    method: 'DELETE',
    pattern: /^\/api\/runs\/([^/]+)\/defects\/([^/]+)$/,
    handler: (match) =>
      runs.deleteDefect(match[1], match[2])
        ? json({ ok: true })
        : json({ error: 'no such defect' }, 404),
  },

  // --- power ---

  {
    method: 'POST',
    pattern: /^\/api\/shutdown$/,
    handler: () => {
      // Answer first, halt a beat later — the same ordering the server uses so
      // the response is on the wire before everything goes quiet.
      setTimeout(() => robot.halt(), 400)
      return json({ ok: true })
    },
  },
]

let installed = false

export function installFetch(): void {
  if (installed) return
  installed = true

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url

    let url: URL
    try {
      url = new URL(href, window.location.origin)
    } catch {
      return realFetch(input as RequestInfo, init)
    }

    // Another origin is a real robot on the network. Leave it alone.
    if (url.origin !== window.location.origin) return realFetch(input as RequestInfo, init)
    if (!url.pathname.startsWith('/api/')) return realFetch(input as RequestInfo, init)
    if (isMediaPath(url.pathname)) return realFetch(input as RequestInfo, init)
    // The model is not simulated. This goes to the real server on the Mac.
    if (isModelPath(url.pathname)) return realFetch(input as RequestInfo, init)

    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase()

    // The connect screen probes with an AbortController. Honour a signal that
    // has already fired, so a cancelled probe rejects the way a real one does.
    if (init?.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    // A halted robot is unreachable, not merely unhelpful.
    if (robot.isHalted) {
      throw new TypeError('Failed to fetch')
    }

    let body: Record<string, unknown> = {}
    if (init?.body && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body)
        if (parsed && typeof parsed === 'object') body = parsed
      } catch {
        return json({ error: 'malformed body' }, 422)
      }
    }

    for (const route of ROUTES) {
      if (route.method !== method) continue
      const match = url.pathname.match(route.pattern)
      if (!match) continue
      try {
        return await route.handler(match, body)
      } catch (error) {
        console.error('[temptest] route threw', method, url.pathname, error)
        return json({ error: 'simulator error' }, 500)
      }
    }

    console.warn('[temptest] no stub for', method, url.pathname)
    return json({ error: `no simulated route for ${method} ${url.pathname}` }, 404)
  }
}
