import { DefectBox } from '@/components/overlay/DefectBox'
import { chainageOf, snapshotFor, type Selection } from '@/components/rundetail/selection'
import { CloseIcon } from '@/components/primitives/icons'
import { defectClassName, defectLabel, SEVERITY_LABELS } from '@/constants/defects'
import * as format from '@/lib/format'
import type { RobotClient } from '@/robot/client'
import type { Run } from '@/robot/types'

/**
 * Whatever was last clicked, played or shown at size, with everything recorded
 * alongside it.
 *
 * ONLY ON SCREEN WHEN SOMETHING IS SELECTED. A permanent empty panel saying
 * "nothing selected" is a row of dead height on every run anybody opens just to
 * read the statistics.
 *
 * SPLIT LEFT AND RIGHT, and the split is not even: the media takes the width it
 * was captured at, and the facts take what is left. A 4:3 still stretched to
 * half a wide screen is a still nobody can judge a crack from, and the numbers
 * beside it are short enough to live in a column.
 */

interface PreviewRowProps {
  client: RobotClient
  run: Run
  selection: Selection
  onClose: () => void
}

export function PreviewRow({ client, run, selection, onClose }: PreviewRowProps) {
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center justify-between gap-4 border-b border-ink-800 px-4 py-2">
        <h2 className="display text-[13px] text-ink-0">{titleOf(selection)}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the preview"
          className="rounded-sm p-1 text-ink-500 transition-colors hover:bg-white/10 hover:text-ink-100"
        >
          <CloseIcon size={14} />
        </button>
      </header>

      <div className="flex flex-col gap-4 p-4 lg:flex-row">
        <div className="w-full shrink-0 lg:w-[440px]">
          <Media client={client} run={run} selection={selection} />
        </div>
        <div className="min-w-0 flex-1">
          <Facts selection={selection} />
        </div>
      </div>
    </section>
  )
}

function titleOf(selection: Selection): string {
  switch (selection.kind) {
    case 'defect':
      return defectLabel(selection.defect.code)
    case 'snapshot':
      return 'Capture'
    case 'recording':
      return 'Recording'
  }
}

function Media({
  client,
  run,
  selection,
}: {
  client: RobotClient
  run: Run
  selection: Selection
}) {
  const base = `/api/runs/${run.id}`

  if (selection.kind === 'recording') {
    return (
      <video
        // Keyed on the clip so switching between two recordings reloads the
        // source rather than leaving the first one playing under a new label.
        key={selection.recording.id}
        controls
        preload="metadata"
        src={client.mediaUrl(`${base}/video.mov?clip=${selection.recording.id}`)}
        className="aspect-[4/3] w-full rounded-panel border border-ink-800 bg-black"
      />
    )
  }

  const snapshot =
    selection.kind === 'snapshot'
      ? selection.snapshot
      : snapshotFor(run, selection.defect)

  if (!snapshot) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-panel border border-ink-800 bg-ink-950 text-[12px] text-ink-500">
        Logged without a picture
      </div>
    )
  }

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-panel border border-ink-800 bg-black">
      <img
        src={client.mediaUrl(`${base}/snapshots/${snapshot.file}`)}
        alt={`Frame at ${format.metres(snapshot.chainage_m)}`}
        className="h-full w-full object-cover"
      />
      {/* The box travels with the defect, so it is drawn back over the frame it
          was drawn on rather than being a thing that only existed live. */}
      {selection.kind === 'defect' && selection.defect.region && (
        <DefectBox
          rect={selection.defect.region}
          label={defectClassName(selection.defect.code)}
          fallbackText={defectLabel(selection.defect.code)}
        />
      )}
    </div>
  )
}

function Facts({ selection }: { selection: Selection }) {
  const chainage = chainageOf(selection)

  const rows: [string, string][] = [['Distance', format.metres(chainage)]]

  if (selection.kind === 'defect') {
    const defect = selection.defect
    rows.push(
      ['Type', defectLabel(defect.code)],
      ['Severity', SEVERITY_LABELS[defect.severity] ?? String(defect.severity)],
      [
        'Clock position',
        defect.clock_position ? `${defect.clock_position} o'clock` : format.BLANK,
      ],
      ['Uncertainty', format.metres(defect.chainage_uncertainty_m)],
      ['Logged', format.timestamp(defect.at)],
      ['Note', defect.note || format.BLANK],
    )
  }

  if (selection.kind === 'snapshot') {
    rows.push(['Captured', format.timestamp(selection.snapshot.at)])
  }

  if (selection.kind === 'recording') {
    const recording = selection.recording
    rows.push(
      [
        'Covers',
        recording.chainage_start_m === null
          ? format.BLANK
          : `${format.metres(recording.chainage_start_m)} → ${format.metres(
              recording.chainage_end_m,
            )}`,
      ],
      ['Length', format.duration(recording.duration_s)],
      ['Frames', String(recording.frames)],
      ['Size', format.bytes(recording.bytes)],
      ['Started', format.timestamp(recording.started_at)],
    )
  }

  return (
    <dl className="flex flex-col divide-y divide-ink-850">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-6 py-2">
          <dt className="shrink-0 text-[12px] text-ink-400">{label}</dt>
          <dd className="tnum min-w-0 truncate text-right text-[13px] text-ink-100">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
