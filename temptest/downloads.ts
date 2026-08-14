/**
 * Exports, which the fetch shim cannot reach.
 *
 * The run detail page offers JSON / CSV / ZIP as plain `<a href download>`
 * links. Those are browser navigations, not fetches — nothing installed on
 * `window.fetch` sees them, and left alone they would hit the dev server and
 * quietly download `index.html` renamed to `run.csv`.
 *
 * So this catches the click instead, builds the file from the in-memory run,
 * and hands it over as a blob. The formats match `server/pipepatrol/runs/
 * export.py` column for column, because the CSV is a sheet someone works a
 * report from and a column in the wrong order is worse than no file.
 */

import type { Run } from '../web/src/robot/types'

import * as runs from './runs'

/** DEFECT_COLUMNS in export.py, in order. */
const DEFECT_COLUMNS = [
  'id',
  'at',
  'code',
  'severity',
  'clock_position',
  'chainage_m',
  'note',
  'snapshot_id',
  'detection_id',
] as const

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  // Python's csv writer quotes on comma, quote, CR or LF, and doubles quotes.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(run: Run): Uint8Array {
  const rows = [DEFECT_COLUMNS.join(',')]
  for (const defect of run.defects) {
    rows.push(
      DEFECT_COLUMNS.map((column) =>
        csvCell((defect as unknown as Record<string, unknown>)[column]),
      ).join(','),
    )
  }
  // csv.writer terminates every row, including the last.
  return new TextEncoder().encode(`${rows.join('\r\n')}\r\n`)
}

function toJson(run: Run): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(run, null, 2))
}

/** `filename_for` in export.py: sorts by date, survives a filesystem. */
function filenameFor(run: Run, extension: string): string {
  const safe =
    [...run.name]
      .map((character) => (/[a-zA-Z0-9\-_ ]/.test(character) ? character : '_'))
      .join('')
      .trim()
      .replace(/ /g, '-') || run.id
  return `${safe}.${extension}`
}

// ---------------------------------------------------------------------------
// A minimal store-only zip
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  name: string
  data: Uint8Array
}

/**
 * Deflate would need a compressor; stored entries need none, and the archive
 * opens in every unzip tool either way. The snapshots are already JPEG, which
 * is where all the bytes are and which would not compress anyway.
 */
function toZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = new Uint8Array(30 + name.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true) // version needed
    localView.setUint16(6, 0, true) // flags
    localView.setUint16(8, 0, true) // stored
    localView.setUint16(10, 0, true) // mod time
    localView.setUint16(12, 0x21, true) // mod date — 1980-01-01
    localView.setUint32(14, crc, true)
    localView.setUint32(18, size, true)
    localView.setUint32(22, size, true)
    localView.setUint16(26, name.length, true)
    localView.setUint16(28, 0, true)
    local.set(name, 30)
    locals.push(local, entry.data)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true) // version made by
    centralView.setUint16(6, 20, true) // version needed
    centralView.setUint16(8, 0, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, 0, true)
    centralView.setUint16(14, 0x21, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, size, true)
    centralView.setUint32(24, size, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length + size
  }

  const centralSize = centrals.reduce((total, part) => total + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)

  return new Blob([...locals, ...centrals, end], { type: 'application/zip' })
}

// ---------------------------------------------------------------------------
// The click interception
// ---------------------------------------------------------------------------

async function buildExport(
  run: Run,
  format: string,
): Promise<{ blob: Blob; filename: string } | null> {
  const filename = filenameFor(run, format)
  if (format === 'json') {
    return { blob: new Blob([toJson(run)], { type: 'application/json' }), filename }
  }
  if (format === 'csv') {
    return { blob: new Blob([toCsv(run)], { type: 'text/csv' }), filename }
  }
  if (format === 'zip') {
    const entries: ZipEntry[] = [
      { name: 'run.json', data: toJson(run) },
      { name: 'defects.csv', data: toCsv(run) },
    ]
    for (const snapshot of run.snapshots) {
      // Straight back through the dev-server middleware, which answers every
      // snapshot url with sample-pipe.jpg.
      const response = await fetch(`/api/runs/${run.id}/snapshots/${snapshot.file}`)
      if (!response.ok) continue
      entries.push({
        name: `snapshots/${snapshot.file}`,
        data: new Uint8Array(await response.arrayBuffer()),
      })
    }
    return { blob: toZip(entries), filename }
  }
  return null
}

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Long enough for the download to have been handed to the browser.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

let installed = false

export function installDownloads(): void {
  if (installed) return
  installed = true

  document.addEventListener(
    'click',
    (event) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[download]')
      if (!(anchor instanceof HTMLAnchorElement)) return

      let path: string
      try {
        path = new URL(anchor.href, window.location.origin).pathname
      } catch {
        return
      }

      const exportMatch = path.match(/^\/api\/runs\/([^/]+)\/export\.([a-z]+)$/)
      if (exportMatch) {
        event.preventDefault()
        const run = runs.detail(exportMatch[1])
        if (!run) {
          console.warn('[temptest] export: no such run', exportMatch[1])
          return
        }
        void buildExport(run, exportMatch[2]).then((result) => {
          if (result) save(result.blob, result.filename)
          else console.warn('[temptest] export: unsupported format', exportMatch[2])
        })
        return
      }

      if (/^\/api\/runs\/[^/]+\/video(\.mov)?$/.test(path)) {
        event.preventDefault()
        console.warn(
          '[temptest] video is not simulated — no run carries a recording, so this link should not have rendered',
        )
      }
    },
    // Capture, so this runs before anything the console has bound.
    true,
  )
}
