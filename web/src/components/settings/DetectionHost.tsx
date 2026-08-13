import { useCallback, useEffect, useState } from 'react'

import { Row, Section } from '@/components/settings/controls'
import { useRobot } from '@/robot/RobotProvider'

interface ModelChoice {
  id: string
  label: string
  note: string
  available: boolean
  error: string | null
  selected: boolean
}

interface ModelCatalogue {
  models: ModelChoice[]
  model_id?: string | null
  error?: string | null
}

interface DetectorHost {
  /** In force now: the operator's override if there is one, else `deployed`. */
  url: string
  /** What deploy.sh baked in — what clearing the field falls back to. */
  deployed: string
  backend: string
  available: boolean
  error: string | null
}

/**
 * Where the defect model runs — which is not on the robot.
 *
 * THE ONE SETTING ON THIS SCREEN THAT LEAVES THE DEVICE. Everything else here
 * is a preference about drawing; this changes what the robot does, so it is
 * deliberately in its own section rather than mixed in with the toggles, and it
 * reports back what the robot made of the address rather than just accepting it.
 *
 * WHY IT IS EDITABLE AT ALL. The deploy writes in the address of the laptop
 * that ran it, which is a guess about a DHCP lease. Move to a different network,
 * or serve the model from a different machine, and the robot is pointed at
 * nothing — with no way to fix it short of a redeploy, on a robot that may be
 * forty metres into a pipe. This is that way.
 *
 * The error line is the useful half of the widget: "cannot reach 10.0.0.4:8600"
 * tells an operator their laptop is asleep or on the wrong network, where a bare
 * "detection unavailable" sends them looking at the robot.
 */
export function DetectionHost() {
  const { client } = useRobot()
  const [host, setHost] = useState<DetectorHost | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!client) return
    let live = true
    client
      .request<DetectorHost>('/api/detector-host')
      .then((next) => {
        if (!live) return
        setHost(next)
        setDraft(next.url)
      })
      .catch(() => {
        // An older robot has no such endpoint. Leaving the section blank is
        // better than an error about a feature that build does not have.
        if (live) setHost(null)
      })
    return () => {
      live = false
    }
  }, [client])

  if (!client || !host) return null

  const save = async () => {
    setSaving(true)
    setFailure(null)
    try {
      const next = await client.request<DetectorHost>('/api/detector-host', {
        method: 'POST',
        body: JSON.stringify({ url: draft.trim() }),
      })
      setHost(next)
      setDraft(next.url)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'could not save')
    } finally {
      setSaving(false)
    }
  }

  const dirty = draft.trim() !== host.url
  // A configured host that is answering. `available` alone only says one is set.
  const healthy = host.available && !host.error

  return (
    <Section
      title="Detection host"
      description="The machine running the model. The robot does not run it — it posts frames here."
    >
      <Row
        label="Address"
        hint="A hostname or IP. Port defaults to 8600. Empty turns detection off."
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={host.deployed || '192.168.1.20:8600'}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && dirty) void save()
            }}
            className="w-52 rounded-sm border border-white/12 bg-black/30 px-2 py-1 text-[12.5px] text-ink-100 outline-none focus:border-white/30"
            aria-label="Detection host address"
          />
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void save()}
            className="rounded-sm px-2 py-1 text-[12px] text-ink-300 transition-colors hover:bg-white/8 hover:text-ink-0 disabled:opacity-35 disabled:hover:bg-transparent"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Row>

      <Row label="Status" hint="Refreshed when this screen opens and after a save">
        <span
          className={`text-[12.5px] ${healthy ? 'text-ink-100' : 'text-ink-400'}`}
          title={host.error ?? undefined}
        >
          {statusLine(host, failure)}
        </span>
      </Row>

      <ModelPicker enabled={healthy} />
    </Section>
  )
}

/**
 * Which model the detection host is running, as a choice rather than a config file.
 *
 * There are two trained things that can look at a frame and they are not
 * interchangeable enough to pick automatically — one is the exported graph that
 * has been down a pipe, the other is newer, heavier, and can flag conditions
 * outside the seven classes. Which is right depends on what the run is for, so
 * an operator picks, here, with a button.
 *
 * IT SWITCHES THE HOST, NOT THE ROBOT. The robot holds no model; it posts frames
 * and draws what comes back. So this reaches the laptop through the robot, which
 * keeps the operator with one address to know rather than two.
 *
 * A model that is not installed is shown and disabled rather than hidden, with
 * the reason on hover. Hiding it makes a checkpoint someone forgot to copy look
 * like a model that does not exist.
 */
function ModelPicker({ enabled }: { enabled: boolean }) {
  const { client } = useRobot()
  const [catalogue, setCatalogue] = useState<ModelCatalogue | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!client) return
    client
      .request<ModelCatalogue>('/api/detector-model')
      .then(setCatalogue)
      .catch(() => setCatalogue(null))
  }, [client])

  useEffect(() => {
    if (enabled) load()
  }, [enabled, load])

  if (!client || !enabled || !catalogue || catalogue.models.length === 0) return null

  const choose = async (id: string) => {
    setSwitching(id)
    setFailure(null)
    try {
      await client.request('/api/detector-model', {
        method: 'POST',
        body: JSON.stringify({ id }),
      })
      load()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'could not switch')
    } finally {
      setSwitching(null)
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="label mb-2">Model</div>
      <ul className="flex flex-col gap-1">
        {catalogue.models.map((model) => (
          <li key={model.id}>
            <button
              type="button"
              disabled={!model.available || switching !== null}
              onClick={() => void choose(model.id)}
              title={model.error ?? model.note}
              aria-pressed={model.selected}
              className={`w-full rounded-sm border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                model.selected
                  ? 'border-white/30 bg-white/8'
                  : 'border-white/10 hover:border-white/20 hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-ink-100">{model.label}</span>
                {model.selected && (
                  <span className="label text-ink-400">
                    {switching === model.id ? 'Switching…' : 'Running'}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11.5px] text-ink-400">
                {model.available ? model.note : (model.error ?? 'Not installed')}
              </div>
            </button>
          </li>
        ))}
      </ul>
      {failure && <div className="mt-2 text-[11.5px] text-ink-400">{failure}</div>}
    </div>
  )
}

function statusLine(host: DetectorHost, failure: string | null): string {
  if (failure) return failure
  if (!host.url) return 'No host — nothing is being detected'
  // The robot has not tried since the backend was set, so it has neither an
  // error nor a success to report. Saying "connected" here would be a guess.
  if (host.error) return host.error
  return host.available ? `Connected — ${host.url}` : 'Detection is off'
}
