import { useState } from 'react'
import { Navigate } from 'react-router-dom'

import { GamepadGuide } from '@/components/live/GamepadGuide'
import { ShortcutList } from '@/components/live/ShortcutList'
import { Button } from '@/components/primitives/Button'
import { Choice, Fact, Range, Row, Section, Toggle } from '@/components/settings/controls'
import { DetectionHost } from '@/components/settings/DetectionHost'
import { ModelSettings } from '@/components/settings/ModelSettings'
import { NorthReference } from '@/components/settings/NorthReference'
import { Page } from '@/components/shell/Page'
import { PoweredOff, ShutdownDialog } from '@/components/shell/ShutdownDialog'
import { readError } from '@/lib/errors'
import * as format from '@/lib/format'
import { resetPreferences, setPreference, usePreferences } from '@/lib/preferences'
import { useTempUnit } from '@/lib/units'
import { useRobot } from '@/robot/RobotProvider'

/**
 * What the operator can change, and what the robot is.
 *
 * ORDERED BY HOW OFTEN IT IS TOUCHED, not by how the code is filed. The screen
 * used to open on the robot's hostname and version — facts nobody comes here to
 * read — and buried the one control it had at the bottom. Now the things that
 * change what the console does come first, and the robot's own description is
 * at the end where a reference belongs.
 *
 * ALMOST EVERY SETTING IS ON THE DEVICE, and none of the device ones change what
 * gets recorded: hiding a panel hides a panel, and muting a class stops it being
 * drawn rather than stopping it being detected. That is what makes it safe to
 * turn things off without weighing up whether the survey suffers for it.
 *
 * The exception is Detection host, which is a robot setting and is kept in its
 * own section for exactly that reason — it is the address the robot posts frames
 * to for inference, and getting it wrong means no detections at all.
 */
export function SettingsRoute() {
  const { client, health, telemetry, disconnect } = useRobot()
  const [confirming, setConfirming] = useState(false)
  const [halted, setHalted] = useState(false)
  const [unit, setUnit] = useTempUnit()
  const prefs = usePreferences()
  const [wiping, setWiping] = useState(false)
  const [wipeResult, setWipeResult] = useState<string | null>(null)

  /**
   * Delete every clip on the robot, keeping every run.
   *
   * The bulk version of the per-run button on a run's own page, for the case
   * that actually happens: a card that is full now, where clearing it run by
   * run is a dozen confirmations deep. It never touches defects, captures or
   * paths -- the inspection record is small and is the part anybody is going to
   * be asked for.
   *
   * Confirmed, and deliberately not undoable-looking: there is no undo on an SD
   * card, and a button that implied otherwise would be the lie.
   */
  const wipeVideo = async () => {
    if (!client) return
    if (
      !window.confirm(
        'Delete the video from every run on this robot?\n\n' +
          'Defects, captures and paths are kept. The video files cannot be recovered.',
      )
    ) {
      return
    }
    setWiping(true)
    try {
      const body = await client.request<{
        runs: number
        deleted: number
        freed_bytes: number
      }>('/api/runs/recordings', { method: 'DELETE' })
      setWipeResult(
        body.deleted === 0
          ? 'Nothing to delete'
          : `${body.deleted} clip${body.deleted === 1 ? '' : 's'} from ${body.runs} run${
              body.runs === 1 ? '' : 's'
            } · ${format.bytes(body.freed_bytes)} freed`,
      )
    } catch (caught) {
      setWipeResult(readError(caught, 'could not delete the video'))
    } finally {
      setWiping(false)
    }
  }

  // Checked before the client guard on purpose. Halting clears the client, and
  // being bounced to the connect picker mid-shutdown would take away the one
  // instruction that keeps the card intact.
  if (halted) return <PoweredOff />

  if (!client) return <Navigate to="/connect" replace />

  return (
    <Page
      title="Settings"
      actions={
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Shut down
        </Button>
      }
    >
      <Section
        title="Driving screen"
        description="What is drawn over the video. Hiding something never stops it being recorded."
      >
        <Row label="Map" hint="The track over the street, bottom left">
          <Toggle
            label="Map"
            checked={prefs.showMap}
            onChange={(next) => setPreference('showMap', next)}
          />
        </Row>
        <Row label="Longitudinal view" hint="The ruled strip under the video">
          <Toggle
            label="Longitudinal view"
            checked={prefs.showProfile}
            onChange={(next) => setPreference('showProfile', next)}
          />
        </Row>
        <Row label="Telemetry readout" hint="Distance, run clock, air and humidity">
          <Toggle
            label="Telemetry readout"
            checked={prefs.showTelemetry}
            onChange={(next) => setPreference('showTelemetry', next)}
          />
        </Row>
        <Row label="Return budget bar" hint="Used, Left and RTH under the status bar">
          <Toggle
            label="Return budget bar"
            checked={prefs.showBudget}
            onChange={(next) => setPreference('showBudget', next)}
          />
        </Row>
        <Row label="Zoom control" hint="The corner buttons. Scroll and pinch still work">
          <Toggle
            label="Zoom control"
            checked={prefs.showZoom}
            onChange={(next) => setPreference('showZoom', next)}
          />
        </Row>
        <Row label="Direction arrow" hint="The throttle indicator under the video">
          <Toggle
            label="Direction arrow"
            checked={prefs.showDirection}
            onChange={(next) => setPreference('showDirection', next)}
          />
        </Row>
      </Section>

      <ModelSettings />

      <DetectionHost />

      <Section
        title="Auto flagging"
        description="What the robot files without being asked, in auto mode."
      >
        <Row
          label="Confidence floor"
          hint="Auto mode will not file anything it is less sure of than this"
        >
          <Range
            label="Auto flagging confidence floor"
            value={prefs.autoFlagThreshold}
            min={0.3}
            max={0.95}
            step={0.05}
            display={`${Math.round(prefs.autoFlagThreshold * 100)}%`}
            onChange={(next) => setPreference('autoFlagThreshold', next)}
          />
        </Row>
        <Row
          label="Spacing"
          hint="The same class is not filed twice inside this distance"
        >
          <Range
            label="Auto flagging spacing"
            value={prefs.autoFlagCooldownM}
            min={0.5}
            max={10}
            step={0.5}
            display={`${prefs.autoFlagCooldownM.toFixed(1)} m`}
            onChange={(next) => setPreference('autoFlagCooldownM', next)}
          />
        </Row>
        <Row label="File air spikes" hint="A sudden change in temperature or humidity">
          <Toggle
            label="File air spikes"
            checked={prefs.autoFlagOnSpikes}
            onChange={(next) => setPreference('autoFlagOnSpikes', next)}
          />
        </Row>
      </Section>

      <Section
        title="Air warnings"
        description="A step change in the air means something entered the pipe. These are how big a step counts."
      >
        <Row label="Warn on spikes" hint="Turns the reading red and offers a flag">
          <Toggle
            label="Warn on spikes"
            checked={prefs.spikeWarnings}
            onChange={(next) => setPreference('spikeWarnings', next)}
          />
        </Row>
        <Row label="Temperature step" hint="Measured against the last 90 seconds">
          <Range
            label="Temperature step"
            value={prefs.spikeTemperatureC}
            min={0.5}
            max={10}
            step={0.5}
            display={`${prefs.spikeTemperatureC.toFixed(1)} °C`}
            onChange={(next) => setPreference('spikeTemperatureC', next)}
          />
        </Row>
        <Row label="Humidity step" hint="Percentage points, same window">
          <Range
            label="Humidity step"
            value={prefs.spikeHumidityPct}
            min={2}
            max={30}
            step={1}
            display={`${prefs.spikeHumidityPct} %`}
            onChange={(next) => setPreference('spikeHumidityPct', next)}
          />
        </Row>
      </Section>

      <Section
        title="Distance"
        description="Distance is measured from the picture — see MODEL.md. These show the working."
      >
        <Row
          label="Show tracking points"
          hint="The features the distance estimate is following, drawn on the video"
        >
          <Toggle
            label="Show tracking points"
            checked={prefs.showFlowPoints}
            onChange={(next) => setPreference('showFlowPoints', next)}
          />
        </Row>
        <Fact
          label="Source"
          value={telemetry?.motion.source ?? format.BLANK}
        />
        <Fact
          label="Uncertainty"
          value={format.metres(telemetry?.motion.uncertainty_m ?? null)}
        />
      </Section>

      <Section
        title="Logged defects"
        description="Defects already filed on this run, drawn back onto the video as you pass them."
      >
        <Row label="Show past defects" hint="Their boxes reappear at the right chainage">
          <Toggle
            label="Show past defects"
            checked={prefs.showMarkers}
            onChange={(next) => setPreference('showMarkers', next)}
          />
        </Row>
        <Row label="Range" hint="How far either side of a defect its box is drawn">
          <Range
            label="Marker range"
            value={prefs.markerRangeM}
            min={0.2}
            max={5}
            step={0.2}
            display={`${prefs.markerRangeM.toFixed(1)} m`}
            onChange={(next) => setPreference('markerRangeM', next)}
          />
        </Row>
      </Section>

      <Section title="Units">
        <Row
          label="Temperature"
          hint="Display only. Readings are recorded in Celsius either way."
        >
          <Choice
            value={unit}
            onChange={setUnit}
            options={[
              { value: 'C', label: '°C' },
              { value: 'F', label: '°F' },
            ]}
          />
        </Row>
      </Section>

      <Section
        title="North reference"
        description="Without one the track cannot be placed on a map — the IMU has no magnetometer."
      >
        <div className="px-4 py-3">
          <NorthReference client={client} orientation={telemetry?.orientation ?? null} />
        </div>
      </Section>

      {/* The reference copy. `?` puts the same list over the video mid-run;
          this is where someone reads it before they are driving. */}
      <Section
        title="Storage"
        description="Video is almost all of what the card holds. Deleting it keeps every run, its defects and its captures."
      >
        <Row
          label="Delete all video"
          hint="Every clip of every run, on the robot. There is no undo."
        >
          <button
            type="button"
            disabled={wiping}
            onClick={() => void wipeVideo()}
            className="rounded-sm px-2 py-1 text-[12px] text-ink-300 transition-colors hover:bg-white/8 hover:text-state-fault-signal disabled:opacity-40"
          >
            {wiping ? 'Deleting…' : 'Delete all video'}
          </button>
        </Row>
        {wipeResult && <Fact label="Last wipe" value={wipeResult} />}
      </Section>

      <Section title="Shortcuts">
        <div className="px-4 py-3">
          <ShortcutList />
        </div>
      </Section>

      <Section
        title="Controller"
        description="The pad layout, for driving without a keyboard."
      >
        <div className="px-4 py-3">
          <GamepadGuide />
        </div>
      </Section>

      <Section title="Robot" description="What is fitted, and what is not.">
        <Fact label="Host" value={health?.hostname ?? format.BLANK} />
        <Fact label="Address" value={client.httpBase} />
        <Fact label="Version" value={health?.version ?? format.BLANK} />
        <Fact
          label="Uptime"
          value={format.duration(telemetry?.host.uptime_s ?? null)}
        />
        <Fact label="Camera" value={telemetry?.camera.resolution ?? 'unavailable'} />
        <Fact
          label="Storage free"
          value={format.bytes(telemetry?.host.storage?.free_bytes ?? null)}
        />

        {health && (
          <div className="px-4 py-3">
            <div className="label mb-2">Hardware</div>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
              {Object.entries(health.capabilities).map(([name, present]) => (
                <li key={name} className="flex items-center gap-2 text-[12.5px]">
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      present ? 'bg-state-recording-signal' : 'bg-ink-600'
                    }`}
                  />
                  <span className={present ? 'text-ink-100' : 'text-ink-500'}>
                    {name.replace(/_/g, ' ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {health && health.unavailable.length > 0 && (
          <div className="px-4 py-3">
            <div className="label mb-2">Not fitted</div>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
              {health.unavailable.map((sensor) => (
                <li key={sensor} className="text-[12.5px] text-ink-500">
                  {sensor.replace(/_/g, ' ')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <div className="flex justify-end pb-2">
        <button
          type="button"
          onClick={resetPreferences}
          className="text-[12px] text-ink-500 underline underline-offset-2 transition-colors hover:text-ink-100"
        >
          Reset every setting on this device
        </button>
      </div>

      {confirming && (
        <ShutdownDialog
          client={client}
          onCancel={() => setConfirming(false)}
          onDisconnect={() => {
            setConfirming(false)
            disconnect()
          }}
          onHalted={() => {
            setConfirming(false)
            setHalted(true)
            // Stop the client reconnecting to a Pi that is on its way down —
            // otherwise the banner spends the next minute claiming the link
            // failed, which reads as a fault rather than a shutdown.
            disconnect()
          }}
        />
      )}
    </Page>
  )
}
