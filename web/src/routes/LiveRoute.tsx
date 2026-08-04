import { useCallback, useEffect, useState } from 'react'

import { Preflight, PREFLIGHT_CHECKS } from '@/components/live/Preflight'
import { ShortcutOverlay } from '@/components/live/ShortcutOverlay'
import { StartRunPrompt } from '@/components/live/StartRunPrompt'
import { VideoFeed } from '@/components/live/VideoFeed'
import { Walkthrough, hasSeenWalkthrough } from '@/components/live/Walkthrough'
import { ZoomControl } from '@/components/live/ZoomControl'
import { PipeMap } from '@/components/map/PipeMap'
import { AlertBanner } from '@/components/overlay/AlertBanner'
import { DetectionBoxes } from '@/components/overlay/DetectionBoxes'
import { DirectionArrow } from '@/components/overlay/DirectionArrow'
import { TelemetryOverlay } from '@/components/overlay/TelemetryOverlay'
import { ToolPalette, type PanelId } from '@/components/panel/ToolPalette'
import { useDriveInput } from '@/input/useDriveInput'
import { saveRunJson, saveSnapshotLocally } from '@/lib/localSave'
import { useRobot } from '@/robot/RobotProvider'
import { useRun } from '@/robot/useRun'
import type { Run } from '@/robot/types'

/**
 * The driving screen.
 *
 * The video is the floor and everything else floats on top of it. No panel
 * takes layout space away from the frame, because down a pipe the frame is the
 * only thing the operator can actually see with.
 *
 * There is no on-screen d-pad. Driving is keyboard or gamepad, and the only
 * trace of a command is a transient arrow — a control that took a corner of the
 * glass to duplicate a key would be paying for it in pipe.
 */
export function LiveRoute() {
  const { client, link, telemetry } = useRobot()

  const [zoom, setZoom] = useState(1)
  const [ledLevel, setLedLevel] = useState(0)
  const [panel, setPanel] = useState<PanelId | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showWalkthrough, setShowWalkthrough] = useState(false)
  const [starting, setStarting] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  // Bumped on each capture to retrigger the shutter flash.
  const [flash, setFlash] = useState(0)
  // The choices from the prompt, held while the preflight gate is up. Non-null
  // means the preflight modal is open.
  const [preflight, setPreflight] = useState<{
    name: string
    record: boolean
    saveDir: FileSystemDirectoryHandle | null
  } | null>(null)
  // The folder to mirror this run into, once it has started. Null = robot only.
  const [saveDir, setSaveDir] = useState<FileSystemDirectoryHandle | null>(null)

  const activeRunId = telemetry?.run.active ? telemetry.run.id : null
  const { run, refresh: refreshRun } = useRun(client, activeRunId)

  const modalOpen = showShortcuts || showWalkthrough || preflight !== null

  const snapshot = useCallback(async () => {
    if (!client || !activeRunId) return
    try {
      const { snapshot } = await client.request<{ snapshot?: { file: string } }>(
        '/api/snapshot',
        { method: 'POST' },
      )
      setFlash(Date.now())
      if (saveDir && snapshot?.file) {
        try {
          await saveSnapshotLocally(saveDir, client, activeRunId, snapshot.file)
          await saveRunJson(saveDir, client, activeRunId)
        } catch {
          // Best-effort local mirror; the snapshot is safe on the robot.
        }
      }
      await refreshRun()
    } catch {
      // The camera can be unavailable; the alert line already says so.
    }
  }, [client, activeRunId, refreshRun, saveDir])

  const toggleRecording = useCallback(async () => {
    if (!client || !telemetry) return
    const path = telemetry.recording.active
      ? '/api/recording/stop'
      : '/api/recording/start'
    try {
      await client.request(path, { method: 'POST' })
    } catch {
      // Best-effort; telemetry reports the truth either way.
    }
  }, [client, telemetry])

  // Step one: the prompt opens the preflight gate rather than starting.
  const requestStart = useCallback(
    (name: string, record: boolean, dir: FileSystemDirectoryHandle | null) => {
      setRunError(null)
      setPreflight({ name, record, saveDir: dir })
    },
    [],
  )

  // Step two: preflight confirmed — this is where the run actually begins.
  const confirmStart = useCallback(async () => {
    if (!client || !preflight) return
    setStarting(true)
    setRunError(null)
    try {
      const { run } = await client.request<{ run: Run }>('/api/runs', {
        method: 'POST',
        body: JSON.stringify({ name: preflight.name, record: preflight.record }),
      })
      setSaveDir(preflight.saveDir)
      if (preflight.saveDir) {
        // Seed run.json immediately so the folder is valid from the first frame.
        void saveRunJson(preflight.saveDir, client, run.id).catch(() => {})
      }
      setPreflight(null)
      if (!hasSeenWalkthrough()) setShowWalkthrough(true)
    } catch (caught) {
      setRunError(caught instanceof Error ? caught.message : 'could not start')
    } finally {
      setStarting(false)
    }
  }, [client, preflight])

  const drive = useDriveInput({
    client,
    // Locked whenever a command could not be trusted to arrive, or a dialog has
    // the keyboard. The server's watchdog is the backstop, not the mechanism.
    enabled:
      !modalOpen && link.state === 'connected' && telemetry?.drive.hardware === true,
    onSnapshot: () => void snapshot(),
  })

  const setLed = useCallback(
    (level: number) => {
      setLedLevel(level)
      client?.setLed(level)
    },
    [client],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '?') setShowShortcuts(true)
      if (event.key === 'Escape') {
        setShowShortcuts(false)
        setPanel(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!client) return null

  return (
    <div className="flex h-full flex-col bg-ink-1000">
      <section className="relative min-h-0 flex-1">
        <VideoFeed
          client={client}
          zoom={zoom}
          onZoom={setZoom}
          stale={link.state !== 'connected'}
        />

        {telemetry && (
          <>
            <DetectionBoxes detections={telemetry.detections} now={telemetry.at} />

            <div className="pointer-events-none absolute top-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-3">
              <TelemetryOverlay telemetry={telemetry} />
              <AlertBanner alert={telemetry.alert} />
            </div>

            <div className="absolute bottom-5 left-5 z-10">
              <PipeMap path={run?.path ?? []} motion={telemetry.motion} />
            </div>

            <div className="absolute right-5 bottom-5 z-10">
              <ZoomControl zoom={zoom} onZoom={setZoom} />
            </div>

            <div className="absolute top-1/2 right-5 z-10 -translate-y-1/2">
              <ToolPalette
                client={client}
                telemetry={telemetry}
                run={run}
                open={panel}
                onOpen={setPanel}
                ledLevel={ledLevel}
                onLed={setLed}
                onSnapshot={() => void snapshot()}
                onToggleRecording={() => void toggleRecording()}
                onRunChanged={() => {
                  void refreshRun()
                  if (saveDir && activeRunId) {
                    void saveRunJson(saveDir, client, activeRunId).catch(() => {})
                  }
                }}
                onShowShortcuts={() => setShowShortcuts(true)}
              />
            </div>

            <DirectionArrow
              direction={drive.direction}
              source={drive.source}
              throttle={drive.throttle}
            />

            {!telemetry.run.active && <StartRunPrompt onStart={requestStart} />}
          </>
        )}

        {flash > 0 && (
          <div
            key={flash}
            className="capture-flash pointer-events-none absolute inset-0 z-40 bg-white"
          />
        )}
      </section>

      {preflight && (
        <Preflight
          checks={PREFLIGHT_CHECKS}
          busy={starting}
          error={runError}
          onConfirm={() => void confirmStart()}
          onCancel={() => {
            setPreflight(null)
            setRunError(null)
          }}
        />
      )}

      {showShortcuts && <ShortcutOverlay onClose={() => setShowShortcuts(false)} />}
      {showWalkthrough && (
        <Walkthrough
          gamepadConnected={drive.gamepadConnected}
          gamepadId={drive.gamepadId}
          onClose={() => setShowWalkthrough(false)}
        />
      )}
    </div>
  )
}
