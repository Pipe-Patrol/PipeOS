import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { Page } from '@/components/shell/Page'
import { EmptyState } from '@/components/primitives/EmptyState'
import * as format from '@/lib/format'
import { useRobot } from '@/robot/RobotProvider'
import type { RunSummary } from '@/robot/types'

/**
 * Every run the robot is holding.
 *
 * Fixed columns, uniform row heights, no dot separators — this is a table an
 * operator scans, and alignment is what makes it scannable.
 *
 * Interrupted runs are called out rather than hidden. A run that was never
 * ended usually means a power cut mid-inspection, and the video and defects up
 * to that moment are still there.
 */
export function RunsRoute() {
  const { client } = useRobot()
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      const body = await client.request<{ runs: RunSummary[] }>('/api/runs')
      setRuns(body.runs)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'could not load runs')
    }
  }, [client])

  useEffect(() => {
    // Fetch on mount — see the note in robot/useRun.ts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  if (!client) return <Navigate to="/connect" replace />

  return (
    <Page title="Runs">
      {error && <p className="text-[12px] text-state-fault-signal">{error}</p>}

      {runs === null ? (
        <p className="text-[12px] text-ink-500">Loading…</p>
      ) : runs.length === 0 ? (
        <EmptyState title="No runs yet" />
      ) : (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-[1fr_112px_repeat(4,minmax(80px,auto))] gap-x-4 border-b border-ink-800 px-4 py-2">
            <span className="label">Run</span>
            <span className="label">ID</span>
            <span className="label text-right">Distance</span>
            <span className="label text-right">Duration</span>
            <span className="label text-right">Defects</span>
            <span className="label text-right">Frames</span>
          </div>

          <ul className="divide-y divide-ink-800">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  to={`/runs/${run.id}`}
                  className="grid h-14 grid-cols-[1fr_112px_repeat(4,minmax(80px,auto))] items-center gap-x-4 px-4 hover:bg-white/5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink-100">
                      {run.name}
                    </span>
                    <span className="block truncate text-[11px] text-ink-500">
                      {format.timestamp(run.started_at)}
                      {run.interrupted && (
                        <span className="ml-2 text-state-warning-signal">
                          interrupted
                        </span>
                      )}
                    </span>
                  </span>

                  <span className="tnum truncate text-[11px] text-ink-500">
                    {run.id}
                  </span>
                  <span className="text-right text-[13px] tnum text-ink-400">
                    {format.metres(run.distance_m)}
                  </span>
                  <span className="text-right text-[13px] tnum text-ink-400">
                    {format.duration(run.duration_s)}
                  </span>
                  <span className="text-right text-[13px] tnum text-ink-400">
                    {run.defect_count}
                  </span>
                  <span className="text-right text-[13px] tnum text-ink-400">
                    {run.snapshot_count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Page>
  )
}
