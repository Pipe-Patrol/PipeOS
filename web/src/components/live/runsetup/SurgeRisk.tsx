import * as format from '@/lib/format'
import { useTempUnit } from '@/lib/units'
import type { SurgeRisk as Risk, WeatherState } from '@/components/live/runsetup/useWeather'

const TONE: Record<Risk, string> = {
  low: 'text-ink-300',
  elevated: 'text-state-warning-signal',
  high: 'text-state-fault-signal',
}

const WORD: Record<Risk, string> = {
  low: 'Low',
  elevated: 'Elevated',
  high: 'High',
}

interface SurgeRiskProps {
  weather: WeatherState
  placed: boolean
}

/**
 * Surge risk over the entry point.
 *
 * Advisory, and said so: it never blocks a run. A crew standing at the manhole
 * can see the sky, and rain in the catchment upstream is what actually fills a
 * pipe — neither of which a grid-square forecast knows about. It earns its
 * three lines by catching the case where it has been raining somewhere the crew
 * has not been for the last hour.
 */
export function SurgeRisk({ weather, placed }: SurgeRiskProps) {
  const [unit] = useTempUnit()

  if (weather.state === 'off') return null

  return (
    <div className="mt-3 border-t border-ink-800 pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-100">Surge risk</span>
        <span className="text-[12px] tnum">
          {!placed ? (
            <span className="text-ink-500">Place the entry point first</span>
          ) : weather.state === 'loading' ? (
            <span className="text-ink-500">Checking</span>
          ) : weather.state === 'error' ? (
            <span className="text-ink-500">Unavailable</span>
          ) : (
            <span className={TONE[weather.weather.risk]}>
              {WORD[weather.weather.risk]}
            </span>
          )}
        </span>
      </div>

      {weather.state === 'ready' && placed && (
        <p className="mt-1.5 text-[11.5px] text-ink-400">
          {sentenceCase(weather.weather.description)} at{' '}
          {format.temperature(weather.weather.temperature_c, unit)}, with a wind of{' '}
          {Math.round(weather.weather.wind_m_s)} m/s. There has been{' '}
          {weather.weather.rain_now_mm.toFixed(1)} mm of rain in the last hour and{' '}
          {weather.weather.rain_soon_mm.toFixed(1)} mm is forecast over the next three.
          This is a guide only and it will never stop a run.
        </p>
      )}
    </div>
  )
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
