import { useState } from 'react'
import { Navigate } from 'react-router-dom'

import { Page } from '@/components/shell/Page'
import { ShortcutList } from '@/components/live/ShortcutList'
import { Button } from '@/components/primitives/Button'
import { NorthReference } from '@/components/settings/NorthReference'
import { PoweredOff, ShutdownDialog } from '@/components/shell/ShutdownDialog'
import * as format from '@/lib/format'
import { useTempUnit } from '@/lib/units'
import { useRobot } from '@/robot/RobotProvider'

/**
 * What this robot is, and what it cannot tell you.
 *
 * The unavailable list is the part worth having a screen for. It is read from
 * the robot rather than hardcoded, so fitting a sensor changes what an operator
 * sees without a console release.
 */
export function SettingsRoute() {
  const { client, health, telemetry, disconnect } = useRobot()
  const [confirming, setConfirming] = useState(false)
  const [halted, setHalted] = useState(false)
  const [unit, setUnit] = useTempUnit()

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
      <section className="panel p-4">
        <h2 className="label mb-3">Robot</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Field label="Host" value={health?.hostname ?? '—'} />
          <Field label="Address" value={client.httpBase} />
          <Field label="Version" value={health?.version ?? '—'} />
          <Field
            label="Uptime"
            value={format.duration(telemetry?.host.uptime_s ?? null)}
          />
        </dl>
      </section>

      <section className="panel p-4">
        <h2 className="label mb-3">Hardware</h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {health &&
            Object.entries(health.capabilities).map(([name, present]) => (
              <li key={name} className="flex items-center gap-2 text-[13px]">
                <span
                  className={`h-2 w-2 rounded-full ${present ? 'bg-state-recording-signal' : 'bg-text-faint'}`}
                />
                <span className={present ? 'text-ink-100' : 'text-ink-500'}>
                  {name.replace(/_/g, ' ')}
                </span>
              </li>
            ))}
        </ul>
      </section>

      {health && health.unavailable.length > 0 && (
        <section className="panel p-4">
          <h2 className="label mb-3">Not fitted</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {health.unavailable.map((sensor) => (
              <li key={sensor} className="text-[13px] text-ink-500">
                {sensor.replace(/_/g, ' ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      <NorthReference client={client} orientation={telemetry?.orientation ?? null} />

      {/* The reference copy. `?` puts the same list over the video mid-run;
          this is where someone reads it before they are driving. */}
      <section className="panel p-4">
        <h2 className="label mb-3">Shortcuts</h2>
        <ShortcutList />
      </section>

      <section className="panel p-4">
        <h2 className="label mb-3">Storage</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Field
            label="Free"
            value={format.bytes(telemetry?.host.storage?.free_bytes ?? null)}
          />
          <Field
            label="Used"
            value={format.percent(telemetry?.host.storage?.used_pct ?? null)}
          />
          <Field label="Camera" value={telemetry?.camera.resolution ?? 'unavailable'} />
        </dl>
      </section>

      <section className="panel p-4">
        <h2 className="label mb-3">Console</h2>

        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="label">Temperature</div>
            <p className="mt-1 text-[12px] text-ink-500">
              Display only. Readings are recorded in Celsius either way.
            </p>
          </div>
          <div className="flex shrink-0 rounded-panel border border-ink-800 p-0.5">
            {(['C', 'F'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={unit === option}
                onClick={() => setUnit(option)}
                className={`tnum h-8 w-12 rounded-[6px] text-[13px] transition-colors ${
                  unit === option
                    ? 'bg-white/16 text-ink-0'
                    : 'text-ink-400 hover:bg-white/8 hover:text-ink-100'
                }`}
              >
                °{option}
              </button>
            ))}
          </div>
        </div>
      </section>

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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className="mt-1 truncate text-[13px]">{value}</dd>
    </div>
  )
}
