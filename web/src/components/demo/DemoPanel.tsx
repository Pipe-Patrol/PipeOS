import { useRef } from 'react'

import {
  addDemoSources,
  removeDemoSource,
  selectDemoSource,
  setDemoMode,
  setSecondsPerMetre,
  useDemoMode,
} from '@/lib/demoMode'

/**
 * The demo day controls: load footage, and switch between it.
 *
 * Bottom left, over the video, where the map normally sits — the map is the
 * least useful thing on screen when the robot is on a table.
 *
 * BUILT TO BE HANDED OVER. A judge is going to use this while somebody talks
 * over them, so the sources are big targets in a row rather than a dropdown,
 * and the arrow keys work from anywhere so the person presenting can switch
 * without reaching across.
 */
export function DemoPanel() {
  const { sources, activeId, secondsPerMetre } = useDemoMode()
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="panel w-[300px] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="display text-[12px] text-ink-0">Demo day</span>
        <button
          type="button"
          onClick={() => setDemoMode(false)}
          className="rounded-sm px-1.5 py-0.5 text-[11px] text-ink-500 transition-colors hover:bg-white/10 hover:text-ink-100"
        >
          Leave
        </button>
      </div>

      {sources.length === 0 ? (
        <p className="mb-2 text-[11.5px] leading-[15px] text-ink-400">
          Load pipe footage or stills. The model on the robot runs against them
          exactly as it would against the camera.
        </p>
      ) : (
        <ul className="mb-2 flex flex-col gap-1">
          {sources.map((source, index) => (
            <li key={source.id} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => selectDemoSource(source.id)}
                aria-pressed={source.id === activeId}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1 text-left text-[12px] transition-colors ${
                  source.id === activeId
                    ? 'bg-white/14 text-ink-0'
                    : 'text-ink-300 hover:bg-white/8'
                }`}
              >
                <span className="tnum shrink-0 text-[10px] text-ink-500">
                  {index + 1}
                </span>
                <span className="truncate">{source.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-ink-500 uppercase">
                  {source.kind}
                </span>
              </button>
              <button
                type="button"
                onClick={() => removeDemoSource(source.id)}
                aria-label={`Remove ${source.name}`}
                className="shrink-0 rounded-sm px-1.5 py-1 text-[11px] text-ink-600 transition-colors hover:bg-white/10 hover:text-ink-100"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="mb-2 w-full rounded-panel border border-dashed border-ink-700 py-1.5 text-[12px] text-ink-400 transition-colors hover:border-ink-500 hover:bg-white/6 hover:text-ink-100"
      >
        Add videos or images
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="video/*,image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) addDemoSources(event.target.files)
          // Cleared so choosing the same file twice still fires a change.
          event.target.value = ''
        }}
      />

      <label className="flex items-center justify-between gap-3">
        <span className="label">Pace</span>
        <input
          type="range"
          min={0.25}
          max={8}
          step={0.25}
          value={secondsPerMetre}
          onChange={(event) => setSecondsPerMetre(Number(event.target.value))}
          className="slider flex-1"
          style={
            { '--slider-fill': `${((secondsPerMetre - 0.25) / 7.75) * 100}%` } as never
          }
          aria-label="Seconds of footage per metre driven"
        />
        <span className="tnum w-[46px] shrink-0 text-right text-[11px] text-ink-300">
          {secondsPerMetre.toFixed(2)} s/m
        </span>
      </label>

      <p className="mt-2 text-[11px] text-ink-500">
        ← → switches · the video follows the throttle
      </p>
    </div>
  )
}
