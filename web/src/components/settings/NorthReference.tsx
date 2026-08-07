import { useState } from 'react'

import { Button } from '@/components/primitives/Button'
import { SettingRow } from '@/components/live/runsetup/SettingRow'
import { compassPoint, normaliseBearing } from '@/components/map/geo'
import { readError } from '@/lib/errors'
import type { RobotClient } from '@/robot/client'
import type { Orientation } from '@/robot/types'

interface NorthReferenceProps {
  client: RobotClient
  orientation: Orientation | null
  /** The heading above the control. Rendered here so the hint can sit beside it. */
  title?: string
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
 *
 * This lives in two places: Settings, where it is a property of the robot, and
 * the run setup panel, where it is the thing standing between the operator and
 * a track drawn in the wrong direction. Same control, one implementation.
 */
export function NorthControl({
  client,
  orientation,
  title = 'North reference',
}: NorthReferenceProps) {
  const [facing, setFacing] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const noSensor = !orientation || orientation.state === 'absent'
  const heading = orientation?.heading_deg ?? null

  const instructions = noSensor
    ? 'There is no IMU fitted, so the robot has no sense of which way it is turning and a bearing cannot be anchored to anything.'
    : orientation?.north_stale
      ? 'The IMU has restarted, which means the reference you set earlier no longer lines up with anything. Point the robot north again and press Set.'
      : orientation?.north_set
        ? 'Every heading shown is now a compass bearing, and this run will take the direction it went in from the reading above.'
        : 'Point the robot north and press Set, or type in the bearing it is facing if you already know it. Without a north reference the track cannot be placed on a map.'

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
    <div className="flex flex-col gap-2.5">
      <SettingRow
        label={title}
        info={instructions}
        hint={
          noSensor
            ? undefined
            : orientation?.north_stale
              ? 'The IMU has restarted, so this needs setting again'
              : orientation?.north_set
                ? undefined
                : 'Not set, so this run will have no map behind its track'
        }
      >
        <span
          className={`text-[12px] tnum ${
            heading === null ? 'text-ink-500' : 'text-ink-200'
          }`}
        >
          {heading === null
            ? 'Not set'
            : `${Math.round(heading)}° ${compassPoint(heading)}`}
        </span>
      </SettingRow>

      <SettingRow label="Robot is facing">
        <input
          value={facing}
          inputMode="decimal"
          onChange={(event) => setFacing(event.target.value)}
          aria-label="Bearing the robot is currently facing, in degrees"
          className="h-8 w-16 rounded-panel border border-ink-800 bg-white/5 px-2 text-[12px] tnum text-ink-100 focus:border-white/35 focus:outline-none"
        />
        <Button
          onClick={() => void set()}
          disabled={busy || noSensor}
          className="h-8 px-3 text-[12px]"
        >
          Set
        </Button>
        {orientation?.north_set && (
          <Button
            variant="quiet"
            onClick={() => void clear()}
            disabled={busy}
            className="h-8 px-2 text-[12px]"
          >
            Clear
          </Button>
        )}
      </SettingRow>

      {error && <p className="text-[11.5px] text-state-fault-signal">{error}</p>}
    </div>
  )
}

/** The Settings card. The control above, in the panel the rest of that page uses. */
export function NorthReference(props: NorthReferenceProps) {
  return (
    <section className="panel p-4">
      <NorthControl {...props} title="North" />
    </section>
  )
}
