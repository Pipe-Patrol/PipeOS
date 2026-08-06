import { useState } from 'react'

import { Button } from '@/components/primitives/Button'
import { compassPoint, normaliseBearing } from '@/components/map/geo'
import { readError } from '@/lib/errors'
import type { RobotClient } from '@/robot/client'
import type { Orientation } from '@/robot/types'

interface NorthReferenceProps {
  client: RobotClient
  orientation: Orientation | null
}

/**
 * Teaching the robot which way north is.
 *
 * The IMU runs on the game rotation vector, which skips the magnetometer —
 * deliberately, because the motor wiring corrupts one. What is left measures
 * TURNING perfectly well and knows nothing about DIRECTION: its yaw counts from
 * wherever the sensor happened to be when it powered on. Nothing on the robot
 * can close that gap, so a person does: point the chassis at something whose
 * bearing is known, say what it is, and every later heading is absolute.
 *
 * Once set, the map trace comes out pointing the right way without the operator
 * having to work out an entry bearing per run — the robot fills that in from
 * its own heading at the moment the run starts.
 *
 * THE REFERENCE DIES WITH THE SENSOR SESSION. A wedged I2C bus makes the IMU
 * reconnect on its own, and yaw restarts from a new zero when it does, which
 * makes the old datum meaningless. That is reported as stale and the heading
 * goes back to blank, because a compass wrong by an unknown amount is worse
 * than no compass.
 */
export function NorthReference({ client, orientation }: NorthReferenceProps) {
  const [facing, setFacing] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const noSensor = !orientation || orientation.state === 'absent'
  const heading = orientation?.heading_deg ?? null

  const set = async () => {
    setBusy(true)
    setError(null)
    try {
      await client.request('/api/north', {
        method: 'POST',
        body: JSON.stringify({ facing_deg: normaliseBearing(Number(facing) || 0) }),
      })
    } catch (caught) {
      setError(readError(caught, 'could not set north'))
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    setError(null)
    try {
      await client.request('/api/north', { method: 'DELETE' })
    } catch (caught) {
      setError(readError(caught, 'could not clear it'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel p-4">
      <h2 className="label mb-3">North</h2>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="label">Heading now</div>
          <div className="mt-1 text-[20px] tnum">
            {heading === null ? (
              <span className="text-ink-500">—</span>
            ) : (
              <>
                {Math.round(heading)}°{' '}
                <span className="text-[13px] text-ink-400">
                  {compassPoint(heading)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="label">Robot is facing</span>
            <input
              value={facing}
              inputMode="decimal"
              onChange={(event) => setFacing(event.target.value)}
              aria-label="Bearing the robot is currently facing, in degrees"
              className="h-9 w-20 rounded-panel border border-ink-800 bg-white/5 px-2 text-[13px] tnum text-ink-100 focus:border-white/35 focus:outline-none"
            />
          </label>
          <Button onClick={() => void set()} disabled={busy || noSensor}>
            Set
          </Button>
          {orientation?.north_set && (
            <Button variant="quiet" onClick={() => void clear()} disabled={busy}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <p className="mt-3 text-[12px] text-ink-400">
        {noSensor
          ? 'No IMU fitted — there is no yaw to anchor a bearing to.'
          : orientation?.north_stale
            ? 'The IMU restarted, so the old reference no longer means anything. Set it again.'
            : orientation?.north_set
              ? 'Headings are compass bearings. New runs take their entry bearing from this.'
              : 'Point the robot at a known bearing — 0 for north — and press Set. Until then the map draws every run as though it entered heading north.'}
      </p>

      {error && <p className="mt-2 text-[12px] text-state-fault-signal">{error}</p>}
    </section>
  )
}
