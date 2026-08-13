import { useEffect, useRef, useState } from 'react'

import type { ClimateReading } from '@/robot/types'

/**
 * Air that changed faster than air normally does.
 *
 * A sewer's air is slow. Temperature and humidity drift over metres, not
 * seconds, so a step change means something entered the pipe — a lateral, a
 * crack open to the surface, standing water, a gas pocket. That is worth a
 * flag, and it is the kind of thing an operator watching for cracks does not
 * notice, because the numbers are in the corner of the screen and moving
 * slowly is what they always do.
 *
 * WHY A ROLLING BASELINE AND NOT A THRESHOLD. There is no absolute temperature
 * that means anything: a pipe under a road in August and one under a field in
 * February are twenty degrees apart and both perfectly normal. What is not
 * normal is a jump away from what this pipe was reading a minute ago. So the
 * baseline is the pipe's own recent history and the alarm is the distance from
 * it.
 *
 * The baseline deliberately stops updating while a spike is live, or it would
 * chase the new value and cancel the alarm within a minute — the classic way
 * this kind of detector silently stops working.
 */

export type SpikeChannel = 'temperature' | 'humidity'

export interface Spike {
  channel: SpikeChannel
  /** What it reads now. */
  value: number
  /** What the pipe had settled at before it moved. */
  baseline: number
  /** Signed, in the channel's own unit — °C or percentage points. */
  delta: number
  /** When it was first noticed, epoch ms. */
  at: number
}

/** How much history the baseline is drawn from. */
const WINDOW_MS = 90_000

/** Below this many samples the baseline is not worth trusting yet. */
const MIN_SAMPLES = 10

/**
 * What counts as sudden, when the operator has not said.
 *
 * Set against the sensor rather than against comfort: the DHT22 is quoted at
 * ±0.5 °C and ±2% RH, so anything inside that is noise. These are several times
 * the noise floor, which is the level at which a jump is the pipe rather than
 * the part. Overridable from settings, because how quiet a pipe's air is
 * depends on the pipe.
 */
const THRESHOLD = { temperature: 2.5, humidity: 8 } as const

export interface SpikeOptions {
  temperature?: number
  humidity?: number
  /** False switches the detector off without unmounting it. */
  enabled?: boolean
}

/** Hold a spike on screen this long, so it cannot flicker in and out. */
const HOLD_MS = 20_000

interface Sample {
  at: number
  value: number
}

export interface ClimateSpikes {
  temperature: Spike | null
  humidity: Spike | null
  /** Either channel, worst first. Empty when the air is behaving. */
  active: Spike[]
  /** Forget the current spike and re-baseline on what it reads now. */
  dismiss: (channel: SpikeChannel) => void
}

export function useClimateSpikes(
  climate: ClimateReading | null,
  options: SpikeOptions = {},
): ClimateSpikes {
  // Read out as plain numbers rather than kept as an object, so the effect
  // below can depend on the two values instead of on a fresh object each render.
  const limitTemperature = options.temperature ?? THRESHOLD.temperature
  const limitHumidity = options.humidity ?? THRESHOLD.humidity
  const enabled = options.enabled ?? true

  const history = useRef<Record<SpikeChannel, Sample[]>>({
    temperature: [],
    humidity: [],
  })
  const [spikes, setSpikes] = useState<Record<SpikeChannel, Spike | null>>({
    temperature: null,
    humidity: null,
  })

  useEffect(() => {
    if (!enabled || !climate?.available) return
    const now = Date.now()

    const readings: Record<SpikeChannel, number | null> = {
      temperature: climate.temperature_c,
      humidity: climate.humidity_pct,
    }

    setSpikes((current) => {
      let next = current

      for (const channel of ['temperature', 'humidity'] as const) {
        const value = readings[channel]
        if (value === null || !Number.isFinite(value)) continue

        const samples = history.current[channel]
        const live = current[channel]

        // Expired spikes clear themselves, and the baseline restarts from here
        // — whatever the air did, this is what the pipe reads now.
        if (live && now - live.at > HOLD_MS) {
          history.current[channel] = [{ at: now, value }]
          next = next === current ? { ...current } : next
          next[channel] = null
          continue
        }

        if (live) continue

        const window = samples.filter((sample) => now - sample.at <= WINDOW_MS)
        window.push({ at: now, value })
        history.current[channel] = window

        if (window.length < MIN_SAMPLES) continue

        // The baseline excludes the sample being judged, so a single reading
        // cannot drag the thing it is being compared against.
        const past = window.slice(0, -1)
        const baseline = past.reduce((sum, s) => sum + s.value, 0) / past.length
        const delta = value - baseline

        const limit = channel === 'temperature' ? limitTemperature : limitHumidity
        if (Math.abs(delta) < limit) continue

        next = next === current ? { ...current } : next
        next[channel] = { channel, value, baseline, delta, at: now }
      }

      return next
    })
  }, [climate, enabled, limitTemperature, limitHumidity])

  const dismiss = (channel: SpikeChannel) => {
    history.current[channel] = []
    setSpikes((current) => (current[channel] ? { ...current, [channel]: null } : current))
  }

  const active = [spikes.temperature, spikes.humidity].filter(
    (spike): spike is Spike => spike !== null,
  )

  return { ...spikes, active, dismiss }
}

/** The spike as one line, for the notice bar and for a defect note. */
export function describeSpike(spike: Spike): string {
  const rising = spike.delta > 0
  const unit = spike.channel === 'temperature' ? '°C' : '%'
  const magnitude = Math.abs(spike.delta).toFixed(1)
  const name = spike.channel === 'temperature' ? 'Temperature' : 'Humidity'
  return `${name} ${rising ? 'up' : 'down'} ${magnitude}${unit} — now ${spike.value.toFixed(1)}${unit}`
}
