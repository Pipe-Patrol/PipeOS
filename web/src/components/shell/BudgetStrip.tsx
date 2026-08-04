import * as format from '@/lib/format'
import type { Motion, Power } from '@/robot/types'

interface BudgetStripProps {
  power: Power
  motion: Motion
}

/**
 * The power budget as one full-bleed bar.
 *
 * In PipePatrolApp this was three bands — used, free to spend, reserved to get
 * home — squeezed from both sides as a run goes on. That arithmetic needs a
 * charge reading and a distance reading, and there is no voltage sensor on the
 * pack, so two thirds of it cannot be computed.
 *
 * Rather than draw a gauge from a guess, the bar keeps its geometry and states
 * what it actually knows: how far out the robot is. When an INA260 lands
 * (docs/HARDWARE.md) the bands come back and this becomes the original.
 *
 * Edge to edge with no inset, because this is one reading that should never
 * look like a component sitting on a page.
 */
export function BudgetStrip({ power, motion }: BudgetStripProps) {
  const charged = power.battery.available

  return (
    <div className="flex h-[20px] shrink-0 items-center justify-between border-b border-ink-800 bg-ink-800 px-3">
      <span className="flex items-center gap-2">
        <span className="text-[10.5px] font-medium text-ink-400">Charge</span>
        <span className="tnum text-[11px] font-semibold text-ink-500">
          {charged ? format.percent(power.battery.percent) : 'no sensor'}
        </span>
      </span>

      <span className="flex items-center gap-2">
        <span className="text-[10.5px] font-medium text-ink-400">Out</span>
        <span className="tnum text-[11px] font-semibold text-ink-200">
          {format.metresWithError(Math.abs(motion.chainage_m), motion.uncertainty_m)}
        </span>
      </span>
    </div>
  )
}
