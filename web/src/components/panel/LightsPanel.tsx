import { Popover } from '@/components/primitives/Popover'
import { Slider } from '@/components/primitives/Slider'
import type { LightsStatus } from '@/robot/types'

interface LightsPanelProps {
  lights: LightsStatus
  level: number
  onChange: (level: number) => void
  onClose: () => void
}

/**
 * The LED ring.
 *
 * The slider runs a full 0-100% even though the hardware is capped at half
 * duty — the cap is a property of the ring, not something an operator should
 * have to think in. lights.py owns the real ceiling and converts.
 */
export function LightsPanel({ lights, level, onChange, onClose }: LightsPanelProps) {
  return (
    <Popover title="Lights" onClose={onClose}>
      <Slider
        label="Brightness"
        value={level}
        display={`${Math.round(level * 100)}%`}
        onChange={onChange}
        disabled={!lights.available}
      />
    </Popover>
  )
}
