import { SettingRow } from '@/components/live/runsetup/SettingRow'
import { sliderFill } from '@/components/primitives/Slider'
import { DEFECT_GROUPS, DEFECT_TYPES } from '@/constants/defects'

/**
 * ============================================================================
 *  NOT WIRED TO ANYTHING YET
 * ============================================================================
 *
 * The detection settings, built against the model that has not landed. Every
 * control here is real UI over a draft object that the console keeps to itself:
 * `POST /api/runs` ignores it, and the robot's detector reads none of it.
 *
 * It is here so the shape of the decision is settled before the model forces
 * one, and so an operator sees the same panel the day it starts working.
 *
 * See docs/DETECTION-SETTINGS.md for what has to change when the model ships.
 */

export type RunMode = 'manual' | 'assisted'

export interface DetectionDraft {
  enabled: boolean
  mode: RunMode
  /** Run inference on one frame in every N. 1 is every frame. */
  sampleEveryNFrames: number
  /** Minimum confidence, 0..1, below which a detection is discarded. */
  minConfidence: number
  /** Defect codes the model is allowed to raise. Empty means none. */
  classes: string[]
}

export const DEFAULT_DETECTION: DetectionDraft = {
  enabled: true,
  mode: 'assisted',
  sampleEveryNFrames: 5,
  minConfidence: 0.5,
  classes: DEFECT_TYPES.map((type) => type.code),
}

const SAMPLE_OPTIONS = [1, 2, 5, 10, 30]

const MODES: { value: RunMode; label: string; detail: string }[] = [
  {
    value: 'manual',
    label: 'Manual',
    detail: 'The operator will move the robot and flag defects manually.',
  },
  {
    value: 'assisted',
    label: 'Assisted',
    detail: 'The robot will move, return, and flag defects on its own.',
  },
]

interface DetectionSettingsProps {
  value: DetectionDraft
  onChange: (next: DetectionDraft) => void
}

export function DetectionSettings({ value, onChange }: DetectionSettingsProps) {
  const set = <K extends keyof DetectionDraft>(key: K, next: DetectionDraft[K]) => {
    onChange({ ...value, [key]: next })
  }

  const toggleClass = (code: string) => {
    const has = value.classes.includes(code)
    set(
      'classes',
      has ? value.classes.filter((c) => c !== code) : [...value.classes, code],
    )
  }

  const toggleGroup = (group: string) => {
    const codes = DEFECT_TYPES.filter((type) => type.group === group).map((t) => t.code)
    const allOn = codes.every((code) => value.classes.includes(code))
    set(
      'classes',
      allOn
        ? value.classes.filter((code) => !codes.includes(code))
        : [...new Set([...value.classes, ...codes])],
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingRow label="Detection" hint="Run the model over the video feed for the duration of this run.">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => set('enabled', event.target.checked)}
          className="accent-white"
        />
      </SettingRow>

      {value.enabled && (
        <div className="flex flex-col gap-4">
          <SettingRow
            label="Mode"
            hint={MODES.find((mode) => mode.value === value.mode)?.detail}
            stack
          >
            <div className="flex gap-1.5">
              {MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  aria-pressed={value.mode === mode.value}
                  onClick={() => set('mode', mode.value)}
                  className={`h-8 flex-1 rounded-panel border text-[12px] transition-colors ${
                    value.mode === mode.value
                      ? 'border-white/20 bg-white/12 text-ink-0'
                      : 'border-ink-800 text-ink-400 hover:bg-white/6 hover:text-ink-100'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            label="Sample"
            info="How often the model looks at the feed. Checking every frame is the most thorough, but it also works the processor hardest, so one frame in five is usually enough to keep up with the robot."
          >
            <div className="flex gap-1">
              {SAMPLE_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={value.sampleEveryNFrames === n}
                  onClick={() => set('sampleEveryNFrames', n)}
                  className={`h-7 w-9 rounded-[6px] text-[12px] tnum transition-colors ${
                    value.sampleEveryNFrames === n
                      ? 'bg-white/16 text-ink-0'
                      : 'text-ink-400 hover:bg-white/8 hover:text-ink-100'
                  }`}
                >
                  {n === 1 ? 'All' : `1:${n}`}
                </button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            label="Confidence"
            info="Anything the model is less certain of than this is ignored. Lowering it will catch more genuine defects, but it will also flag more things that turn out to be nothing."
          >
            <input
              type="range"
              min={0.1}
              max={0.9}
              step={0.05}
              value={value.minConfidence}
              onChange={(event) => set('minConfidence', Number(event.target.value))}
              aria-label="Minimum confidence"
              style={sliderFill(value.minConfidence, 0.1, 0.9)}
              className="slider w-28"
            />
            <span className="w-8 text-right text-[12px] tnum text-ink-200">
              {Math.round(value.minConfidence * 100)}%
            </span>
          </SettingRow>

          <SettingRow
            label="Classes"
            hint={`${value.classes.length} of ${DEFECT_TYPES.length} selected`}
            stack
          >
            <div className="flex flex-col gap-2.5">
              {DEFECT_GROUPS.map((group) => (
                <div key={group}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group)}
                    className="text-[11.5px] text-ink-500 underline underline-offset-2 hover:text-ink-100"
                  >
                    {group}
                  </button>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {DEFECT_TYPES.filter((type) => type.group === group).map((type) => {
                      const on = value.classes.includes(type.code)
                      return (
                        <button
                          key={type.code}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleClass(type.code)}
                          className={`h-7 rounded-[6px] border px-2 text-[11.5px] transition-colors ${
                            on
                              ? 'border-white/20 bg-white/12 text-ink-100'
                              : 'border-ink-800 text-ink-600 hover:text-ink-300'
                          }`}
                        >
                          {type.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </SettingRow>
        </div>
      )}
    </div>
  )
}
