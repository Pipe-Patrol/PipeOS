import type { Telemetry } from '@/robot/types'

/**
 * The link to one robot.
 *
 * Owns the socket, the reconnect, the command send loop, and the round-trip
 * clock. React components subscribe; nothing above this file touches a
 * WebSocket.
 *
 * One rule that is load-bearing rather than stylistic:
 *
 * Zeros are commands. The server's watchdog cuts the motors after 500 ms of
 * silence, so a stopped robot still needs a steady stream of `{left: 0,
 * right: 0}` — that is how it tells "the operator is holding still" from
 * "the operator is gone". Releasing the throttle sends zeros; there is no
 * separate stop path, the watchdog is the backstop.
 */

const SEND_INTERVAL_MS = 50 // well inside the 500 ms watchdog window
const PING_INTERVAL_MS = 1000
const RECONNECT_DELAY_MS = 1000
const TELEMETRY_STALE_MS = 1500

export type LinkState = 'connecting' | 'connected' | 'stale' | 'down'

export interface LinkStatus {
  state: LinkState
  /** Round trip in ms, measured entirely browser-side. Null until first pong. */
  latencyMs: number | null
  detail: string
}

export interface DriveCommand {
  left: number
  right: number
}

type TelemetryListener = (telemetry: Telemetry) => void
type LinkListener = (status: LinkStatus) => void

/** Normalise whatever the operator typed into an origin we can build URLs from. */
export function normaliseBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (trimmed === '') return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  // A bare host or host:port. The robot speaks http; an https origin could not
  // open a ws:// socket to a local address anyway.
  return `http://${trimmed}`
}

export class RobotClient {
  readonly baseUrl: string

  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private sendTimer: ReturnType<typeof setInterval> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null

  private command: DriveCommand = { left: 0, right: 0 }
  private lastTelemetryAt = 0
  private latencyMs: number | null = null
  private closed = false

  private telemetryListeners = new Set<TelemetryListener>()
  private linkListeners = new Set<LinkListener>()
  private link: LinkStatus = { state: 'down', latencyMs: null, detail: 'not connected' }

  /** `''` means same origin — the console served from the Pi itself. */
  constructor(baseUrl = '') {
    this.baseUrl = normaliseBaseUrl(baseUrl)
  }

  // --- urls ---

  get httpBase(): string {
    return this.baseUrl || window.location.origin
  }

  get socketUrl(): string {
    return `${this.httpBase.replace(/^http/i, 'ws')}/ws`
  }

  /**
   * The MJPEG endpoint, with a cache-buster.
   *
   * `<img src>` will happily reuse a dead stream from cache on reconnect, and a
   * frozen frame that looks live is the single most dangerous thing this UI can
   * render.
   */
  cameraUrl(nonce: number | string = Date.now()): string {
    return `${this.httpBase}/api/camera?t=${nonce}`
  }

  /**
   * One frame, frozen. Not the stream.
   *
   * `at` is the moment being frozen, and it is the whole point: the same
   * timestamp keeps resolving to the same picture out of cache, so a preview of
   * the frame a defect was filed against stays that frame instead of drifting
   * into a live view of wherever the robot has got to since.
   */
  stillUrl(at: number | string): string {
    return `${this.httpBase}/api/camera/still?t=${at}`
  }

  mediaUrl(path: string): string {
    return `${this.httpBase}${path}`
  }

  // --- lifecycle ---

  connect(): void {
    this.closed = false
    this.openSocket()
    this.sendTimer ??= setInterval(() => this.flushCommand(), SEND_INTERVAL_MS)
    this.pingTimer ??= setInterval(() => this.ping(), PING_INTERVAL_MS)
  }

  close(): void {
    this.closed = true
    this.clearReconnect()
    if (this.sendTimer) clearInterval(this.sendTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.sendTimer = null
    this.pingTimer = null
    this.command = { left: 0, right: 0 }
    if (this.socket) {
      // Drop the handlers first: an onclose firing during teardown would
      // schedule a reconnect to a robot we are deliberately leaving.
      this.socket.onclose = null
      this.socket.onerror = null
      this.socket.onmessage = null
      this.socket.close()
      this.socket = null
    }
    this.setLink({ state: 'down', latencyMs: null, detail: 'disconnected' })
  }

  private openSocket(): void {
    this.clearReconnect()
    this.setLink({ state: 'connecting', latencyMs: null, detail: 'connecting' })

    let socket: WebSocket
    try {
      socket = new WebSocket(this.socketUrl)
    } catch {
      this.scheduleReconnect('could not open socket')
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.lastTelemetryAt = Date.now()
      this.latencyMs = null
      this.setLink({ state: 'connected', latencyMs: null, detail: 'connected' })
    }

    socket.onmessage = (event) => {
      this.lastTelemetryAt = Date.now()
      let payload: unknown
      try {
        payload = JSON.parse(event.data as string)
      } catch {
        return
      }
      if (!payload || typeof payload !== 'object') return

      const message = payload as { type?: string; t?: number }
      if (message.type === 'pong') {
        // Both timestamps are ours, so the two clocks never have to agree.
        this.latencyMs = Date.now() - (message.t ?? Date.now())
        this.setLink({ ...this.link, latencyMs: this.latencyMs })
        return
      }
      this.emitTelemetry(payload as Telemetry)
    }

    // Both fire the instant the socket dies — no polling delay before the
    // indicator goes red.
    socket.onclose = () => this.scheduleReconnect('disconnected')
    socket.onerror = () => this.scheduleReconnect('socket error')
  }

  private scheduleReconnect(detail: string): void {
    if (this.closed) return
    this.command = { left: 0, right: 0 }
    this.setLink({ state: 'down', latencyMs: null, detail })
    this.clearReconnect()
    this.reconnectTimer = setTimeout(() => this.openSocket(), RECONNECT_DELAY_MS)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private get isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN
  }

  // --- commands ---

  /** Set the held command. The send loop is what actually delivers it. */
  setDrive(left: number, right: number): void {
    this.command = { left, right }
  }

  private flushCommand(): void {
    if (!this.isOpen) return
    this.send({ type: 'drive', ...this.command })

    if (
      this.lastTelemetryAt &&
      Date.now() - this.lastTelemetryAt > TELEMETRY_STALE_MS
    ) {
      this.setLink({
        state: 'stale',
        latencyMs: this.latencyMs,
        detail: 'no telemetry',
      })
    }
  }

  private ping(): void {
    this.send({ type: 'ping', t: Date.now() })
  }

  setLed(level: number): void {
    if (!this.send({ type: 'led', level })) {
      void fetch(`${this.httpBase}/api/led`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level }),
      }).catch(() => {})
    }
  }

  private send(payload: unknown): boolean {
    if (!this.isOpen) return false
    try {
      this.socket!.send(JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }

  /** REST helper. Throws on a non-2xx so callers can surface the reason. */
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.httpBase}${path}`, {
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(detail || `${response.status} ${response.statusText}`)
    }
    try {
      return (await response.json()) as T
    } catch {
      // A 200 that is not JSON — e.g. a dev server or proxy returning HTML.
      throw new Error('unexpected response from the robot')
    }
  }

  // --- subscriptions ---

  subscribe(listener: TelemetryListener): () => void {
    this.telemetryListeners.add(listener)
    return () => this.telemetryListeners.delete(listener)
  }

  onLink(listener: LinkListener): () => void {
    this.linkListeners.add(listener)
    listener(this.link)
    return () => this.linkListeners.delete(listener)
  }

  private emitTelemetry(telemetry: Telemetry): void {
    if (this.link.state !== 'connected') {
      this.setLink({
        state: 'connected',
        latencyMs: this.latencyMs,
        detail: 'connected',
      })
    }
    for (const listener of this.telemetryListeners) listener(telemetry)
  }

  private setLink(status: LinkStatus): void {
    this.link = status
    for (const listener of this.linkListeners) listener(status)
  }
}
