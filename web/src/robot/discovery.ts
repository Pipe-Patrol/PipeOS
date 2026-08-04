import { normaliseBaseUrl } from '@/robot/client'
import type { Health } from '@/robot/types'

/**
 * Finding a robot without making the operator type a URL.
 *
 * A browser cannot scan a network or resolve mDNS itself, so this does the only
 * thing it can: probe a short list of plausible addresses at once and show
 * whichever answer. In practice that covers every real case —
 *
 *   served   the console was loaded FROM a robot, so the origin is one
 *   saved    a device set up by hand, remembered across sessions
 *
 * The probe is `GET /api/health`: cheap, no side effects, and safe to fire at
 * several hosts that are probably not robots.
 */

const STORAGE_KEY = 'pipepatrol.robots'
const PROBE_TIMEOUT_MS = 2500

export type CandidateSource = 'served' | 'saved'

export interface Candidate {
  /** `''` for same origin. Also the storage key. */
  baseUrl: string
  label: string
  source: CandidateSource
  lastConnectedAt?: number
}

interface SavedRobot {
  baseUrl: string
  label: string
  lastConnectedAt: number
}

/** Ask an address whether it is a robot. Rejects rather than hangs. */
export async function probe(
  baseUrl: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<Health> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const base = normaliseBaseUrl(baseUrl) || window.location.origin
    const response = await fetch(`${base}/api/health`, { signal: controller.signal })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    // A dev server answers every path with index.html — a 200 whose body is
    // HTML. Parsing that as JSON throws "Unexpected token '<'"; catch it and
    // report the real meaning instead of leaking a parser error to the UI.
    let health: Health
    try {
      health = (await response.json()) as Health
    } catch {
      throw new Error('not a PipePatrol robot')
    }
    // Identity is checked, not just reachability.
    if (health?.service !== 'pipepatrol') throw new Error('not a PipePatrol robot')
    return health
  } finally {
    clearTimeout(timer)
  }
}

/** Everything worth probing, deduplicated, saved robots most recent first. */
export function candidates(): Candidate[] {
  const found: Candidate[] = []
  const seen = new Set<string>()

  const add = (candidate: Candidate) => {
    const key = normaliseBaseUrl(candidate.baseUrl)
    if (seen.has(key)) return
    seen.add(key)
    found.push(candidate)
  }

  // Only offer the origin when it could plausibly be a robot. On the Vite dev
  // server it never is, and a permanently-failing row teaches the operator to
  // ignore the list.
  if (!isDevServer()) {
    add({ baseUrl: '', label: 'This device', source: 'served' })
  }

  for (const robot of saved()) {
    add({
      baseUrl: robot.baseUrl,
      label: robot.label,
      source: 'saved',
      lastConnectedAt: robot.lastConnectedAt,
    })
  }

  return found
}

function isDevServer(): boolean {
  return window.location.port === '5173'
}

// --- remembered robots ---

export function saved(): SavedRobot[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedRobot[]
    if (!Array.isArray(parsed)) return []
    return parsed.sort((a, b) => b.lastConnectedAt - a.lastConnectedAt)
  } catch {
    return []
  }
}

/**
 * Add a device the operator set up by hand, under the name they gave it.
 *
 * Stored before any successful connection, so it shows up in the list even when
 * the robot is not powered on yet — setting a device up and turning it on are
 * two separate moments.
 */
export function saveDevice(baseUrl: string, name: string): void {
  const normalised = normaliseBaseUrl(baseUrl)
  if (!normalised) return

  const label = name.trim() || normalised.replace(/^https?:\/\//i, '')
  const others = saved().filter((robot) => robot.baseUrl !== normalised)
  write(
    [
      { baseUrl: normalised, label, lastConnectedAt: Date.now() },
      ...others,
    ].slice(0, 8),
  )
}

export function remember(baseUrl: string, health?: Health): void {
  // The origin is wherever the console happens to be served from; remembering
  // it would pin an address that is different on the next device.
  if (baseUrl === '') return

  // A name the operator typed when setting the device up wins over the robot's
  // own hostname — they named it that on purpose.
  const existing = saved().find((robot) => robot.baseUrl === baseUrl)
  const label =
    existing?.label || health?.hostname || baseUrl.replace(/^https?:\/\//i, '')
  const others = saved().filter((robot) => robot.baseUrl !== baseUrl)
  const updated: SavedRobot[] = [
    { baseUrl, label, lastConnectedAt: Date.now() },
    ...others,
  ].slice(0, 8)
  write(updated)
}

export function forget(baseUrl: string): void {
  write(saved().filter((robot) => robot.baseUrl !== baseUrl))
}

function write(robots: SavedRobot[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(robots))
  } catch {
    // Private browsing, or a full quota. Discovery still works this session.
  }
}
