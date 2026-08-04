import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/primitives/EmptyState'
import { Popover } from '@/components/primitives/Popover'
import * as format from '@/lib/format'
import type { RobotClient } from '@/robot/client'
import type { Run } from '@/robot/types'

interface GalleryPanelProps {
  client: RobotClient
  run: Run | null
  onClose: () => void
}

/**
 * The camera roll for the run in progress.
 *
 * Newest first, because the thing an operator wants to check is almost always
 * the shot they just took — usually to confirm it is not motion-blurred before
 * driving on past whatever it was of.
 */
export function GalleryPanel({ client, run, onClose }: GalleryPanelProps) {
  const snapshots = run ? [...run.snapshots].reverse() : []

  return (
    <Popover title="Camera roll" onClose={onClose}>
      {!run ? (
        <EmptyState title="No run in progress" />
      ) : snapshots.length === 0 ? (
        <EmptyState title="Nothing captured yet" />
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-1.5">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                <img
                  src={client.mediaUrl(
                    `/api/runs/${run.id}/snapshots/${snapshot.file}`,
                  )}
                  alt={`Snapshot at ${format.metres(snapshot.chainage_m)}`}
                  loading="lazy"
                  className="aspect-[4/3] w-full rounded-sm border border-ink-800 object-cover"
                />
                <span className="label mt-1 block text-center">
                  {format.metres(snapshot.chainage_m)}
                </span>
              </li>
            ))}
          </ul>

          <Link
            to={`/runs/${run.id}`}
            className="mt-3 block text-center text-[11px] text-ink-500 underline underline-offset-2 hover:text-ink-100"
          >
            Open the full run
          </Link>
        </>
      )}
    </Popover>
  )
}
