import { useCallback, useEffect, useRef, useState } from 'react'

import { DemoFeed } from '@/components/demo/DemoFeed'
import { DemoPanel } from '@/components/demo/DemoPanel'
import { useDemoDetections } from '@/components/demo/useDemoDetections'
import { FinishRunPrompt } from '@/components/live/FinishRunPrompt'
import { NoRunOverlay } from '@/components/live/NoRunOverlay'
import { RegionDrawer } from '@/components/live/RegionDrawer'
import { RunSetupPanel, type RunDraft } from '@/components/live/runsetup/RunSetupPanel'
import { ShortcutOverlay } from '@/components/live/ShortcutOverlay'
import { VideoFeed } from '@/components/live/VideoFeed'
import { ZoomControl } from '@/components/live/ZoomControl'
import { PipeMap } from '@/components/map/PipeMap'
import { ProfileStrip } from '@/components/profile/ProfileStrip'
import { DetectionBoxes } from '@/components/overlay/DetectionBoxes'
import { DirectionArrow } from '@/components/overlay/DirectionArrow'
import { FlowPoints } from '@/components/overlay/FlowPoints'
import { MarkerBoxes } from '@/components/overlay/MarkerBoxes'
import { ReturnHomeBanner } from '@/components/overlay/ReturnHomeBanner'
import { TelemetryOverlay } from '@/components/overlay/TelemetryOverlay'
import { ToolPalette, type PanelId } from '@/components/panel/ToolPalette'
import { FinishIcon } from '@/components/primitives/icons'
import { PoweredOff } from '@/components/shell/ShutdownDialog'
import { useDriveInput } from '@/input/useDriveInput'
import { DEFECT_TYPES } from '@/constants/defects'
import { detectionClassOf } from '@/constants/detection-classes'
import { readError } from '@/lib/errors'
import { useFeedBounds } from '@/lib/feedBounds'
import { clearNotice, raiseNotice } from '@/lib/notices'
import { useDemoMode } from '@/lib/demoMode'
import { usePreferences } from '@/lib/preferences'
import { useDemoShortcuts } from '@/lib/useDemoShortcuts'
import { regionFromBox } from '@/lib/region'
import { useReturnHome } from '@/robot/ReturnHomeProvider'
import { useRobot } from '@/robot/RobotProvider'
import { useAutoFlag } from '@/robot/useAutoFlag'
import { describeSpike, useClimateSpikes } from '@/robot/useClimateSpikes'
import { useLiveTrail } from '@/robot/useLiveTrail'
import { useRun } from '@/robot/useRun'
import type { DefectRegion, Detection, Run } from '@/robot/types'

/** A key typed into a field is not a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  )
}

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
  const prefs = usePreferences()
  const demo = useDemoMode()
  useDemoShortcuts(demo.enabled)

  // The footage on screen, and the model's own reading of it. In demo mode the
  // frames never reach the Pi on their own, so they are posted to it.
  const demoRef = useRef<HTMLDivElement>(null)
  const demoSource = demo.sources.find((entry) => entry.id === demo.activeId) ?? null
  const demoDetections = useDemoDetections(client, demoSource, demoRef, demo.enabled)

  const [zoom, setZoom] = useState(1)
  const [ledLevel, setLedLevel] = useState(0)
  const [panel, setPanel] = useState<PanelId | null>(null)
  // Auto mode: the model and the air sensor file defects without being asked.
  // Off on every load — an autonomous behaviour that survives a page reload is
  // one nobody remembers switching on.
  const [autoMode, setAutoMode] = useState(false)
  /**
   * What the defect panel should open already holding.
   *
   * Set by the two things that know what the defect is before the operator
   * says so: a box on the feed the model drew, and an air spike. Both have
   * already done the work of deciding, and asking for it again in the panel
   * would be asking twice.
   */
  const [prefill, setPrefill] = useState<{ code?: string; note?: string } | null>(null)
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
  // The class chosen in the defect panel, carried here so the box being dragged
  // on the feed is already the colour it will be saved in.
  const [drawingRegion, setDrawingRegion] = useState<{
    className: string
    label: string
  } | null>(null)

  // The feed's height, published for every panel to cap itself against.
  const feedRef = useRef<HTMLElement>(null)
  useFeedBounds(feedRef)

  // Stamped here, where the box is actually committed, so the panel's still
  // freezes on one frame instead of chasing the region in an effect.
  const clearPrefill = useCallback(() => setPrefill(null), [])

  const markRegion = useCallback((region: DefectRegion | null) => {
    setDefectRegion(region)
    if (region) setDefectRegionMarkedAt(Date.now())
  }, [])

  const activeRunId = telemetry?.run.active ? telemetry.run.id : null
  const runActive = activeRunId !== null
  const { run, refresh: refreshRun } = useRun(client, activeRunId)

  /**
   * Finishing a run puts the screen back to how it opens.
   *
   * Everything below outlives a run on its own — none of it is keyed on the run
   * id — so after finishing one the console kept a half-filled defect form, a
   * box drawn on pipe that is no longer in front of the robot, a panel open
   * over nothing, and auto flagging still armed for the next run nobody had
   * started yet. The map and the longitudinal strip already reset themselves
   * from the run id; this is everything that does not.
   */
  const lastRunId = useRef(activeRunId)
  useEffect(() => {
    if (lastRunId.current === activeRunId) return
    lastRunId.current = activeRunId
    setDefectRegion(null)
    setDefectRegionMarkedAt(0)
    setDrawingRegion(null)
    setPrefill(null)
    setPanel(null)
    setZoom(1)
    setAutoMode(false)
    setRunError(null)
    setEndError(null)
  }, [activeRunId])

  const spikes = useClimateSpikes(telemetry?.climate ?? null, {
    temperature: prefs.spikeTemperatureC,
    humidity: prefs.spikeHumidityPct,
    enabled: prefs.spikeWarnings,
  })

  // Filtered here rather than in the overlay, so auto flagging and the Enter
  // key act on exactly what the operator can see. A class muted in settings is
  // one the console has been told not to raise, and raising it silently would
  // be worse than not drawing it.
  const visibleDetections = (
    demo.enabled ? demoDetections : (telemetry?.detections ?? [])
  ).filter(
    (detection) =>
      detection.confidence >= prefs.detectionThreshold &&
      !prefs.mutedClasses.includes(detectionClassOf(detection.label)?.name ?? ''),
  )

  /**
   * Accept a box the model drew: open the flag form with its class and its
   * region already in place.
   *
   * The model has done the two things that take the longest — deciding what it
   * is and drawing where it is — so this keeps both rather than dropping the
   * operator into an empty form beside a box it already got right.
   */
  const flagDetection = useCallback((detection: Detection) => {
    const type = detectionClassOf(detection.label)
    const entry = DEFECT_TYPES.find((candidate) => candidate.className === type?.name)
    markRegion(regionFromBox(detection.box))
    setPrefill({
      code: entry?.code,
      note: `Model — ${Math.round(detection.confidence * 100)}% confident`,
    })
    setPanel('defects')
  }, [markRegion])

  useAutoFlag({
    client,
    enabled: autoMode,
    run,
    motion: telemetry?.motion ?? null,
    detections: visibleDetections,
    spikes: prefs.autoFlagOnSpikes ? spikes.active : [],
    threshold: prefs.autoFlagThreshold,
    cooldownM: prefs.autoFlagCooldownM,
    onLogged: refreshRun,
  })

  // The map draws this rather than run.path. The robot's copy only reaches the
  // console when something forces a refetch — a snapshot, a defect — so drawing
  // it live produced straight lines hinged on the markers instead of a track.
  const trail = useLiveTrail(activeRunId, telemetry?.motion.position ?? null, run?.path)

  // Driving is locked while any of these has the screen — including drawing,
  // where the operator is pointing at pipe wall rather than watching where the
  // robot is going, and a stray key would move it out from under the box.
  const modalOpen = showShortcuts || setupOpen || drawingRegion !== null || finishing

  const startDrawingRegion = useCallback((className: string, label: string) => {
    // Always draw at 1x. Screen-to-frame mapping assumes the whole frame is on
    // show, so a box drawn while zoomed in would be filed against the wrong
    // part of the picture — and silently, which is the worst kind of wrong.
    setZoom(1)
    setDrawingRegion({ className, label })
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

  // Both failures an operator cannot see the cause of. They go to the one bar
  // above the status bar rather than being drawn next to the button that
  // failed, which is the rule everywhere: errors live in one place.
  useEffect(() => {
    if (runError) raiseNotice('run-start', 'fault', runError)
    else clearNotice('run-start')
  }, [runError])

  useEffect(() => {
    if (endError) raiseNotice('run-end', 'fault', endError)
    else clearNotice('run-end')
  }, [endError])

  /**
   * A sudden change in the air, as a prompt rather than a report.
   *
   * The bar says what moved; the button opens the defect panel with the note
   * already written, because the operator is driving and the useful half of
   * "humidity jumped 12%" is being able to file it without typing. In auto mode
   * it has already been filed, so the bar just says so.
   */
  const spike = spikes.active[0] ?? null
  useEffect(() => {
    if (!spike) {
      clearNotice('climate-spike')
      return
    }
    raiseNotice(
      'climate-spike',
      'warning',
      describeSpike(spike),
      autoMode
        ? undefined
        : {
            label: 'Flag it',
            run: () => {
              setPrefill({ note: describeSpike(spike) })
              setPanel('defects')
              spikes.dismiss(spike.channel)
            },
          },
    )
  }, [spike, autoMode, spikes])

  useEffect(() => () => clearNotice('climate-spike'), [])

  /**
   * Something in the way.
   *
   * The model has an `obstruction` class, so this is the model's own answer
   * rather than a second estimator inferring one — and it goes to the notice
   * bar with everything else rather than becoming a special case on the glass.
   */
  const obstruction = visibleDetections.find(
    (detection) => detectionClassOf(detection.label)?.name === 'obstruction',
  )
  useEffect(() => {
    if (!obstruction) {
      clearNotice('obstruction')
      return
    }
    raiseNotice(
      'obstruction',
      'warning',
      `Obstruction ahead — ${Math.round(obstruction.confidence * 100)}% confident`,
      autoMode ? undefined : { label: 'Flag it', run: () => flagDetection(obstruction) },
    )
  }, [obstruction, autoMode, flagDetection])

  useEffect(() => () => clearNotice('obstruction'), [])

  /**
   * Enter files the box the model is most sure about.
   *
   * Driving is a two-handed job and the mouse is the hand that is not on the
   * throttle. The most confident box is nearly always the one the operator
   * would have clicked, so it is worth a key.
   */
  useEffect(() => {
    if (modalOpen || !runActive || autoMode) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat) return
      if (isTyping(event.target)) return
      const best = visibleDetections
        .filter((detection) => detection.box !== null)
        .sort((a, b) => b.confidence - a.confidence)[0]
      if (!best) return
      event.preventDefault()
      flagDetection(best)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => () => {
    clearNotice('run-start')
    clearNotice('run-end')
  }, [])

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
      <section ref={feedRef} className="relative min-h-0 flex-1">
        {demo.enabled && demoSource ? (
          <div ref={demoRef} className="absolute inset-0 overflow-hidden bg-black">
            <DemoFeed
              source={demoSource}
              chainage_m={telemetry?.motion.chainage_m ?? 0}
              secondsPerMetre={demo.secondsPerMetre}
            />
          </div>
        ) : (
          <VideoFeed
            client={client}
            zoom={zoom}
            onZoom={setZoom}
            stale={link.state !== 'connected'}
          />
        )}

        {/* The feed is dimmed until a run is open. Nothing on screen is being
            filed against anything yet, and the picture should not look as
            authoritative as it does mid-run. */}
        {!runActive && (
          <div className="pointer-events-none absolute inset-0 z-10 bg-ink-1000/45" />
        )}

        {telemetry && (
          <>
            {prefs.showDetections && (
              <DetectionBoxes
                detections={visibleDetections}
                now={telemetry.at}
                onFlag={runActive && !autoMode ? flagDetection : undefined}
              />
            )}

            {/* The features the distance estimate is actually following. Off by
                default: it is the working, not the answer. */}
            {prefs.showFlowPoints && <FlowPoints points={telemetry.motion.flow_points} />}

            {/* Defects already filed on this run, drawn back on as the robot
                passes the chainage they were logged at. */}
            {run && prefs.showMarkers && (
              <MarkerBoxes
                defects={run.defects}
                chainage_m={telemetry.motion.chainage_m}
                range_m={prefs.markerRangeM}
              />
            )}

            {/* Nothing that has gone wrong is drawn here. The robot's alert
                line goes to the notice bar above the status bar with everything
                else; a return is not a fault, so it stays. */}
            <div className="pointer-events-none absolute top-6 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-3">
              {prefs.showTelemetry && (
                <TelemetryOverlay
                  telemetry={telemetry}
                  spiking={{
                    temperature: spikes.temperature !== null,
                    humidity: spikes.humidity !== null,
                  }}
                />
              )}
              {/* A mode that keeps filing defects after the operator has
                  stopped thinking about it has to say so on the glass, not
                  only as a lit button in the rail. */}
              {autoMode && runActive && (
                <span className="overlay-shadow rounded-panel border border-state-recording-signal/25 bg-state-recording-signal/15 px-2 py-0.5 text-[11px] font-semibold tracking-[0.08em] text-state-recording-signal uppercase">
                  Auto flagging
                </span>
              )}

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
                className="panel absolute top-5 right-5 z-10 flex size-9 items-center justify-center rounded-panel text-ink-200 transition-colors hover:bg-white/10 hover:text-ink-0"
                title="Finish the run"
                aria-label="Finish the run"
              >
                <FinishIcon size={18} weight={0.95} />
              </button>
            )}

            {demo.enabled && (
              <div className="absolute bottom-5 left-5 z-20">
                <DemoPanel />
              </div>
            )}

            {prefs.showMap && !demo.enabled && (
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
            )}

            {prefs.showZoom && (
              <div className="absolute right-5 bottom-5 z-10">
                <ZoomControl zoom={zoom} onZoom={setZoom} />
              </div>
            )}

            {/* Hidden, not unmounted, while the box is being drawn: the panel
                holds a half-filled defect form and unmounting would throw away
                the code, severity and note the operator already chose. */}
            {/* z-50: the tool rail and its panels are the top layer, above
                every overlay on the video. See Popover. */}
            <div
              className={`absolute top-1/2 right-5 z-50 -translate-y-1/2 ${
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
                drawingRegion={drawingRegion !== null}
                defectRegion={defectRegion}
                defectRegionMarkedAt={defectRegionMarkedAt}
                onDefectRegionChange={markRegion}
                onDrawDefectRegion={startDrawingRegion}
                autoMode={autoMode}
                onAutoMode={setAutoMode}
                spiking={spikes.active.length > 0}
                prefill={prefill}
                onPrefillUsed={clearPrefill}
              />
            </div>

            {drawingRegion && (
              <RegionDrawer
                className={drawingRegion.className}
                label={drawingRegion.label}
                onCommit={(region) => {
                  markRegion(region)
                  setDrawingRegion(null)
                }}
                onCancel={() => setDrawingRegion(null)}
              />
            )}

            {prefs.showDirection && (
            <DirectionArrow
              direction={drive.direction}
              source={drive.source}
              throttle={drive.throttle}
              locked={drive.locked}
              lockHint={drive.lockHint}
            />
            )}

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
      {telemetry && runActive && prefs.showProfile && (
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
