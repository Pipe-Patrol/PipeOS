import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

import { useErrorTest } from '@/dev/errorTest'
import { useTempTest } from '@/dev/tempTest'
import { useRobot } from '@/robot/RobotProvider'

/**
 * Dev-only, renders nothing. Mounts the testing-interface key listeners app-wide
 * so they work from any screen on the Vite dev server:
 *
 *   T T   boot the simulated robot, connect, and jump to the live view
 *   T E   step through every message the notice bar can show
 *
 * See web/src/dev/tempTest.ts, web/src/dev/errorTest.ts and temptest/README.md.
 * Inert in production.
 */
export function TempTestBridge() {
  const { connect } = useRobot()
  const navigate = useNavigate()

  useErrorTest()

  useTempTest(
    useCallback(async () => {
      try {
        await connect('')
        navigate('/live')
      } catch {
        // The simulator answers the probe, so this should not fail; if it does,
        // stay where we are.
      }
    }, [connect, navigate]),
  )

  return null
}
