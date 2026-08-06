import type { ProfileMarker } from '@/components/profile/scale'
import { defectLabel, SEVERITY_LABELS } from '@/constants/defects'
import * as format from '@/lib/format'
import type { RobotClient } from '@/robot/client'
import type { Run } from '@/robot/types'

interface MarkerCardProps {
  marker: ProfileMarker
  run: Run
  client: RobotClient
}

/**
 * What one marker on the profile actually is.
 *
 * Chainages are shown plain. The strip positions a marker to the pixel, which
 * is a far more confident claim than the estimate behind it -- the honesty about
 * that lives in the `estimated` badge on the readout, not in a margin on every
 * number.
 */
export function MarkerCard({ marker, run, client }: MarkerCardProps) {
  const { defect } = marker

  // A defect's still is the snapshot it was filed against, so the operator sees
  // the wall rather than a code they now have to remember the shape of.
  const still =
    marker.snapshot ??
    (defect?.snapshot_id
      ? (run.snapshots.find((item) => item.id === defect.snapshot_id) ?? null)
      : null)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="display text-[13px] text-ink-100">
          {defect ? defectLabel(defect.code) : 'Snapshot'}
        </span>
        <span className="label tnum">
          {defect
            ? format.metres(defect.chainage_m)
            : format.metres(marker.chainage_m)}
        </span>
      </div>

      {defect && (
        <div className="flex items-center gap-2 text-[12px] text-ink-400">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-state-fault-signal"
          />
          <span>
            {SEVERITY_LABELS[defect.severity] ?? `Severity ${defect.severity}`}
          </span>
          {defect.clock_position !== null && (
            <span className="tnum text-ink-500">{defect.clock_position} o’clock</span>
          )}
        </div>
      )}

      {still && (
        <img
          src={client.mediaUrl(`/api/runs/${run.id}/snapshots/${still.file}`)}
          alt={
            defect
              ? `Frame filed with ${defectLabel(defect.code)}`
              : `Snapshot at ${format.metres(marker.chainage_m)}`
          }
          loading="lazy"
          className="aspect-[4/3] w-full rounded-sm border border-ink-800 object-cover"
        />
      )}

      {defect?.note && <p className="text-[12px] text-ink-400">{defect.note}</p>}

      <span className="label text-ink-600">
        {format.timestamp(marker.defect?.at ?? marker.snapshot?.at ?? null)}
      </span>
    </div>
  )
}
