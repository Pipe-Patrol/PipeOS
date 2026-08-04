import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  candidates,
  forget,
  probe,
  remember,
  saveDevice,
  saved,
} from '@/robot/discovery'
import type { Health } from '@/robot/types'

const HEALTH: Health = {
  service: 'pipepatrol',
  version: '1.0.0',
  hostname: 'pipepatrol',
  capabilities: {
    motors: true,
    camera: true,
    lights: true,
    imu: true,
    optical_flow: true,
    detector: false,
  },
  unavailable: ['battery', 'motor_current'],
  active_run_id: null,
}

function respondWith(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Server Error',
    json: async () => body,
  })
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('probe', () => {
  it('accepts a robot', async () => {
    vi.stubGlobal('fetch', respondWith(HEALTH))
    await expect(probe('http://robot:8000')).resolves.toEqual(HEALTH)
  })

  it('rejects anything that answers but is not a robot', async () => {
    // A dev server that returns index.html for every path would otherwise look
    // reachable. Identity is checked, not just a 200.
    vi.stubGlobal('fetch', respondWith({ hello: 'world' }))
    await expect(probe('http://not-a-robot')).rejects.toThrow('not a PipePatrol robot')
  })

  it('rejects a 200 whose body is HTML, not JSON', async () => {
    // The Vite dev server answers /api/health with index.html and a 200. That
    // must read as "not a robot", not leak a raw "Unexpected token '<'".
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          throw new SyntaxError("Unexpected token '<'")
        },
      }),
    )
    await expect(probe('http://localhost:5173')).rejects.toThrow('not a PipePatrol robot')
  })

  it('rejects a non-2xx', async () => {
    vi.stubGlobal('fetch', respondWith(HEALTH, false))
    await expect(probe('http://robot:8000')).rejects.toThrow()
  })
})

describe('remembered robots', () => {
  it('stores a robot under the hostname it reported', () => {
    remember('http://192.168.4.1:8000', HEALTH)
    expect(saved()).toEqual([
      expect.objectContaining({
        baseUrl: 'http://192.168.4.1:8000',
        label: 'pipepatrol',
      }),
    ])
  })

  it('keeps the name the operator set, over the robot hostname', () => {
    // Setting a device up names it on purpose; connecting must not rename it to
    // whatever the robot happens to call itself.
    saveDevice('192.168.4.1:8000', 'Basement crawler')
    remember('http://192.168.4.1:8000', HEALTH)
    expect(saved()[0].label).toBe('Basement crawler')
  })

  it('falls back to the address when the robot has no hostname', () => {
    remember('http://192.168.4.1:8000', { ...HEALTH, hostname: null })
    expect(saved()[0].label).toBe('192.168.4.1:8000')
  })

  it('never remembers the origin', () => {
    // Wherever the console happened to be served from is a different address on
    // the next device, so pinning it would offer a dead row forever.
    remember('', HEALTH)
    expect(saved()).toEqual([])
  })

  it('does not duplicate a robot reconnected to', () => {
    remember('http://robot:8000', HEALTH)
    remember('http://robot:8000', HEALTH)
    expect(saved()).toHaveLength(1)
  })

  it('forgets on request', () => {
    remember('http://robot:8000', HEALTH)
    forget('http://robot:8000')
    expect(saved()).toEqual([])
  })

  it('survives corrupt storage', () => {
    window.localStorage.setItem('pipepatrol.robots', 'not json')
    expect(saved()).toEqual([])
  })
})

describe('candidates', () => {
  it('does not offer pipepatrol.local by default', () => {
    // The mDNS guess row was noise on a network that never resolves it; devices
    // are set up by hand now.
    const found = candidates()
    expect(found.some((c) => c.baseUrl === 'http://pipepatrol.local:8000')).toBe(
      false,
    )
  })

  it('includes saved robots', () => {
    remember('http://192.168.4.1:8000', HEALTH)
    expect(candidates().some((c) => c.baseUrl === 'http://192.168.4.1:8000')).toBe(true)
  })

  it('offers a device set up by hand', () => {
    saveDevice('192.168.4.1:8000', 'Basement crawler')
    const found = candidates()
    expect(
      found.some(
        (c) =>
          c.baseUrl === 'http://192.168.4.1:8000' &&
          c.label === 'Basement crawler',
      ),
    ).toBe(true)
  })

  it('does not offer the same address twice', () => {
    remember('http://192.168.4.1:8000', HEALTH)
    saveDevice('192.168.4.1:8000', 'Basement crawler')
    const urls = candidates().map((c) => c.baseUrl)
    expect(new Set(urls).size).toBe(urls.length)
  })
})
