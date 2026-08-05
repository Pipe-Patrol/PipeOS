import { useCallback, useEffect, useState } from 'react'

import { FinishRunPrompt } from '@/components/live/FinishRunPrompt'
import { Preflight, PREFLIGHT_CHECKS } from '@/components/live/Preflight'
import { RegionDrawer } from '@/components/live/RegionDrawer'
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
import { PoweredOff } from '@/components/shell/ShutdownDialog'
import { useDriveInput } from '@/input/useDriveInput'
import { readError } from '@/lib/errors'
import { saveRunJson, saveSnapshotLocally } from '@/lib/localSave'
import { useRobot } from '@/robot/RobotProvider'
import { useRun } from '@/robot/useRun'
import type { DefectRegion, Run } from '@/robot/types'

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
  const { client, link, telemetry, disconnect } = useRobot()

  const [zoom, setZoom] = useState(1)
  const [ledLevel, setLedLevel] = useState(0)
  const [panel, setPanel] = useState<PanelId | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showWalkthrough, setShowWalkthrough] = useState(false)
  const [starting, setStarting] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [ending, setEnding] = useState(false)
  const [endError, setEndError] = useState<string | null>(null)
  const [halted, setHalted] = useState(false)
  // The run closed but the shutdown did not. A state of its own because the
  // dialog must stop offering to finish a run that is already finished.
  const [runClosed, setRunClosed] = useState(false)
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
  // The defect box lives here rather than in the panel, because it is drawn on
  // the feed and the panel only displays it.
  const [defectRegion, setDefectRegion] = useState<DefectRegion | null>(null)
  const [defectRegionMarkedAt, setDefectRegionMarkedAt] = useState(0)
  const [drawingRegion, setDrawingRegion] = useState(false)

  // Stamped here, where the box is actually committed, so the panel's still
  // freezes on one frame instead of chasing the region in an effect.
  const markRegion = useCallback((region: DefectRegion | null) => {
    setDefectRegion(region)
    if (region) setDefectRegionMarkedAt(Date.now())
  }, [])

  const activeRunId = telemetry?.run.active ? telemetry.run.id : null
  const { run, refresh: refreshRun } = useRun(client, activeRunId)

  // Driving is locked while any of these has the screen — including drawing,
  // where the operator is pointing at pipe wall rather than watching where the
  // robot is going, and a stray key would move it out from under the box.
  const modalOpen =
    showShortcuts || showWalkthrough || preflight !== null || drawingRegion || finishing

  const startDrawingRegion = useCallback(() => {
    // Always draw at 1x. Screen-to-frame mapping assumes the whole frame is on
    // show, so a box drawn while zoomed in would be filed against the wrong
    // part of the picture — and silently, which is the worst kind of wrong.
    setZoom(1)
    setDrawingRegion(true)
  }, [])

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

  // Ending is the last thing that touches the run, so the local mirror is
  // rewritten after it rather than before: this is the only version of run.json
  // that carries the final distance and the closing timestamp.
  //
  // The run is always closed first, even when the operator asked to shut down.
  // /api/shutdown would close it too, but doing it here means a Pi that turns
  // out to have no permission to halt still leaves a sealed, exported run.
  const finishRun = useCallback(
    async (thenShutDown: boolean) => {
      if (!client) return
      setEnding(true)
      setEndError(null)

      // Skipped when this is a retry of a failed shutdown: the run is already
      // closed, and ending it again is a 409 that would read as a new fault.
      if (!runClosed) {
        if (!activeRunId) return
        try {
          await client.request(`/api/runs/${activeRunId}/end`, { method: 'POST' })
          if (saveDir) {
            try {
              await saveRunJson(saveDir, client, activeRunId)
            } catch {
              // The run is closed and safe on the robot; the mirror is a copy.
            }
          }
          setSaveDir(null)
          setRunClosed(true)
        } catch (caught) {
          setEndError(readError(caught, 'could not finish the run'))
          setEnding(false)
          return
        }
      }

      if (!thenShutDown) {
        setFinishing(false)
        setRunClosed(false)
        setEnding(false)
        await refreshRun()
        return
      }

      try {
        await client.request('/api/shutdown', { method: 'POST' })
        setFinishing(false)
        setHalted(true)
        // Stop reconnecting to a Pi on its way down, or the banner spends the
        // next minute calling a deliberate shutdown a fault.
        disconnect()
      } catch (caught) {
        // The run is already safe. Say only what failed, and leave the dialog
        // up so the operator knows not to reach for the switch.
        setEndError(`Run finished, but it did not shut down: ${readError(caught)}`)
        setEnding(false)
      }
    },
    [client, activeRunId, saveDir, refreshRun, disconnect, runClosed],
  )

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
        // While drawing, Esc belongs to the drawer alone. Closing the panel
        // here as well would throw away the half-filled defect form behind it.
        if (drawingRegion) return
        setShowShortcuts(false)
        setPanel(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawingRegion])

  // Before the client guard: shutting down clears the client, and a blank
  // screen would drop the one instruction that keeps the SD card intact.
  if (halted) return <PoweredOff />

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

            {/* Top right, opposite the readout and clear of the palette. The
                one control on the glass that ends something, so it is worded
                as the outcome rather than as a verb on the run. */}
            {telemetry.run.active && (
              <button
                type="button"
                onClick={() => {
                  setEndError(null)
                  setFinishing(true)
                }}
                className="panel absolute top-5 right-5 z-10 flex h-9 items-center rounded-panel px-3 text-[13px] text-ink-100 transition-colors hover:bg-white/10"
              >
                Finish run
              </button>
            )}

            <div className="absolute bottom-5 left-5 z-10">
              <PipeMap path={run?.path ?? []} motion={telemetry.motion} />
            </div>

            <div className="absolute right-5 bottom-5 z-10">
              <ZoomControl zoom={zoom} onZoom={setZoom} />
            </div>

            {/* Hidden, not unmounted, while the box is being drawn: the panel
                holds a half-filled defect form and unmounting would throw away
                the code, severity and note the operator already chose. */}
            <div
              className={`absolute top-1/2 right-5 z-10 -translate-y-1/2 ${
                drawingRegion ? 'invisible' : ''
              }`}
            >
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
                drawingRegion={drawingRegion}
                defectRegion={defectRegion}
                defectRegionMarkedAt={defectRegionMarkedAt}
                onDefectRegionChange={markRegion}
                onDrawDefectRegion={startDrawingRegion}
              />
            </div>

            {drawingRegion && (
              <RegionDrawer
                onCommit={(region) => {
                  markRegion(region)
                  setDrawingRegion(false)
                }}
                onCancel={() => setDrawingRegion(false)}
              />
            )}

            <DirectionArrow
              direction={drive.direction}
              source={drive.source}
              throttle={drive.throttle}
            />

            {finishing && (
              <FinishRunPrompt
                run={run}
                status={telemetry.run}
                motion={telemetry.motion}
                now={telemetry.at}
                busy={ending}
                error={endError}
                runClosed={runClosed}
                onConfirm={() => void finishRun(false)}
                onConfirmAndShutdown={() => void finishRun(true)}
                onCancel={() => {
                  setFinishing(false)
                  setEndError(null)
                  setRunClosed(false)
                }}
              />
            )}

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
