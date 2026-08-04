import { useCallback, useEffect, useState } from 'react'

import type { RobotClient } from '@/robot/client'
import type { Run } from '@/robot/types'

/**
 * One run, fetched from the robot.
 *
 * Runs live on the Pi, so this is a read of server state rather than a slice of
 * client state — which is what lets a second device see the same defects. It
 * refetches on demand: a new snapshot or defect calls `refresh()` rather than
 * the whole thing polling, because nothing here changes without the operator
 * doing something.
 */
export function useRun(client: RobotClient | null, runId: string | null) {
  const [run, setRun] = useState<Run | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!client || !runId) {
      setRun(null)
      return
    }
    setLoading(true)
    try {
      setRun(await client.request<Run>(`/api/runs/${runId}`))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'could not load the run')
    } finally {
      setLoading(false)
    }
  }, [client, runId])

  useEffect(() => {
    // Reading server state on mount is what an effect is for. The rule cannot
    // tell this from a render-cascade, and the alternative — Suspense plus a
    // data layer — is machinery this console does not otherwise need.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  return { run, loading, error, refresh }
}
