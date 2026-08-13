import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/primitives/Button'
import type { RobotClient } from '@/robot/client'
import type { Run } from '@/robot/types'

/**
 * One button, then pick a format.
 *
 * There used to be four buttons in a row — VIDEO, JSON, CSV, ZIP — which put
 * the four rarest actions on the page permanently in the top right, shouting,
 * and made "export" look like four different features. It is one action with a
 * choice attached.
 *
 * The video entry only appears when the run has footage: a download that 404s
 * is worse than an option that is not offered.
 */

interface Format {
  key: string
  label: string
  hint: string
  href: (base: string) => string
}

const FILE_FORMATS: Format[] = [
  {
    key: 'zip',
    label: 'Everything',
    hint: 'ZIP — metadata, defect sheet and every capture',
    href: (base) => `${base}/export.zip`,
  },
  {
    key: 'csv',
    label: 'Defect sheet',
    hint: 'CSV — one row per defect',
    href: (base) => `${base}/export.csv`,
  },
  {
    key: 'json',
    label: 'Raw data',
    hint: 'JSON — the whole run as stored',
    href: (base) => `${base}/export.json`,
  },
]

export function ExportMenu({ client, run }: { client: RobotClient; run: Run }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const base = `/api/runs/${run.id}`
  const clips = run.recordings.length

  const formats: Format[] = [
    ...(clips > 0
      ? [
          {
            key: 'video',
            label: 'Video',
            // Says how many clips are being joined, because "video" on a run
            // with four recordings is otherwise an ambiguous promise.
            hint:
              clips === 1
                ? 'MOV — the recording'
                : `MOV — all ${clips} recordings, joined`,
            href: (b: string) => `${b}/video.mov`,
          },
        ]
      : []),
    ...FILE_FORMATS,
  ]

  return (
    <div ref={ref} className="relative">
      <Button onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        Export as…
      </Button>

      {open && (
        <div className="panel absolute top-full right-0 z-50 mt-1 w-[268px] overflow-hidden p-1">
          {formats.map((format) => (
            <a
              key={format.key}
              href={client.mediaUrl(format.href(base))}
              download
              onClick={() => setOpen(false)}
              className="block rounded-sm px-2.5 py-2 transition-colors hover:bg-white/8"
            >
              <div className="text-[13px] text-ink-100">{format.label}</div>
              <div className="text-[11.5px] text-ink-500">{format.hint}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
