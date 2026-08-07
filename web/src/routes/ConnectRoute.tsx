import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/primitives/Button'
import { RobotIcon } from '@/components/primitives/icons'
import { normaliseBaseUrl } from '@/robot/client'
import { useRobot } from '@/robot/RobotProvider'
import { probe, saveDevice, saved } from '@/robot/discovery'
import type { Health } from '@/robot/types'

/**
 * Confirming the one robot, then driving it.
 *
 * There is almost always a single robot: the console is served from the Pi, so
 * the Pi is the page's own origin. This screen is not a chooser — it shows that
 * one device, lets the operator name it and check the address, and continues.
 * The address is editable for the development case, where the console runs on a
 * laptop and has to be pointed at a Pi across the network.
 */
type ProbeStatus = 'idle' | 'probing' | 'ok' | 'fail'

export function ConnectRoute() {
  const navigate = useNavigate()
  const { connect, connecting, error, client, disconnect } = useRobot()

  const [name, setName] = useState(() => defaultName())
  const [address, setAddress] = useState(() => defaultAddress())
  const [status, setStatus] = useState<ProbeStatus>('idle')
  const [health, setHealth] = useState<Health | null>(null)

  const check = useCallback(async (value: string) => {
    const addr = value.trim()
    if (!addr) {
      setStatus('idle')
      setHealth(null)
      return
    }
    setStatus('probing')
    try {
      const found = await probe(addr)
      setHealth(found)
      setStatus('ok')
      // Offer the robot's own hostname as the name, but never overwrite one the
      // operator has already typed.
      setName((current) => current.trim() || found.hostname || '')
    } catch {
      setHealth(null)
      setStatus('fail')
    }
  }, [])

  // Probe whatever is in the address field, debounced, so the status line
  // reflects what the operator sees before they commit. Also covers mount.
  useEffect(() => {
    if (!address.trim()) return
    const timer = setTimeout(() => void check(address), 250)
    return () => clearTimeout(timer)
  }, [address, check])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const addr = address.trim()
    if (!addr) return
    saveDevice(addr, name)
    try {
      await connect(addr)
      navigate('/live')
    } catch {
      // The provider holds the message; it is rendered below.
    }
  }

  return (
    <main className="mx-auto flex min-h-full w-[min(460px,92vw)] flex-col justify-center gap-6 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="display text-[22px]">Welcome to PipeOS</h1>
        <p className="text-[12px] text-ink-500">{subtext(status, address)}</p>
      </div>

      <form onSubmit={submit} className="panel flex flex-col gap-4 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <RobotIcon
            size={22}
            className={
              status === 'ok' ? 'text-state-recording-signal' : 'text-ink-500'
            }
          />
          <StatusLine status={status} health={health} address={address} />
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-500">Device name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Basement crawler"
            className="h-9 rounded-panel border border-ink-800 bg-white/5 px-3 text-[13px] text-ink-100 placeholder:text-ink-500 focus:border-white/35 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-500">Address</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="pipepatrol.local:8000"
            aria-label="Robot address"
            className="h-9 rounded-panel border border-ink-800 bg-white/5 px-3 text-[13px] text-ink-100 placeholder:text-ink-500 focus:border-white/35 focus:outline-none"
          />
        </label>

        <Button type="submit" disabled={connecting || !address.trim()}>
          {connecting ? 'Connecting…' : 'Continue'}
        </Button>
      </form>

      {error && <p className="text-[12px] text-state-fault-signal">{error}</p>}

      {client && (
        <button
          type="button"
          onClick={disconnect}
          className="self-start text-[12px] text-ink-500 underline underline-offset-2 hover:text-ink-100"
        >
          Disconnect current robot
        </button>
      )}
    </main>
  )
}

function StatusLine({
  status,
  health,
  address,
}: {
  status: ProbeStatus
  health: Health | null
  address: string
}) {
  if (!address.trim()) {
    return <span className="text-[12px] text-ink-500">No address yet</span>
  }
  if (status === 'probing' || status === 'idle') {
    return <span className="text-[12px] text-ink-500">Checking…</span>
  }
  if (status === 'ok') {
    return (
      <span className="text-[12px] text-ink-100">
        Reachable
        {health?.hostname ? (
          <span className="text-ink-500"> — {health.hostname}</span>
        ) : null}
      </span>
    )
  }
  return (
    <span className="text-[12px] text-state-fault-signal">
      Can’t reach this address
    </span>
  )
}

function subtext(status: ProbeStatus, address: string): string {
  if (!address.trim()) return 'Enter your robot’s address to continue.'
  if (status === 'fail') return 'Can’t reach that address. Check it and try again.'
  return 'Confirm your robot, then continue.'
}

/** The address to confirm on open. */
function defaultAddress(): string {
  // Served from a robot: that robot's own address, ready to confirm. On the
  // Vite dev server the origin is never a robot, so fall back to the last
  // device set up here.
  if (window.location.port !== '5173') return window.location.host
  return saved()[0]?.baseUrl.replace(/^https?:\/\//i, '') ?? ''
}

/** The name last given to whatever address we are about to confirm. */
function defaultName(): string {
  const address = defaultAddress()
  if (!address) return ''
  const match = saved().find(
    (robot) => robot.baseUrl === normaliseBaseUrl(address),
  )
  return match?.label ?? ''
}
