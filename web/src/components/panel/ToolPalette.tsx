import { useEffect } from 'react'

import { DefectPanel } from '@/components/panel/DefectPanel'
import { GalleryPanel } from '@/components/panel/GalleryPanel'
import { LightsPanel } from '@/components/panel/LightsPanel'
import { TuningPanel } from '@/components/panel/TuningPanel'
import { ToolButton } from '@/components/panel/ToolButton'
import {
  DefectIcon,
  GalleryIcon,
  KeyboardIcon,
  LightIcon,
  RecordIcon,
  SnapshotIcon,
  TuneIcon,
} from '@/components/primitives/icons'
import type { RobotClient } from '@/robot/client'
import type { DefectRegion, Run, Telemetry } from '@/robot/types'

export type PanelId = 'lights' | 'tuning' | 'gallery' | 'defects'

interface ToolPaletteProps {
  client: RobotClient
  telemetry: Telemetry
  run: Run | null
  open: PanelId | null
  onOpen: (panel: PanelId | null) => void
  ledLevel: number
  onLed: (level: number) => void
  onSnapshot: () => void
  onToggleRecording: () => void
  onRunChanged: () => void
  onShowShortcuts: () => void
  /**
   * True while the operator is drawing a defect box on the feed. Suppresses the
   * letter shortcuts (`d` would close the panel out from under them) and keeps
   * the defect panel from treating the drawing clicks as "clicked away".
   */
  drawingRegion: boolean
  /** The defect box, owned by the route because it is drawn on the feed. */
  defectRegion: DefectRegion | null
  defectRegionMarkedAt: number
  onDefectRegionChange: (region: DefectRegion | null) => void
  onDrawDefectRegion: () => void
}

/**
 * The tools, floating over the video at the right edge.
 *
 * Snapshot and recording act immediately; everything else opens a panel. That
 * split is deliberate — the two that capture something are the ones reached for
 * mid-drive, and making them a two-step would lose the frame.
 */
export function ToolPalette({
  client,
  telemetry,
  run,
  open,
  onOpen,
  ledLevel,
  onLed,
  onSnapshot,
  onToggleRecording,
  onRunChanged,
  onShowShortcuts,
  drawingRegion,
  defectRegion,
  defectRegionMarkedAt,
  onDefectRegionChange,
  onDrawDefectRegion,
}: ToolPaletteProps) {
  const toggle = (panel: PanelId) => onOpen(open === panel ? null : panel)
  const recording = telemetry.recording.active

  // Tool shortcuts. Driving keys live in useDriveInput; these open things, and
  // they are ignored while a field has focus so typing a note cannot start a
  // recording.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (drawingRegion) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target)) return

      switch (event.key.toLowerCase()) {
        case 'l':
          toggle('lights')
          break
        case 'g':
          toggle('gallery')
          break
        case 'd':
          toggle('defects')
          break
        case 'c':
          onSnapshot()
          break
        case 'r':
          onToggleRecording()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <>
      <div className="panel flex flex-col gap-[3px] p-1">
        <ToolButton
          label="Lights"
          hint="L"
          active={ledLevel > 0}
          onClick={() => toggle('lights')}
        >
          <LightIcon className="size-[19px]" />
        </ToolButton>
        <ToolButton label="Image" onClick={() => toggle('tuning')}>
          <TuneIcon className="size-[19px]" />
        </ToolButton>

        <span className="my-0.5 h-px w-7 self-center bg-ink-800" />

        <ToolButton label="Snapshot" hint="C" onClick={onSnapshot} disabled={!run}>
          <SnapshotIcon className="size-[19px]" />
        </ToolButton>
        <ToolButton
          label={recording ? 'Stop recording' : 'Record'}
          hint="R"
          active={recording}
          onClick={onToggleRecording}
          disabled={!run}
          tone={recording ? 'fault' : 'default'}
        >
          <RecordIcon className="size-[19px]" />
        </ToolButton>
        <ToolButton label="Defect" hint="D" onClick={() => toggle('defects')}>
          <DefectIcon className="size-[19px]" />
        </ToolButton>
        <ToolButton label="Camera roll" hint="G" onClick={() => toggle('gallery')}>
          <GalleryIcon className="size-[19px]" />
        </ToolButton>

        <span className="my-0.5 h-px w-7 self-center bg-ink-800" />

        <ToolButton label="Shortcuts" hint="?" onClick={onShowShortcuts}>
          <KeyboardIcon className="size-[19px]" />
        </ToolButton>
      </div>

      {open === 'lights' && (
        <LightsPanel
          lights={telemetry.lights}
          level={ledLevel}
          onChange={onLed}
          onClose={() => onOpen(null)}
        />
      )}
      {open === 'tuning' && (
        <TuningPanel
          camera={telemetry.camera}
          onChange={(patch) =>
            void client
              .request('/api/camera/tuning', {
                method: 'POST',
                body: JSON.stringify(patch),
              })
              .catch(() => {})
          }
          onClose={() => onOpen(null)}
        />
      )}
      {open === 'gallery' && (
        <GalleryPanel client={client} run={run} onClose={() => onOpen(null)} />
      )}
      {open === 'defects' && (
        <DefectPanel
          client={client}
          run={run}
          motion={telemetry.motion}
          region={defectRegion}
          regionMarkedAt={defectRegionMarkedAt}
          onRegionChange={onDefectRegionChange}
          onDrawRegion={onDrawDefectRegion}
          drawing={drawingRegion}
          onSaved={onRunChanged}
          onClose={() => onOpen(null)}
        />
      )}
    </>
  )
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  )
}
