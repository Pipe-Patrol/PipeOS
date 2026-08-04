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
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 outline-none [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-text [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-text"
      />
    </label>
  )
}
