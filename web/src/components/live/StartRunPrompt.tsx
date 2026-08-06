import { useState, type FormEvent } from 'react'

import { Button } from '@/components/primitives/Button'
import { EntryPointPicker } from '@/components/map/EntryPointPicker'
import type { OriginDraft } from '@/components/map/geo'
import { localSaveSupported, pickRunFolder } from '@/lib/localSave'

interface StartRunPromptProps {
  /** Opens the preflight gate with the chosen name, record, folder and origin. */
  onStart: (
    name: string,
    record: boolean,
    saveDir: FileSystemDirectoryHandle | null,
    origin: OriginDraft | null,
  ) => void
  /** The robot's compass bearing, or null until north is set in Settings. */
  heading: number | null
}

/**
 * The gate before anything happens at all.
 *
 * THE MOTORS DO NOT TURN UNTIL A RUN IS OPEN. That is enforced on the robot
 * (hardware/drive.py refuses every command while disarmed), not here — this
 * screen is just where an operator finds out why. It used to be possible to
 * drive without a run for a quick camera check; the cost was that an inspection
 * could be driven in full and saved nowhere, which is a worse thing to discover
 * at the far end of a pipe than a locked keyboard is at the near one.
 *
 * "Start run" does not start the run: it opens the preflight check, which is
 * where the run actually begins. The optional save folder is where snapshots
 * and run.json are mirrored on this device as the run goes, and the entry point
 * is what ties everything the odometer produces to somewhere on the earth.
 */
export function StartRunPrompt({ onStart, heading }: StartRunPromptProps) {
  const [name, setName] = useState('')
  const [record, setRecord] = useState(true)
  const [saveDir, setSaveDir] = useState<FileSystemDirectoryHandle | null>(null)
  const [origin, setOrigin] = useState<OriginDraft | null>(null)
  const canSaveLocally = localSaveSupported()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onStart(name.trim(), record, saveDir, origin)
  }

  const chooseFolder = async () => {
    const dir = await pickRunFolder()
    if (dir) setSaveDir(dir)
  }

  return (
    <form
      onSubmit={submit}
      className="panel absolute bottom-10 left-1/2 flex max-h-[82vh] w-[min(420px,92vw)] -translate-x-1/2 flex-col gap-3 overflow-y-auto p-4"
    >
      <div>
        <h2 className="display text-[14px]">No run started</h2>
        <p className="mt-1 text-[12px] text-ink-400">
          The motors stay locked until one is.
        </p>
      </div>

      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name"
        aria-label="Run name"
        className="h-9 rounded-panel border border-ink-800 bg-white/5 px-3 text-[13px] text-ink-100 placeholder:text-ink-500 focus:border-white/35 focus:outline-none"
      />

      <EntryPointPicker value={origin} onChange={setOrigin} heading={heading} />

      <div className="flex flex-col gap-1">
        <span className="label">Save to this device</span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="quiet"
            onClick={() => void chooseFolder()}
            disabled={!canSaveLocally}
          >
            {saveDir ? 'Change folder' : 'Choose folder…'}
          </Button>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-400">
            {saveDir
              ? `Snapshots + run.json → ${saveDir.name}`
              : canSaveLocally
                ? 'Off — snapshots stay on the robot'
                : 'Needs Chrome or Edge'}
          </span>
        </div>
      </div>

      <label className="flex items-center gap-2 text-[12px] text-ink-400">
        <input
          type="checkbox"
          checked={record}
          onChange={(event) => setRecord(event.target.checked)}
          className="accent-white"
        />
        Record video to the robot
      </label>

      <Button type="submit">Start run</Button>
    </form>
  )
}
