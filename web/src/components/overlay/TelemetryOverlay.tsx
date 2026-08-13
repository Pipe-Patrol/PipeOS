import { Readout } from '@/components/primitives/Readout'
import * as format from '@/lib/format'
import { useTempUnit } from '@/lib/units'
import type { Telemetry } from '@/robot/types'

interface TelemetryOverlayProps {
  telemetry: Telemetry
  /**
   * Channels whose reading has just jumped. Those go red — the numbers are in
   * the corner of the eye and drifting slowly is what they always do, so a step
   * change has to announce itself where the operator is already looking.
   */
  spiking?: { temperature: boolean; humidity: boolean }
}

/**
 * The readout, centred over the video with no panel behind it.
 *
 * Distance leads because it is the number an inspection is written in — every
 * defect is filed against a chainage. The host and link vitals live in the top
 * bar; this stays down to what an operator watches while driving.
 *
 * IT IS DISTANCE FROM THE ENTRY POINT, NOT THE ODOMETER. Those are the same
 * number only until the robot first reverses, and after that the odometer keeps
 * counting while the robot comes back towards the operator — so a run that had
 * gone in and out twice read "80 m" while sitting 20 m from the manhole. Every
 * defect on this run is filed against chainage, the return budget is priced off
 * chainage, and the map's H is drawn at chainage zero; the biggest number on
 * the glass had no business being the one quantity that disagreed with them.
 *
 * DISTANCE AND THE RUN CLOCK SHARE ONE CENTRE LINE. Air and humidity hang off
 * that line rather than sitting in it: they are conditions, not measurements of
 * the robot, and a three-up row centred as a group would drag the clock off
 * centre by half the difference between "18°C" and "94%" — a column that
 * shifts under the eye every time the humidity crosses ten percent. Positioned
 * absolutely so their width can never move what is behind them. They go blank,
 * not stale, when the sensor stops answering.
 *
 * Speed sits under the distance, sized to be read rather than squinted at,
 * because it is what says the robot is actually moving. It is the same
 * measurement the distance is accumulated from — optical flow, and nothing else
 * — so the two can never tell different stories, which is exactly what the old
 * acceleration readout beside a duty-fused distance could do.
 *
 * The distance goes amber when the camera has stopped supporting it. A blind
 * estimator does not slow down, it stops counting, and a number that has quietly
 * stopped counting looks identical to a robot holding station.
 */
export function TelemetryOverlay({
  telemetry,
  spiking = { temperature: false, humidity: false },
}: TelemetryOverlayProps) {
  const { motion, drive, climate } = telemetry
  const [unit] = useTempUnit()

  return (
    <div className="flex flex-col items-center gap-3">
      <Readout
        label="Distance"
        value={format.metres(Math.abs(motion.chainage_m))}
        detail={format.speed(motion.speed_m_s)}
        quality="estimated"
        size="lg"
        state={motion.blind ? 'warn' : 'normal'}
      />

      <div className="relative flex justify-center">
        <Readout label="Run" value={format.duration(drive.run_seconds)} />

        <div className="absolute top-0 right-full mr-8">
          <Readout
            label="Air"
            value={format.temperature(climate.temperature_c, unit)}
            quality={climate.quality}
            state={spiking.temperature ? 'bad' : 'normal'}
          />
        </div>

        <div className="absolute top-0 left-full ml-8">
          <Readout
            label="Humidity"
            value={format.percent(climate.humidity_pct)}
            quality={climate.quality}
            state={spiking.humidity ? 'bad' : 'normal'}
          />
        </div>
      </div>
    </div>
  )
}
