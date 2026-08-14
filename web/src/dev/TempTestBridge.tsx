import { useErrorTest } from '@/dev/errorTest'

/**
 * Dev-only, renders nothing. Mounts the testing-interface key listener app-wide
 * so it works from any screen on the Vite dev server:
 *
 *   T E   step through every message the notice bar can show
 *
 * The simulated robot is no longer a gesture: type `test` as both the device
 * name and the address on the connect screen. See web/src/dev/tempTest.ts.
 * Inert in production.
 */
export function TempTestBridge() {
  useErrorTest()

  return null
}
