import { Popover } from '@/components/primitives/Popover'
import { Slider } from '@/components/primitives/Slider'
import type { CameraStatus } from '@/robot/types'

interface TuningPanelProps {
  camera: CameraStatus
  onChange: (patch: {
    brightness?: number
    contrast?: number
    dehaze?: boolean
  }) => void
  onClose: () => void
}

/**
 * Image adjustments.
 *
 * Brightness and contrast are pushed down to the sensor, so they are free.
 * Dehaze cannot be — it is a pixel operation, so enabling it starts a worker
 * that decodes, equalises and re-encodes every frame. That is why it is off by
 * default and why the frame rate drops while it is on.
 */
export function TuningPanel({ camera, onChange, onClose }: TuningPanelProps) {
  const { tuning, available } = camera

  return (
    <Popover title="Image" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Slider
          label="Brightness"
          value={tuning.brightness}
          min={-1}
          max={1}
          step={0.05}
          display={signed(tuning.brightness)}
          onChange={(brightness) => onChange({ brightness })}
          disabled={!available}
        />
        <Slider
          label="Contrast"
          value={tuning.contrast}
          min={-1}
          max={1}
          step={0.05}
          display={signed(tuning.contrast)}
          onChange={(contrast) => onChange({ contrast })}
          disabled={!available}
        />

        <label
          className={`flex items-center gap-2 text-[12px] text-ink-400 ${
            available ? '' : 'opacity-40'
          }`}
        >
          <input
            type="checkbox"
            checked={tuning.dehaze}
            disabled={!available}
            onChange={(event) => onChange({ dehaze: event.target.checked })}
            className="accent-white"
          />
          Dehaze
        </label>

        <button
          type="button"
          onClick={() => onChange({ brightness: 0, contrast: 0, dehaze: false })}
          className="self-start rounded-sm border border-ink-800 px-2 py-1 text-[11px] text-ink-400 hover:bg-white/10 hover:text-ink-100"
        >
          Reset
        </button>
      </div>
    </Popover>
  )
}

function signed(value: number): string {
  if (Math.abs(value) < 0.005) return '0'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}
