import { useEffect, useState } from 'react'

/**
 * Weather over the entry point, for the one question it answers: how likely is
 * it that this pipe surges while the robot is inside it.
 *
 * ADVISORY ONLY. It never blocks a run and never feeds a check. Rain upstream
 * an hour ago matters more than the sky overhead, the forecast is for a grid
 * square rather than a catchment, and a crew who can see the weather knows more
 * than this does. It is here because a number that is usually right is worth
 * having next to the map, not because it is authoritative.
 *
 * Needs VITE_OPENWEATHER_KEY. Without one the hook reports `off` and the panel
 * shows nothing, which is the correct behaviour for a console that spends its
 * life on a network with no route to the internet.
 */

const KEY = import.meta.env.VITE_OPENWEATHER_KEY as string | undefined
const BASE = 'https://api.openweathermap.org/data/2.5'

/** Millimetres of rain in the next three hours that count as a raised risk. */
const RAIN_ELEVATED_MM = 2
const RAIN_HIGH_MM = 8

export type SurgeRisk = 'low' | 'elevated' | 'high'

export interface Weather {
  description: string
  temperature_c: number
  wind_m_s: number
  /** Rain in the last hour, millimetres. */
  rain_now_mm: number
  /** Rain forecast over the next three hours, millimetres. */
  rain_soon_mm: number
  risk: SurgeRisk
}

export type WeatherState =
  | { state: 'off' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; weather: Weather }

export function useWeather(lat: number | null, lon: number | null): WeatherState {
  // Keyed by the location it describes, so a result for the previous pin never
  // shows against the new one while the next request is still in flight.
  const [entry, setEntry] = useState<{ key: string; value: WeatherState } | null>(null)

  // Rounded before it reaches the dependency array: dragging the pin a metre is
  // the same weather, and refetching on every mouse-up would burn the quota.
  const key = lat != null && lon != null ? `${lat.toFixed(2)},${lon.toFixed(2)}` : null

  useEffect(() => {
    if (!KEY || !key) return

    const [latText, lonText] = key.split(',')
    const query = `lat=${latText}&lon=${lonText}&units=metric&appid=${KEY}`
    const controller = new AbortController()

    const load = async () => {
      try {
        const [nowResponse, forecastResponse] = await Promise.all([
          fetch(`${BASE}/weather?${query}`, { signal: controller.signal }),
          fetch(`${BASE}/forecast?${query}&cnt=1`, { signal: controller.signal }),
        ])
        if (!nowResponse.ok) throw new Error(`weather ${nowResponse.status}`)

        const now = await nowResponse.json()
        // The forecast is the softer of the two: current conditions alone still
        // answer the question, so a failure here costs a field, not the panel.
        const forecast = forecastResponse.ok ? await forecastResponse.json() : null

        const rainNow = Number(now?.rain?.['1h'] ?? 0)
        const rainSoon = Number(forecast?.list?.[0]?.rain?.['3h'] ?? 0)

        setEntry({
          key,
          value: {
            state: 'ready',
            weather: {
              description: String(now?.weather?.[0]?.description ?? 'unknown'),
              temperature_c: Number(now?.main?.temp ?? Number.NaN),
              wind_m_s: Number(now?.wind?.speed ?? Number.NaN),
              rain_now_mm: rainNow,
              rain_soon_mm: rainSoon,
              risk: risk(rainNow, rainSoon),
            },
          },
        })
      } catch (error) {
        if (controller.signal.aborted) return
        setEntry({
          key,
          value: {
            state: 'error',
            message:
              error instanceof Error ? error.message : 'could not reach the service',
          },
        })
      }
    }

    void load()
    return () => controller.abort()
  }, [key])

  if (!KEY) return { state: 'off' }
  if (!key || entry?.key !== key) return { state: 'loading' }
  return entry.value
}

export function risk(rainNowMm: number, rainSoonMm: number): SurgeRisk {
  const total = rainNowMm + rainSoonMm
  if (total >= RAIN_HIGH_MM) return 'high'
  if (total >= RAIN_ELEVATED_MM || rainNowMm > 0) return 'elevated'
  return 'low'
}
