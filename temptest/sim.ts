/**
 * The simulated robot, entry point.
 *
 * `web/src/dev/tempTest.ts` imports this file by absolute path and calls
 * `activate()` when you press T twice. That is the whole contract — this module
 * must keep exporting `activate`, and nothing here may assume it was imported
 * any other way.
 *
 * What activation does, in order:
 *
 *   1. shims `window.fetch`     so /api/* is answered in the page  (api.ts)
 *   2. shims `window.WebSocket` so /ws carries telemetry           (socket.ts)
 *   3. catches export clicks    which are navigations, not fetches (downloads.ts)
 *   4. starts the physics tick                                     (robot.ts)
 *
 * Every shim passes through anything it does not own — another origin, a
 * non-/api path, Vite's HMR socket — so the dev server keeps working normally.
 *
 * There is no deactivate. Reload the page.
 */

import { installFetch, probeDetector } from './api'
import { installDemoBridge } from './demo-bridge'
import { installDownloads } from './downloads'
import { robot } from './robot'
import { installSocket } from './socket'

let active = false

export function activate(): void {
  if (active) {
    console.info('[temptest] already running')
    return
  }
  active = true

  installFetch()
  void probeDetector()
  installDemoBridge()
  installSocket()
  installDownloads()
  installTestKeys()
  robot.start()

  console.info(
    '[temptest] simulated robot up.\n' +
      '  · drive with the usual keys — the motors stay locked until a run is open\n' +
      '  · four seeded runs are in the list, one of them interrupted\n' +
      '  · T then C — a sudden air spike, for the warning and the flag prompt\n' +
      '  · T then M — one model detection, for the boxes and auto flagging\n' +
      '  · shutdown really shuts it down; reload and press T twice to restart\n' +
      '  · delete the temptest/ folder and all of this goes away',
  )
}

/**
 * The two conditions the simulator will not produce on its own.
 *
 * Both are chorded off T, matching the console's own testing keys (T T for the
 * simulator, T E for the error bar), so there is one gesture to remember and no
 * single letter that could collide with a driving key.
 */
const CHORD_MS = 800

const CLASSES = [
  'crack',
  'deposition',
  'incrustation',
  'joint offset',
  'obstruction',
  'root intrusion',
  'utility intrusion',
]

function installTestKeys(): void {
  let lastT = 0
  let nextClass = 0

  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target as HTMLElement | null
    if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) {
      return
    }

    if (event.code === 'KeyT') {
      lastT = Date.now()
      return
    }
    if (Date.now() - lastT > CHORD_MS) return

    if (event.code === 'KeyC') {
      lastT = 0
      robot.injectClimateSpike()
      console.info('[temptest] air spike injected — holds for 25 s')
    } else if (event.code === 'KeyM') {
      lastT = 0
      // Cycles the classes so every colour and label gets looked at rather
      // than the first one seven times.
      const label = CLASSES[nextClass % CLASSES.length]
      nextClass += 1
      robot.injectDetection(label)
      console.info(`[temptest] detection injected — ${label}`)
    }
  })
}
