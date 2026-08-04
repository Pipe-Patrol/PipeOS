import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

import { useTempTest } from '@/dev/tempTest'
import { useRobot } from '@/robot/RobotProvider'

/**
 * Dev-only, renders nothing. Mounts the double-tap-T listener app-wide so the
 * simulated robot boots from any screen on the Vite dev server, then connects
 * the console and jumps to the live view.
 *
 * See web/src/dev/tempTest.ts and temptest/README.md. Inert in production.
 */
export function TempTestBridge() {
  const { connect } = useRobot()
  const navigate = useNavigate()

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
