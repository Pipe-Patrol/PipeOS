/**
 * Test-mode transport for the demo day panel.
 *
 * On a real robot the panel POSTs frames to /api/demoday/frame and the Pi does
 * the work. There is no Pi here, so the panel hands frames to this window over a
 * BroadcastChannel instead and the Mac does it: the frame goes to /api/detect on
 * the local server, and the boxes it returns go into the simulated telemetry.
 *
 * Delete demoday/ and nothing ever speaks on this channel.
 */

import { robot } from './robot'
import type { Detection } from '../web/src/robot/types'

const CHANNEL = 'pipeos-demoday'

declare global {
  interface Window {
    __temptestFrame?: string
  }
}

let channel: BroadcastChannel | null = null
let busy = false
let frameUrl: string | null = null

export function installDemoBridge(): void {
  if (channel) return
  channel = new BroadcastChannel(CHANNEL)

  channel.onmessage = (event) => {
    const message = event.data
    if (message?.type === 'panel-here') {
      channel?.postMessage({ type: 'sim-here' })
    } else if (message?.type === 'frame') {
      void onFrame(message.blob as Blob)
    }
  }

  channel.postMessage({ type: 'sim-here' })
}

async function onFrame(blob: Blob): Promise<void> {
  if (!(blob instanceof Blob)) return

  const previous = frameUrl
  frameUrl = URL.createObjectURL(blob)
  window.__temptestFrame = frameUrl
  window.dispatchEvent(new CustomEvent('temptest-frame', { detail: frameUrl }))
  // Revoked a tick later so the <img> has taken the new one first.
  if (previous) setTimeout(() => URL.revokeObjectURL(previous), 200)

  if (busy) return
  busy = true
  try {
    const response = await fetch('/api/detect', {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': 'image/jpeg' },
    })
    const body = await response.json()
    robot.supplied = response.ok ? ((body.detections as Detection[]) ?? []) : []
  } catch {
    robot.supplied = []
  } finally {
    busy = false
  }
}
