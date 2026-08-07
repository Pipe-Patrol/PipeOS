import { useCallback, useEffect, useState } from 'react'

import { FinishRunPrompt } from '@/components/live/FinishRunPrompt'
import { NoRunOverlay } from '@/components/live/NoRunOverlay'
import { RegionDrawer } from '@/components/live/RegionDrawer'
import { RunSetupPanel, type RunDraft } from '@/components/live/runsetup/RunSetupPanel'
import { ShortcutOverlay } from '@/components/live/ShortcutOverlay'
import { VideoFeed } from '@/components/live/VideoFeed'
import { ZoomControl } from '@/components/live/ZoomControl'
import { PipeMap } from '@/components/map/PipeMap'
import { AlertBanner } from '@/components/overlay/AlertBanner'
import { ProfileStrip } from '@/components/profile/ProfileStrip'
import { DetectionBoxes } from '@/components/overlay/DetectionBoxes'
import { DirectionArrow } from '@/components/overlay/DirectionArrow'
import { ReturnHomeBanner } from '@/components/overlay/ReturnHomeBanner'
import { TelemetryOverlay } from '@/components/overlay/TelemetryOverlay'
import { ToolPalette, type PanelId } from '@/components/panel/ToolPalette'
import { PoweredOff } from '@/components/shell/ShutdownDialog'
import { useDriveInput } from '@/input/useDriveInput'
import { readError } from '@/lib/errors'
import { useReturnHome } from '@/robot/ReturnHomeProvider'
import { useRobot } from '@/robot/RobotProvider'
import { useLiveTrail } from '@/robot/useLiveTrail'
import { useRun } from '@/robot/useRun'
import type { DefectRegion, Run } from '@/robot/types'

/**
 * The driving screen.
 *
 * The video is the floor and everything else floats on top of it, because down
 * a pipe the frame is the only thing the operator can actually see with. The
 * profile strip is the sole exception: 28 px of docked height, in exchange for
 * never covering pipe wall with the answer to "have I already surveyed this?".
 *
 * There is no on-screen d-pad. Driving is keyboard or gamepad, and the only
 * trace of a command is a transient arrow — a control that took a corner of the
 * glass to duplicate a key would be paying for it in pipe.
 */
export function LiveRoute() {
  const { client, link, telemetry, disconnect } = useRobot()
  const home = useReturnHome()

  const [zoom, setZoom] = useState(1)
  const [ledLevel, setLedLevel] = useState(0)
  const [panel, setPanel] = useState<PanelId | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
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
  // The setup panel: name, configuration, positioning and both gates. Open is
  // the only way a run ever starts.
  const [setupOpen, setSetupOpen] = useState(false)
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

  // The map draws this rather than run.path. The robot's copy only reaches the
  // console when something forces a refetch — a snapshot, a defect — so drawing
  // it live produced straight lines hinged on the markers instead of a track.
  const trail = useLiveTrail(activeRunId, telemetry?.motion.position ?? null, run?.path)

  // Driving is locked while any of these has the screen — including drawing,
  // where the operator is pointing at pipe wall rather than watching where the
  // robot is going, and a stray key would move it out from under the box.
  const modalOpen = showShortcuts || setupOpen || drawingRegion || finishing

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
      await client.request('/api/snapshot', { method: 'POST' })
      setFlash(Date.now())
      await refreshRun()
    } catch {
      // The camera can be unavailable; the alert line already says so.
    }
  }, [client, activeRunId, refreshRun])

  // The run is always closed first, even when the operator asked to shut down.
  // /api/shutdown would close it too, but doing it here means a Pi that turns
  // out to have no permission to halt still leaves a sealed run behind.
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
    [client, activeRunId, refreshRun, disconnect, runClosed],
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

  const startRun = useCallback(
    async (draft: RunDraft) => {
      if (!client) return
      setStarting(true)
      setRunError(null)
      try {
        await client.request<{ run: Run }>('/api/runs', {
          method: 'POST',
          body: JSON.stringify({
            name: draft.name,
            record: draft.record,
            origin: draft.origin,
          }),
        })
        setSetupOpen(false)
      } catch (caught) {
        setRunError(readError(caught, 'could not start the run'))
      } finally {
        setStarting(false)
      }
    },
    [client],
  )

  const drive = useDriveInput({
    client,
    // Locked whenever a command could not be trusted to arrive, or a dialog has
    // the keyboard. `armed` is the robot's own answer to "is a run open" — read
    // from telemetry rather than inferred from run.active here, so the console
    // shows the state the motors are actually in. The server enforces all of
    // this independently; the watchdog is the backstop, not the mechanism.
    enabled:
      !modalOpen &&
      link.state === 'connected' &&
      telemetry?.drive.hardware === true &&
      telemetry?.drive.armed === true,
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

  const runActive = telemetry?.run.active === true

  return (
    <div className="flex h-full flex-col bg-ink-1000">
      <section className="relative min-h-0 flex-1">
        <VideoFeed
          client={client}
          zoom={zoom}
          onZoom={setZoom}
          stale={link.state !== 'connected'}
        />

        {/* The feed is dimmed until a run is open. Nothing on screen is being
            filed against anything yet, and the picture should not look as
            authoritative as it does mid-run. */}
        {!runActive && (
          <div className="pointer-events-none absolute inset-0 z-10 bg-ink-1000/45" />
        )}

        {telemetry && (
          <>
            <DetectionBoxes detections={telemetry.detections} now={telemetry.at} />

            <div className="pointer-events-none absolute top-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-3">
              <TelemetryOverlay telemetry={telemetry} />
              <AlertBanner alert={telemetry.alert} />
              {/* Below the fault line, not in it: a return is a decision about
                  the run, and a broken sensor is a decision about the robot. */}
              {runActive && <ReturnHomeBanner />}
            </div>

            {/* Top right, opposite the readout and clear of the palette. The
                one control on the glass that ends something, so it is worded
                as the outcome rather than as a verb on the run. */}
            {runActive && (
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
              <PipeMap
                path={trail}
                motion={telemetry.motion}
                // Where the operator placed the run when they created it. The
                // robot has no GPS and could not have one down a pipe, so this
                // is the only thing that puts the track on a street.
                origin={run?.origin ?? null}
                home={home}
              />
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
                onRunChanged={() => void refreshRun()}
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
              locked={drive.locked}
              lockHint={drive.lockHint}
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
          </>
        )}

        {!runActive && !setupOpen && (
          <NoRunOverlay
            onCreate={() => {
              setRunError(null)
              setSetupOpen(true)
            }}
          />
        )}

        {setupOpen && (
          <RunSetupPanel
            client={client}
            telemetry={telemetry}
            link={link.state}
            busy={starting}
            error={runError}
            onStart={(draft) => void startRun(draft)}
            onClose={() => {
              setSetupOpen(false)
              setRunError(null)
            }}
          />
        )}

        {flash > 0 && (
          <div
            key={flash}
            className="capture-flash pointer-events-none absolute inset-0 z-40 bg-white"
          />
        )}
      </section>

      {/* Only while a run is open. With no run there is no chainage that means
          anything, and an axis of zeroes would be decoration. */}
      {telemetry && runActive && (
        <ProfileStrip
          client={client}
          run={run}
          chainage_m={telemetry.motion.chainage_m}
        />
      )}

      {showShortcuts && <ShortcutOverlay onClose={() => setShowShortcuts(false)} />}
    </div>
  )
}
