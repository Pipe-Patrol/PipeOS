import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { WarningCircle } from '@phosphor-icons/react'

import { ControlsSection } from '@/components/live/runsetup/ControlsSection'
import {
  DEFAULT_DETECTION,
  DetectionSettings,
  type DetectionDraft,
} from '@/components/live/runsetup/DetectionSettings'
import { PreflightSection } from '@/components/live/runsetup/PreflightSection'
import { SettingRow } from '@/components/live/runsetup/SettingRow'
import { SafetySection } from '@/components/live/runsetup/SafetySection'
import { SurgeRisk } from '@/components/live/runsetup/SurgeRisk'
import { blockers, buildChecks } from '@/components/live/runsetup/checks'
import { applyProbes, type ProbeReport } from '@/components/live/runsetup/probes'
import { useWeather } from '@/components/live/runsetup/useWeather'
import { EntryPointPicker } from '@/components/map/EntryPointPicker'
import type { OriginDraft } from '@/components/map/geo'
import { Button } from '@/components/primitives/Button'
import { CloseIcon } from '@/components/primitives/icons'
import { phosphorWeight } from '@/components/primitives/iconStroke'
import { NorthControl } from '@/components/settings/NorthReference'
import { applyFaults, useSimulatedFaults } from '@/dev/preflightFault'
import * as format from '@/lib/format'
import { useTempUnit } from '@/lib/units'
import type { LinkState, RobotClient } from '@/robot/client'
import type { Telemetry } from '@/robot/types'

export interface RunDraft {
  name: string
  record: boolean
  origin: OriginDraft | null
}

interface RunSetupPanelProps {
  client: RobotClient
  telemetry: Telemetry | null
  link: LinkState
  busy: boolean
  error: string | null
  onStart: (draft: RunDraft) => void
  onClose: () => void
}

/**
 * Everything that has to be true before a robot goes down a pipe, in one column.
 *
 * It is anchored to the sidebar and the status bars and runs the full height of
 * the window, rather than floating over the middle of the feed. The operator is
 * usually looking at the robot itself while they work through this, and a modal
 * that blacks out the picture takes away the one thing that tells them the
 * camera is alive before they let go of it.
 *
 * Six sections, in the order the work actually happens: name it, configure it,
 * place it, let the robot check itself, remind them how it drives, then take
 * responsibility for the parts no sensor can see. The safety acknowledgement is
 * last on purpose — it is the signature, and a signature goes at the bottom.
 */
export function RunSetupPanel({
  client,
  telemetry,
  link,
  busy,
  error,
  onStart,
  onClose,
}: RunSetupPanelProps) {
  const [unit] = useTempUnit()
  const [name, setName] = useState('')
  const [record, setRecord] = useState(true)
  // Held, shown, and thrown away on close. Nothing reads it yet — see
  // docs/DETECTION-SETTINGS.md for what wiring it up involves.
  const [detection, setDetection] = useState<DetectionDraft>(DEFAULT_DETECTION)
  const [origin, setOrigin] = useState<OriginDraft | null>(null)
  const [accepted, setAccepted] = useState(false)

  // Stamped when the panel opens, not on every render: this is the time the
  // operator started filling the form in, and it must not crawl while they do.
  const [createdAt] = useState(() => Date.now() / 1000)

  const simulated = useSimulatedFaults()
  // What the probes found when they last ran. Null until the sweep completes.
  const [probes, setProbes] = useState<ProbeReport | null>(null)
  // False until a sweep has finished. Start is held closed on it: the probes
  // exist to catch a subsystem that reports healthy and is not, and a run that
  // can begin before they land is a run that never hears the contradiction.
  const [preflightSettled, setPreflightSettled] = useState(false)
  const weather = useWeather(origin?.lat ?? null, origin?.lon ?? null)

  // Reported, then overwritten by what was actually measured, then by the dev
  // fault simulation. Later stages win, which is the order of increasing
  // certainty about what is true.
  const checks = useMemo(
    () =>
      applyFaults(applyProbes(buildChecks(telemetry, link, unit), probes), simulated),
    [telemetry, link, unit, probes, simulated],
  )
  const failed = blockers(checks)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const blocked = failed.length > 0 || !accepted || !preflightSettled || busy

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (blocked) return
    onStart({ name: name.trim(), record, origin })
  }

  // Named rather than counted. "2 checks failed" sends an operator hunting up
  // the panel; "Camera: fault" tells them what to go and look at.
  const blockedReason = !preflightSettled
    ? 'The preflight checks have to finish before this run can start.'
    : !accepted
      ? 'Confirm the safety check at the bottom of this panel to continue.'
      : null

  return (
    <form
      onSubmit={submit}
      aria-label="New run"
      className="absolute inset-y-0 left-0 z-30 flex w-[min(420px,34vw)] min-w-[340px] flex-col border-r border-ink-800 bg-ink-950/95 backdrop-blur-xl"
    >
      <header className="flex items-center justify-between gap-3 border-b border-ink-700 px-4 py-3">
        <h2 className="display text-[15px]">New run</h2>
        <div className="flex items-center gap-2">
          {simulated && (
            <span className="rounded-sm border border-state-warning-signal/40 px-1.5 py-0.5 text-[10px] text-state-warning-signal">
              Simulated faults
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-sm p-1 text-ink-500 transition-colors hover:bg-white/10 hover:text-ink-100"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section index={1} title="Information">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] text-ink-100">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={format.timestamp(createdAt)}
              className="h-9 rounded-panel border border-ink-800 bg-white/5 px-3 text-[13px] text-ink-100 placeholder:text-ink-500 focus:border-white/35 focus:outline-none"
            />
          </label>
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-ink-100">Created</span>
            <span className="text-[12px] tnum text-ink-200">
              {format.timestamp(createdAt)}
            </span>
          </div>
        </Section>

        <Section index={2} title="Configuration">
          <div className="flex flex-col gap-2.5">
            <SettingRow
              label="Record video"
              hint="Video is saved onto the robot SD card."
            >
              <input
                type="checkbox"
                checked={record}
                onChange={(event) => setRecord(event.target.checked)}
                className="accent-white"
              />
            </SettingRow>

            <DetectionSettings value={detection} onChange={setDetection} />
          </div>
        </Section>

        <Section index={3} title="Positioning">
          <EntryPointPicker value={origin} onChange={setOrigin} />

          <SurgeRisk weather={weather} placed={origin !== null} />

          <div className="mt-3 border-t border-ink-800 pt-3">
            <NorthControl client={client} orientation={telemetry?.orientation ?? null} />
          </div>
        </Section>

        <Section index={4} title="Preflight check">
          <PreflightSection
            client={client}
            checks={checks}
            onProbeReport={setProbes}
            onSettledChange={setPreflightSettled}
            runActive={telemetry?.run.active === true}
          />
        </Section>

        <Section index={5} title="Controls">
          <ControlsSection />
        </Section>

        <Section index={6} title="Safety check">
          <SafetySection accepted={accepted} onAccept={setAccepted} />
        </Section>
      </div>

      <footer className="border-t border-ink-700 px-4 py-3">
        {failed.length > 0 && (
          <div className="mb-2.5 flex gap-2.5 rounded-panel border border-state-fault-signal/45 bg-state-fault-signal/10 px-3 py-2.5">
            <span className="mt-px shrink-0 text-state-fault-signal" aria-hidden>
              <WarningCircle size={16} weight={phosphorWeight(16)} />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-state-fault-signal">
                This run cannot be started
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {failed.map((check) => (
                  <li key={check.id} className="text-[11.5px] leading-[16px] text-ink-200">
                    {check.label}: {check.value.toLowerCase()}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {error && <p className="mb-2 text-[12px] text-state-fault-signal">{error}</p>}
        {!error && failed.length === 0 && blockedReason && (
          <p className="mb-2 text-[11.5px] text-ink-400">{blockedReason}</p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={blocked}
          className="w-full"
        >
          {busy ? 'Starting' : 'Start run'}
        </Button>
      </footer>
    </form>
  )
}

/**
 * One numbered step, with a rail running from its circle to the section below.
 *
 * The rail is doing real work in a column this tall: it is what tells an
 * operator scrolled halfway into the preflight list that they are still inside
 * step four, rather than reading a loose list of rows.
 */
function Section({
  index,
  title,
  children,
}: {
  index: number
  title: string
  children: ReactNode
}) {
  return (
    <section className="px-4 py-4">
      <div className="flex gap-3">
        <div className="flex w-[22px] shrink-0 flex-col items-center">
          <span className="flex size-[22px] items-center justify-center rounded-full border border-ink-500 text-[11px] tnum text-ink-200">
            {index}
          </span>
          <span aria-hidden className="mt-1.5 w-px flex-1 bg-ink-700" />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="display mb-3 flex h-[22px] items-center text-[13px] text-ink-100">
            {title}
          </h3>
          {children}
        </div>
      </div>
    </section>
  )
}
