/**
 * The socket half: a stand-in for the `/ws` control channel.
 *
 * `RobotClient` opens one WebSocket and does everything through it — commands
 * out at 20 Hz, telemetry in at 10 Hz, and a ping it times the round trip on.
 * This answers all three.
 *
 * The install is a Proxy over the real constructor rather than a replacement
 * class, so `WebSocket.OPEN`, `instanceof WebSocket` and every other static
 * still behave — and, more importantly, so **Vite's own HMR socket keeps
 * working**. Only `/ws` on this origin is taken; everything else is constructed
 * for real.
 */

import { robot } from './robot'

const CONNECTING = 0
const OPEN = 1
const CLOSED = 3

type Listener = (event: unknown) => void

class SimSocket {
  static readonly CONNECTING = CONNECTING
  static readonly OPEN = OPEN
  static readonly CLOSING = 2
  static readonly CLOSED = CLOSED

  readonly CONNECTING = CONNECTING
  readonly OPEN = OPEN
  readonly CLOSING = 2
  readonly CLOSED = CLOSED

  readonly url: string
  readonly protocol = ''
  readonly extensions = ''
  binaryType: BinaryType = 'blob'
  bufferedAmount = 0
  readyState: number = CONNECTING

  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null

  private listeners = new Map<string, Set<Listener>>()
  private unsubscribe: (() => void) | null = null
  private haltWatch: ReturnType<typeof setInterval> | null = null

  constructor(url: string) {
    this.url = url

    // A halted robot refuses the connection, which is what puts the console
    // into its reconnect loop with a red link — the thing worth testing.
    if (robot.isHalted) {
      setTimeout(() => {
        this.readyState = CLOSED
        this.fire('error', {})
        this.fire('close', { code: 1006, reason: 'robot is down', wasClean: false })
      }, 0)
      return
    }

    // Asynchronous on purpose: the caller assigns onopen/onmessage *after* the
    // constructor returns, and an open fired inline would be missed.
    setTimeout(() => {
      if (this.readyState !== CONNECTING) return
      this.readyState = OPEN
      this.fire('open', {})
      this.unsubscribe = robot.subscribe((telemetry) => {
        this.deliver(JSON.stringify(telemetry))
      })
      // The socket has to die when the robot does, the same way a real one
      // would when the Pi halts.
      this.haltWatch = setInterval(() => {
        if (robot.isHalted) this.drop(1006, 'robot went down')
      }, 200)
    }, 0)
  }

  send(data: string): void {
    if (this.readyState !== OPEN) return
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    if (!payload || typeof payload !== 'object') return

    const type = typeof payload.type === 'string' ? payload.type : 'drive'
    if (type === 'ping') {
      // Echoed straight back. The browser owns the clock, so the two never have
      // to agree on the time.
      this.deliver(JSON.stringify({ type: 'pong', t: payload.t }))
    } else if (type === 'stop') {
      robot.stop('client stop')
    } else if (type === 'led') {
      robot.setLed(Number(payload.level) || 0)
    } else {
      robot.drive(Number(payload.left) || 0, Number(payload.right) || 0)
    }
  }

  close(): void {
    this.drop(1000, 'closed by client')
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatchEvent(): boolean {
    return true
  }

  // --- internals ---

  private drop(code: number, reason: string): void {
    if (this.readyState === CLOSED) return
    this.readyState = CLOSED
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.haltWatch !== null) clearInterval(this.haltWatch)
    this.haltWatch = null
    // A socket dropping is exactly what the drive watchdog exists for, but stop
    // immediately rather than waiting out the 500 ms.
    robot.stop('client disconnected')
    this.fire('close', { code, reason, wasClean: code === 1000 })
  }

  private deliver(data: string): void {
    if (this.readyState !== OPEN) return
    const event = { data, type: 'message' }
    this.onmessage?.(event)
    for (const listener of this.listeners.get('message') ?? []) listener(event)
  }

  private fire(type: 'open' | 'close' | 'error', detail: Record<string, unknown>): void {
    const event = { type, ...detail }
    if (type === 'open') this.onopen?.(event)
    if (type === 'close') this.onclose?.(event)
    if (type === 'error') this.onerror?.(event)
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

/** Only our own control channel. Vite's HMR socket must construct for real. */
function isControlSocket(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.pathname === '/ws' && parsed.host === window.location.host
  } catch {
    return false
  }
}

let installed = false

export function installSocket(): void {
  if (installed) return
  installed = true

  const RealWebSocket = window.WebSocket

  window.WebSocket = new Proxy(RealWebSocket, {
    construct(target, args: [string, (string | string[])?]) {
      const [url] = args
      if (typeof url === 'string' && isControlSocket(url)) {
        return new SimSocket(url) as unknown as WebSocket
      }
      return Reflect.construct(target, args)
    },
  })
}
