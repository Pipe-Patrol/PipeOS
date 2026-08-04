import { Readout } from '@/components/primitives/Readout'
import * as format from '@/lib/format'
import type { Telemetry } from '@/robot/types'

interface TelemetryOverlayProps {
  telemetry: Telemetry
}

/**
 * The readout, centred over the video with no panel behind it.
 *
 * Distance leads because it is the number an inspection is written in — every
 * defect is filed against a chainage, and every one of them here is an
 * estimate, which is why the ± is not optional decoration. The host and link
 * vitals live in the top bar; this stays down to what an operator watches while
 * driving.
 *
 * Air temperature and humidity flank the run clock. They are conditions rather
 * than measurements of the robot, so they sit either side of it rather than
 * above: readable at a glance for the whole run without opening a panel, and
 * without competing with the distance the inspection is written in. They go
 * blank, not stale, when the sensor stops answering.
 */
export function TelemetryOverlay({ telemetry }: TelemetryOverlayProps) {
  const { motion, drive, climate } = telemetry

  return (
    <div className="flex flex-col items-center gap-3">
      <Readout
        label="Distance"
        value={format.metresWithError(
          motion.distance_travelled_m,
          motion.uncertainty_m,
        )}
        detail={format.acceleration(motion.accel_m_s2)}
        quality="estimated"
        size="lg"
        state={motion.slipping ? 'warn' : 'normal'}
      />

      <div className="flex items-start justify-center gap-7">
        <Readout
          label="Air"
          value={format.celsius(climate.temperature_c)}
          quality={climate.quality}
        />
        <Readout label="Run" value={format.duration(drive.run_seconds)} />
        <Readout
          label="Humidity"
          value={format.percent(climate.humidity_pct)}
          quality={climate.quality}
        />
      </div>
    </div>
  )
}
