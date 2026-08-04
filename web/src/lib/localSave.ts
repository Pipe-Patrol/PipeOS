import type { RobotClient } from '@/robot/client'

/**
 * Mirroring a run into a folder on the operator's own device.
 *
 * The robot stays the source of truth — this writes a second, self-contained
 * copy (run.json plus the snapshot JPEGs) into a directory the operator picks,
 * so a run can be opened straight off the laptop without the robot. It uses the
 * File System Access API, which needs Chromium and a user gesture to grant the
 * folder; where it is missing, `localSaveSupported()` is false and the prompt
 * hides the option rather than failing.
 *
 * Every write is best-effort: a failed mirror must never break the capture that
 * still landed on the robot, so callers swallow the errors.
 */

export function localSaveSupported(): boolean {
  return typeof window.showDirectoryPicker === 'function'
}

/** Ask for a folder. Returns null if unsupported or the operator cancels. */
export async function pickRunFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch {
    return null
  }
}

async function writeFile(
  dir: FileSystemDirectoryHandle,
  segments: string[],
  data: Blob | string,
): Promise<void> {
  let handle = dir
  for (const part of segments.slice(0, -1)) {
    handle = await handle.getDirectoryHandle(part, { create: true })
  }
  const fileHandle = await handle.getFileHandle(segments.at(-1)!, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(data)
  await writable.close()
}

/** Pull one snapshot's bytes from the robot and write them under snapshots/. */
export async function saveSnapshotLocally(
  dir: FileSystemDirectoryHandle,
  client: RobotClient,
  runId: string,
  file: string,
): Promise<void> {
  const response = await fetch(client.mediaUrl(`/api/runs/${runId}/snapshots/${file}`))
  if (!response.ok) return
  await writeFile(dir, ['snapshots', file], await response.blob())
}

/** Write the run's metadata (defects, path, snapshots) as run.json. */
export async function saveRunJson(
  dir: FileSystemDirectoryHandle,
  client: RobotClient,
  runId: string,
): Promise<void> {
  const run = await client.request<unknown>(`/api/runs/${runId}`)
  await writeFile(dir, ['run.json'], JSON.stringify(run, null, 2))
}
