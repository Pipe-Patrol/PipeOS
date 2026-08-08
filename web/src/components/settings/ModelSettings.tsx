import { Range, Row, Section, Toggle } from '@/components/settings/controls'
import { DETECTION_CLASSES } from '@/constants/detection-classes'
import {
  resetDetectionColors,
  setDetectionColor,
  useDetectionColors,
} from '@/lib/detectionColors'
import {
  setPreference,
  toggleMutedClass,
  usePreferences,
} from '@/lib/preferences'

/**
 * What the model reports, and how much of it reaches the screen.
 *
 * The class table is the part that matters. Every one of the seven can be given
 * its own colour and switched off entirely, because which of them are worth
 * seeing is a property of the job rather than of the model: a survey looking
 * for structural failure does not want the whole run boxed in orange because
 * the pipe has silt in it, and the honest way to say that is to mute the class
 * rather than to raise the threshold until it happens to disappear.
 *
 * MUTING HIDES, IT DOES NOT DISABLE. The model still runs and still reports;
 * this is the console deciding what to draw. Nothing here can make a defect go
 * unrecorded, which is the property that lets an operator turn things off
 * without having to think about whether they are damaging the survey.
 */
export function ModelSettings() {
  const prefs = usePreferences()
  const overrides = useDetectionColors()

  return (
    <Section
      title="Detection model"
      description="RF-DETR, seven classes. See MODEL.md."
      actions={
        <button
          type="button"
          onClick={resetDetectionColors}
          className="rounded-sm px-2 py-1 text-[11.5px] text-ink-400 transition-colors hover:bg-white/8 hover:text-ink-100"
        >
          Reset colours
        </button>
      }
    >
      <Row label="Draw detections" hint="Boxes over the video as the model finds them">
        <Toggle
          label="Draw detections"
          checked={prefs.showDetections}
          onChange={(next) => setPreference('showDetections', next)}
        />
      </Row>

      <Row
        label="Confidence floor"
        hint="Anything the model is less sure of than this is not drawn"
      >
        <Range
          label="Confidence floor"
          value={prefs.detectionThreshold}
          min={0}
          max={0.95}
          step={0.05}
          display={`${Math.round(prefs.detectionThreshold * 100)}%`}
          onChange={(next) => setPreference('detectionThreshold', next)}
        />
      </Row>

      <Row label="Class labels" hint="The name tag on each box">
        <Toggle
          label="Class labels"
          checked={prefs.showDetectionLabels}
          onChange={(next) => setPreference('showDetectionLabels', next)}
        />
      </Row>

      <Row label="Confidence on the box" hint="The percentage beside the label">
        <Toggle
          label="Confidence on the box"
          checked={prefs.showDetectionConfidence}
          onChange={(next) => setPreference('showDetectionConfidence', next)}
        />
      </Row>

      <div className="px-4 py-3">
        <div className="label mb-2">Classes</div>
        <ul className="flex flex-col gap-1">
          {DETECTION_CLASSES.map((type) => {
            const muted = prefs.mutedClasses.includes(type.name)
            const colour = overrides[type.name] ?? type.color
            return (
              <li key={type.id} className="flex items-center gap-3">
                {/* The swatch is the colour picker. A separate button beside a
                    sample would be two controls for one thing. */}
                <label
                  className="relative size-5 shrink-0 cursor-pointer rounded-sm border border-white/15"
                  style={{ background: colour, opacity: muted ? 0.3 : 1 }}
                  title={`Colour for ${type.label}`}
                >
                  <input
                    type="color"
                    value={colour}
                    onChange={(event) => setDetectionColor(type.name, event.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label={`Colour for ${type.label}`}
                  />
                </label>

                <span
                  className={`flex-1 text-[13px] ${muted ? 'text-ink-600 line-through' : 'text-ink-100'}`}
                >
                  {type.label}
                </span>

                <Toggle
                  label={`Show ${type.label}`}
                  checked={!muted}
                  onChange={() => toggleMutedClass(type.name)}
                />
              </li>
            )
          })}
        </ul>
      </div>
    </Section>
  )
}
