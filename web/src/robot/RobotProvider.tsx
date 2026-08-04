import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { RobotClient, type LinkStatus } from '@/robot/client'
import { probe, remember } from '@/robot/discovery'
import type { Health, Telemetry } from '@/robot/types'

/**
 * The connection, held above the router.
 *
 * Above it on purpose: navigating to the run list must not drop the link to a
 * robot that is forty metres into a pipe, and coming back must not have to
 * re-handshake.
 */

const LAST_ROBOT_KEY = 'pipepatrol.lastRobot'

export interface RobotContextValue {
  client: RobotClient | null
  link: LinkStatus
  telemetry: Telemetry | null
  health: Health | null
  connecting: boolean
  error: string | null
  connect: (baseUrl: string) => Promise<void>
  disconnect: () => void
}

const RobotContext = createContext<RobotContextValue | null>(null)

const OFFLINE: LinkStatus = { state: 'down', latencyMs: null, detail: 'not connected' }

export function RobotProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<RobotClient | null>(null)
  const [link, setLink] = useState<LinkStatus>(OFFLINE)
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  // Seeded true when a connection will be attempted on mount, NOT set by the
  // effect that attempts it. Between first paint and that effect running there
  // is a frame where a client does not exist yet and one is already on its way;
  // starting at false there sends every load to the picker, with every Connect
  // button disabled by the attempt already in flight.
  const [connecting, setConnecting] = useState(() => autoConnectTarget() !== null)
  const [error, setError] = useState<string | null>(null)

  const clientRef = useRef<RobotClient | null>(null)

  const disconnect = useCallback(() => {
    clientRef.current?.close()
    clientRef.current = null
    setClient(null)
    setTelemetry(null)
    setHealth(null)
    setLink(OFFLINE)
    try {
      window.sessionStorage.removeItem(LAST_ROBOT_KEY)
    } catch {
      // Session storage is unavailable in some embedded browsers. Not fatal.
    }
  }, [])

  const connect = useCallback(async (baseUrl: string) => {
    setConnecting(true)
    setError(null)
    try {
      // Probe before opening a socket: a failed fetch gives a readable reason,
      // where a failed WebSocket gives an opaque error event and a reconnect
      // loop that looks like the robot is merely slow.
      const found = await probe(baseUrl)

      clientRef.current?.close()
      const next = new RobotClient(baseUrl)
      clientRef.current = next
      next.connect()

      setClient(next)
      setHealth(found)
      remember(next.baseUrl, found)
      try {
        window.sessionStorage.setItem(LAST_ROBOT_KEY, baseUrl)
      } catch {
        // Not fatal — only costs an auto-reconnect on reload.
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'could not connect')
      throw caught
    } finally {
      setConnecting(false)
    }
  }, [])

  // Wire the active client's streams into React state.
  useEffect(() => {
    if (!client) return
    const stopTelemetry = client.subscribe(setTelemetry)
    const stopLink = client.onLink(setLink)
    return () => {
      stopTelemetry()
      stopLink()
    }
  }, [client])

  // A reload mid-run must not land on the picker. Reconnect to whatever this
  // tab was talking to, and fall back to the origin when the console was served
  // from a robot in the first place.
  useEffect(() => {
    const target = autoConnectTarget()
    if (target === null) return

    // Connecting to hardware on mount — see the note in robot/useRun.ts. A
    // failure needs no handling here: the picker is the fallback route and it
    // renders the error itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void connect(target).catch(() => {})
  }, [connect])

  // Close the socket on unload so the server cuts the motors immediately rather
  // than waiting out the watchdog.
  useEffect(() => {
    const onUnload = () => clientRef.current?.close()
    window.addEventListener('pagehide', onUnload)
    return () => window.removeEventListener('pagehide', onUnload)
  }, [])

  const value = useMemo<RobotContextValue>(
    () => ({ client, link, telemetry, health, connecting, error, connect, disconnect }),
    [client, link, telemetry, health, connecting, error, connect, disconnect],
  )

  return <RobotContext value={value}>{children}</RobotContext>
}

export function useRobot(): RobotContextValue {
  const value = use(RobotContext)
  if (!value) throw new Error('useRobot must be used inside RobotProvider')
  return value
}

/**
 * Where to reconnect on load, or null to show the picker.
 *
 * ONLY a robot this tab already connected to. Opening the console fresh always
 * lands on the picker — choosing the robot is the first thing an operator does,
 * and silently attaching to whichever machine served the page hides that
 * decision. The session entry exists so a reload mid-run does not drop the
 * link and make them choose again with the crawler still in the pipe.
 */
function autoConnectTarget(): string | null {
  try {
    const target = window.sessionStorage.getItem(LAST_ROBOT_KEY)
    // On the Vite dev server the origin is never a robot — index.html answers
    // every path. Reconnecting to '' there only produces a failed probe, so
    // fall through to the connect screen instead. (On the Pi, '' is the robot.)
    if (target === '' && window.location.port === '5173') return null
    return target
  } catch {
    return null
  }
}
