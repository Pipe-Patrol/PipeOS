import type { CSSProperties } from 'react'

/** The `slider` utility's fill, as a share of the track. Pair with `className="slider"`. */
export function sliderFill(value: number, min: number, max: number): CSSProperties {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  return { '--slider-fill': `${pct}%` } as CSSProperties
}

interface SliderProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  /** Rendered to the right of the label, e.g. `40%`. */
  display: string
  onChange: (value: number) => void
  disabled?: boolean
}

export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  display,
  onChange,
  disabled = false,
}: SliderProps) {
  return (
    <label className={`flex flex-col gap-2 ${disabled ? 'opacity-40' : ''}`}>
      <span className="flex items-baseline justify-between gap-4">
        <span className="label">{label}</span>
        <span className="text-[12px] tnum text-ink-400">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        style={sliderFill(value, min, max)}
        className="slider"
      />
    </label>
  )
}
