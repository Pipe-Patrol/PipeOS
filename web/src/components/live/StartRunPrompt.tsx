import { useState, type FormEvent } from 'react'

import { Button } from '@/components/primitives/Button'
import { localSaveSupported, pickRunFolder } from '@/lib/localSave'

interface StartRunPromptProps {
  /** Opens the preflight gate with the chosen name, record and save folder. */
  onStart: (
    name: string,
    record: boolean,
    saveDir: FileSystemDirectoryHandle | null,
  ) => void
}

/**
 * The gate before anything is recorded.
 *
 * Driving works without a run — the operator may just be checking the camera —
 * but nothing is saved until one is started, and this makes that explicit
 * rather than leaving someone to discover afterwards that a whole inspection
 * went nowhere.
 *
 * "Start run" does not start the run: it opens the preflight check, which is
 * where the run actually begins. The optional save folder is where snapshots
 * and run.json are mirrored on this device as the run goes.
 */
export function StartRunPrompt({ onStart }: StartRunPromptProps) {
  const [name, setName] = useState('')
  const [record, setRecord] = useState(true)
  const [saveDir, setSaveDir] = useState<FileSystemDirectoryHandle | null>(null)
  const canSaveLocally = localSaveSupported()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onStart(name.trim(), record, saveDir)
  }

  const chooseFolder = async () => {
    const dir = await pickRunFolder()
    if (dir) setSaveDir(dir)
  }

  return (
    <form
      onSubmit={submit}
      className="panel absolute bottom-16 left-1/2 flex w-[min(420px,92vw)] -translate-x-1/2 flex-col gap-3 p-4"
    >
      <h2 className="display text-[14px]">No run started</h2>

      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name"
        aria-label="Run name"
        className="h-9 rounded-panel border border-ink-800 bg-white/5 px-3 text-[13px] text-ink-100 placeholder:text-ink-500 focus:border-white/35 focus:outline-none"
      />

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
