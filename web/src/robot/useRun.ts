import { useCallback, useEffect, useRef, useState } from 'react'

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
/**
 * Fill in what an older robot may not send.
 *
 * A console can outrun the firmware on the Pi — deploys are separate — and the
 * run page reads `recordings` in half a dozen places. One missing array there
 * is a blank screen rather than a missing section, which is a bad trade for a
 * field that used to be called something else.
 */
function normalise(run: Run): Run {
  return { ...run, recordings: run.recordings ?? [] }
}

export function useRun(client: RobotClient | null, runId: string | null) {
  const [run, setRun] = useState<Run | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Which fetch is the current one. A reply that is not it is dropped.
   *
   * THE BUG THIS FIXES. Finishing a run refetched it, and a moment later
   * telemetry reported no active run, which clears this hook to null. The fetch
   * was still in flight, so it landed *after* the clear and put the finished run
   * back — leaving the console holding a run the robot had already sealed. It
   * looked like the UI lagging behind the button: the map kept the old run's
   * origin, defects and trail while everything driven off telemetry had already
   * moved on.
   */
  const current = useRef(0)

  const refresh = useCallback(async () => {
    const ticket = ++current.current

    if (!client || !runId) {
      setRun(null)
      setError(null)
      return
    }
    setLoading(true)
    try {
      const next = normalise(await client.request<Run>(`/api/runs/${runId}`))
      if (ticket !== current.current) return
      setRun(next)
      setError(null)
    } catch (caught) {
      if (ticket !== current.current) return
      setError(caught instanceof Error ? caught.message : 'could not load the run')
    } finally {
      if (ticket === current.current) setLoading(false)
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
