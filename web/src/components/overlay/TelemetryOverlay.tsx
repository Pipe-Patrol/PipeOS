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
 * vitals live in the top bar; this stays down to the two an operator watches
 * while driving.
 */
export function TelemetryOverlay({ telemetry }: TelemetryOverlayProps) {
  const { motion, drive } = telemetry

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

      <Readout label="Run" value={format.duration(drive.run_seconds)} />
    </div>
  )
}
