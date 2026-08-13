import {
  profileDomain,
  profileMarkers,
  profileTicks,
  profileX,
} from '@/components/profile/scale'
import {
  selectDefect,
  selectRecording,
  selectSnapshot,
  type Selection,
} from '@/components/rundetail/selection'
import { defectClassName, defectLabel } from '@/constants/defects'
import { detectionColor } from '@/lib/detectionColors'
import * as format from '@/lib/format'
import type { Run } from '@/robot/types'

/**
 * The whole run on one axis of metres, as the way into everything else on the
 * page.
 *
 * The live strip under the video answers "have I surveyed this yet". This one
 * answers a different question — "what is on this run, and where" — so it is
 * taller, it carries the recordings, and everything on it is a control rather
 * than a mark.
 *
 * RECORDINGS ARE SPANS, NOT POINTS. A defect happens at a chainage; a recording
 * covers a stretch of pipe, and drawing it as a dot at its start would throw
 * away the only thing about it worth knowing at a glance — how much of the run
 * has footage. Thick rounded bars under the axis, because the axis itself is
 * where the point-like things live and the two must not compete.
 */

const LAYOUT = {
  /** With recordings to draw. Without them the strip stops under the numbers. */
  height: 92,
  bareHeight: 56,
  axisY: 34,
  tickDrop: 4,
  /** Where the recording bars sit, below the axis and its numbers. */
  spanY: 62,
  spanHeight: 9,
} as const

interface RunProfileProps {
  run: Run
  selected: Selection | null
  onSelect: (selection: Selection | null) => void
}

export function RunProfile({ run, selected, onSelect }: RunProfileProps) {
  const { markers, unplaced } = profileMarkers(run)

  // The recordings widen the axis too. A clip that ran past the last defect is
  // still part of the run, and an axis that stopped at the last marker would
  // clip the bar that says so.
  const reach = Math.max(
    0,
    ...markers.map((marker) => marker.chainage_m),
    ...run.recordings.flatMap((recording) =>
      [recording.chainage_start_m, recording.chainage_end_m].filter(
        (value): value is number => value !== null,
      ),
    ),
    run.distance_m,
  )
  const domain = profileDomain(markers, 0, reach)
  const ticks = profileTicks(domain)
  const percent = (value: number) => `${profileX(value, domain) * 100}%`

  const spans = run.recordings
    .map((recording) => {
      const from = recording.chainage_start_m
      const to = recording.chainage_end_m ?? from
      if (from === null || to === null) return null
      return { recording, from: Math.min(from, to), to: Math.max(from, to) }
    })
    .filter((span): span is NonNullable<typeof span> => span !== null)

  return (
    <div className="panel px-4 pt-2 pb-3">
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <h2 className="display text-[13px] text-ink-0">Longitudinal view</h2>
        {/* Said outright. Nothing about a mark on an axis suggests it can be
            pressed, and the whole page below this is driven by pressing them. */}
        <p className="text-[11.5px] text-ink-500">
          Click a marker or a recording to see it
        </p>
      </div>

      <div
        className="relative w-full"
        style={{ height: spans.length > 0 ? LAYOUT.height : LAYOUT.bareHeight }}
      >
        <span
          aria-hidden
          className="absolute inset-x-0 rounded-full bg-ink-400"
          style={{ top: LAYOUT.axisY - 1, height: 2 }}
        />

        {ticks.map((tick, index) => (
          <span
            key={tick}
            className="absolute flex flex-col items-center"
            style={{ left: percent(tick), top: LAYOUT.axisY }}
          >
            <span
              className="block w-px bg-ink-700"
              style={{ height: LAYOUT.tickDrop }}
            />
            <span
              className={`tnum mt-1 text-[11px] leading-none whitespace-nowrap text-ink-400 ${
                index === 0
                  ? ''
                  : index === ticks.length - 1
                    ? '-translate-x-full'
                    : '-translate-x-1/2'
              }`}
            >
              {tick === 0 ? '' : format.metres(tick, 0)}
            </span>
          </span>
        ))}

        {/* Where the run went in. The same badge the map puts on the street. */}
        <span
          aria-hidden
          className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
          style={{ left: percent(0), top: LAYOUT.axisY }}
          title="Entry point"
        >
          <span className="home-badge">H</span>
        </span>

        {markers.map((marker) => {
          const isSelected = selected?.id === marker.id
          const colour =
            marker.kind === 'defect' && marker.defect
              ? detectionColor(defectClassName(marker.defect.code))
              : 'var(--color-ink-300)'
          const name =
            marker.kind === 'defect' && marker.defect
              ? `${defectLabel(marker.defect.code)} at ${format.metres(marker.chainage_m)}`
              : `Capture at ${format.metres(marker.chainage_m)}`
          return (
            <button
              key={marker.id}
              type="button"
              title={name}
              aria-label={name}
              aria-pressed={isSelected}
              onClick={() =>
                onSelect(
                  isSelected
                    ? null
                    : marker.kind === 'defect' && marker.defect
                      ? selectDefect(marker.defect)
                      : selectSnapshot(marker.snapshot!),
                )
              }
              className="absolute z-10 flex w-5 -translate-x-1/2 justify-center"
              style={{ left: percent(marker.chainage_m), top: LAYOUT.axisY - 16, height: 18 }}
            >
              <span
                className={`block w-[3px] rounded-full transition-all ${
                  isSelected ? 'h-[18px]' : 'h-[13px]'
                }`}
                style={{
                  background: colour,
                  outline: isSelected ? '2px solid var(--color-ink-0)' : undefined,
                  outlineOffset: 1,
                }}
              />
            </button>
          )
        })}

        {spans.map(({ recording, from, to }) => {
          const isSelected = selected?.id === recording.id
          const left = profileX(from, domain) * 100
          const right = profileX(to, domain) * 100
          const name = `Recording, ${format.metres(from)} to ${format.metres(to)}`
          return (
            <button
              key={recording.id}
              type="button"
              title={name}
              aria-label={name}
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? null : selectRecording(recording))}
              className="absolute rounded-full transition-all hover:brightness-125"
              style={{
                left: `${left}%`,
                // A clip that never moved is still a clip. Given a floor rather
                // than drawn as a zero-width bar nobody could press.
                width: `max(${right - left}%, 10px)`,
                top: LAYOUT.spanY,
                height: LAYOUT.spanHeight,
                background: 'var(--color-state-fault-signal)',
                outline: isSelected ? '2px solid var(--color-ink-0)' : undefined,
                outlineOffset: 2,
              }}
            />
          )
        })}

        {spans.length > 0 && (
          <span
            className="label absolute left-0"
            style={{ top: LAYOUT.spanY + LAYOUT.spanHeight + 4 }}
          >
            Recorded
          </span>
        )}
      </div>

      {unplaced > 0 && (
        <p className="mt-1 text-[11px] text-ink-500">
          {unplaced} not placed — logged without a chainage
        </p>
      )}
    </div>
  )
}
