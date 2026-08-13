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
/**
 * Six rows of three, and no more.
 *
 * A long run puts a hundred stills in here, and an unbounded grid turns the
 * panel into a page — it grows until it is capped by the feed and then becomes
 * a long scroll nobody reads to the end of. Six rows is enough to find the shot
 * just taken, which is what this panel is for; the rest of the roll lives on
 * the run page, which is built to hold it.
 */
const COLUMNS = 3
const MAX_ROWS = 6
const LIMIT = COLUMNS * MAX_ROWS

export function GalleryPanel({ client, run, onClose }: GalleryPanelProps) {
  const all = run ? [...run.snapshots].reverse() : []
  const snapshots = all.slice(0, LIMIT)
  const hidden = all.length - snapshots.length

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
              <li key={snapshot.id} className="relative">
                <img
                  src={client.mediaUrl(
                    `/api/runs/${run.id}/snapshots/${snapshot.file}`,
                  )}
                  alt={`Snapshot at ${format.metres(snapshot.chainage_m)}`}
                  loading="lazy"
                  className="aspect-[4/3] w-full rounded-sm border border-ink-800 object-cover"
                />
                {/* Inside the frame, not under it. A caption on its own line
                    costs a row of height per row of pictures, and the panel is
                    competing with the video for every pixel. */}
                <span className="overlay-shadow absolute right-1 bottom-1 rounded-[3px] bg-ink-1000/75 px-1 text-[9px] leading-[13px] font-semibold tnum text-ink-0">
                  {format.metres(snapshot.chainage_m)}
                </span>
              </li>
            ))}
          </ul>

          <Link
            to={`/runs/${run.id}`}
            className="mt-3 block text-center text-[11px] text-ink-500 underline underline-offset-2 hover:text-ink-100"
          >
            {hidden > 0 ? `Open the full run — ${hidden} more` : 'Open the full run'}
          </Link>
        </>
      )}
    </Popover>
  )
}
