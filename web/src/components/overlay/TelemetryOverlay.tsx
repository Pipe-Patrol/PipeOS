import { Readout } from '@/components/primitives/Readout'
import * as format from '@/lib/format'
import { useTempUnit } from '@/lib/units'
import type { Telemetry } from '@/robot/types'

interface TelemetryOverlayProps {
  telemetry: Telemetry
}

/**
 * The readout, centred over the video with no panel behind it.
 *
 * Distance leads because it is the number an inspection is written in — every
 * defect is filed against a chainage. The host and link vitals live in the top
 * bar; this stays down to what an operator watches while driving.
 *
 * DISTANCE AND THE RUN CLOCK SHARE ONE CENTRE LINE. Air and humidity hang off
 * that line rather than sitting in it: they are conditions, not measurements of
 * the robot, and a three-up row centred as a group would drag the clock off
 * centre by half the difference between "18°C" and "94%" — a column that
 * shifts under the eye every time the humidity crosses ten percent. Positioned
 * absolutely so their width can never move what is behind them. They go blank,
 * not stale, when the sensor stops answering.
 *
 * Acceleration sits under the distance, sized to be read rather than squinted
 * at, because it is what says the robot is actually moving. It reads a clean 0
 * inside the sensor's noise floor (hardware/imu.py), so a still robot shows a
 * still number instead of jitter.
 */
export function TelemetryOverlay({ telemetry }: TelemetryOverlayProps) {
  const { motion, drive, climate } = telemetry
  const [unit] = useTempUnit()

  return (
    <div className="flex flex-col items-center gap-3">
      <Readout
        label="Distance"
        value={format.metres(motion.distance_travelled_m)}
        detail={format.acceleration(motion.accel_m_s2)}
        quality="estimated"
        size="lg"
        state={motion.slipping ? 'warn' : 'normal'}
      />

      <div className="relative flex justify-center">
        <Readout label="Run" value={format.duration(drive.run_seconds)} />

        <div className="absolute top-0 right-full mr-8">
          <Readout
            label="Air"
            value={format.temperature(climate.temperature_c, unit)}
            quality={climate.quality}
          />
        </div>

        <div className="absolute top-0 left-full ml-8">
          <Readout
            label="Humidity"
            value={format.percent(climate.humidity_pct)}
            quality={climate.quality}
          />
        </div>
      </div>
    </div>
  )
}
