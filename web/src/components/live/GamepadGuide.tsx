import { useGamepad } from '@/input/useGamepad'

/**
 * The pad, drawn, with one label per control.
 *
 * A PICTURE RATHER THAN A LIST, because the question this answers is "which of
 * these under my thumb does the thing", and a list makes an operator translate
 * a name into a position first. Labels only — no descriptions. Anything that
 * needs a sentence is in the keyboard tab.
 *
 * The outline is hand-drawn SVG rather than an icon-set glyph, which is the one
 * place in this console that is the right call: no icon set ships a labelled
 * controller diagram, and the alternative is a picture of a pad with no labels
 * on it, which is a decoration.
 *
 * The pad occupies 0..400 x 0..260; the viewBox is wider than that so the
 * labels have gutters either side to sit in. Leader lines are written in the
 * same coordinates as the shapes they point at.
 */

/** Face buttons: [cx, cy, glyph, label]. */
const FACE = [
  { cx: 300, cy: 78, glyph: '△', label: 'Record' },
  { cx: 324, cy: 102, glyph: '○', label: 'Select' },
  { cx: 276, cy: 102, glyph: '□', label: 'Lights' },
  { cx: 300, cy: 126, glyph: '✕', label: 'Snapshot' },
] as const

export function GamepadGuide() {
  const gamepad = useGamepad()

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <p className="text-[12px] text-ink-400">Every control, labelled.</p>
        <span
          className={`shrink-0 text-[11.5px] ${
            gamepad.connected ? 'text-state-recording-signal' : 'text-ink-500'
          }`}
          title={gamepad.id ?? undefined}
        >
          {gamepad.connected ? 'Connected' : 'Press any button to connect'}
        </span>
      </div>

      <svg
        // The box is wider than the pad on purpose: the labels live in gutters
        // either side, and sizing it to the drawing alone clipped every one of
        // them at the edge.
        viewBox="-48 0 484 262"
        className="w-full"
        role="img"
        aria-label="Controller layout with each button labelled"
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-ink-600"
        >
          {/* Body: two grips under a slab. One path so the silhouette reads as
              a controller at a glance rather than as assorted rectangles. */}
          <path d="M120 62 H280 Q322 62 336 96 L366 186 Q376 220 348 232 Q322 242 304 216 L280 178 H120 L96 216 Q78 242 52 232 Q24 220 34 186 L64 96 Q78 62 120 62 Z" />

          {/* D-pad */}
          <path d="M92 90 h16 v16 h16 v16 h-16 v16 h-16 v-16 h-16 v-16 h16 z" />

          {/* Sticks */}
          <circle cx="150" cy="168" r="20" />
          <circle cx="250" cy="168" r="20" />

          {/* Face buttons */}
          {FACE.map((button) => (
            <circle key={button.label} cx={button.cx} cy={button.cy} r="13" />
          ))}

          {/* Shoulders and triggers */}
          <path d="M78 46 q22 -14 46 -8" />
          <path d="M322 46 q-22 -14 -46 -8" />
          <path d="M84 28 q22 -14 46 -8" />
          <path d="M316 28 q-22 -14 -46 -8" />

          {/* Create and Options */}
          <path d="M168 84 v14" />
          <path d="M232 84 v14" />
        </g>

        {/* Glyphs sit inside their circles, at the size they are printed. */}
        <g className="fill-ink-300" fontSize="13" textAnchor="middle">
          {FACE.map((button) => (
            <text key={button.label} x={button.cx} y={button.cy + 4.5}>
              {button.glyph}
            </text>
          ))}
        </g>

        {/* Leader lines, then labels. Drawn as one group so the hairlines stay
            visibly quieter than the text they point from. */}
        <g stroke="currentColor" strokeWidth={1} className="text-ink-800">
          <path d="M100 20 v-6 h-58" />
          <path d="M300 20 v-6 h58" />
          <path d="M108 42 h-66" />
          <path d="M292 42 h66" />
          <path d="M108 114 h-66" />
          <path d="M150 190 v22 h-40" />
          <path d="M250 190 v22 h40" />
          <path d="M168 84 v-18 h-42" />
          <path d="M232 84 v-18 h42" />
          <path d="M337 102 h30" />
        </g>

        <g className="fill-ink-100" fontSize="11.5">
          <text x="38" y="17" textAnchor="end">L2 · Forward</text>
          <text x="362" y="17">R2 · Back</text>
          <text x="38" y="45" textAnchor="end">L1 · Previous</text>
          <text x="362" y="45">R1 · Next</text>

          {/* Three short lines rather than one long one: end-anchored text
              this far left runs out of gutter before it runs out of words. */}
          <text x="38" y="110" textAnchor="end">D-pad</text>
          <text x="38" y="124" textAnchor="end" className="fill-ink-500">
            ↑↓ Zoom
          </text>
          <text x="38" y="138" textAnchor="end" className="fill-ink-500">
            ←→ Light
          </text>

          <text x="106" y="216" textAnchor="end">Left stick · Drive</text>
          <text x="106" y="230" textAnchor="end" className="fill-ink-500">
            Press · Lock throttle
          </text>

          <text x="294" y="216">Right stick · Pan</text>
          <text x="294" y="230" className="fill-ink-500">
            Press · This map
          </text>

          <text x="122" y="69" textAnchor="end">Create · Reset</text>
          {/* One line, not two: a second line here lands on the triangle
              button, which sits at y=78. */}
          <text x="278" y="69">Options · Home (hold)</text>

          {FACE.map((button, index) => (
            <text key={button.label} x={371} y={80 + index * 15}>
              {button.glyph} {button.label}
            </text>
          ))}
        </g>
      </svg>
    </div>
  )
}
