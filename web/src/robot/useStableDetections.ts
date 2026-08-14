import { useEffect, useRef, useState } from 'react'

import type { Detection } from '@/robot/types'

/**
 * How long a box stays on the glass after the model last saw it.
 *
 * The model judges each frame alone, and a crack at the edge of its confidence
 * is found on one frame and missed on the next, so the raw answer flickers a box
 * up for a single telemetry tick and takes it away again — long enough to catch
 * an operator's eye, too short to read or press. This holds the last sighting
 * for about a second of frames, which is short enough that a box never describes
 * pipe the robot has driven past.
 */
const HOLD_MS = 1200

/**
 * Overlap above which two boxes of the same class are the same defect.
 *
 * Deliberately loose: consecutive frames of the same crack drift by more than a
 * tight threshold allows, and a missed match is what stacks a second box on a
 * defect that already has one.
 */
const MATCH_IOU = 0.3

type Box = NonNullable<Detection['box']>

function iou(a: Box, b: Box): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0])
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1])
  if (w <= 0 || h <= 0) return 0
  const overlap = w * h
  const areaA = (a[2] - a[0]) * (a[3] - a[1])
  const areaB = (b[2] - b[0]) * (b[3] - b[1])
  const union = areaA + areaB - overlap
  return union <= 0 ? 0 : overlap / union
}

function same(a: Detection, b: Detection): boolean {
  if (a.label !== b.label) return false
  if (a.box === null || b.box === null) return a.box === b.box
  return iou(a.box, b.box) >= MATCH_IOU
}

interface Held {
  detection: Detection
  seenAt: number
}

/**
 * Hold the model's boxes still.
 *
 * Two problems, one answer. A detection that drops out for a frame or two is
 * held rather than removed, so a box does not blink; and a detection that comes
 * back is matched to the box already on screen by class and overlap, so it
 * MOVES that box instead of adding another. Without the matching, holding would
 * be the worse bug of the two — a wall of stacked rectangles over one crack.
 *
 * The held copy keeps the id of the first sighting for the same reason. Auto
 * flagging and the flag form key off it, and letting a defect change identity
 * every frame it is re-found would file it repeatedly.
 *
 * This is presentation only. The server still keeps one frame's findings at a
 * time (see perception/detector.py) and the run's record is what was actually
 * inferred, not what was smoothed onto the glass.
 */
export function useStableDetections(detections: Detection[]): Detection[] {
  const [stable, setStable] = useState<Detection[]>([])
  const heldRef = useRef<Held[]>([])

  // Same list, same array. A fresh array every telemetry tick would re-render
  // the overlay several times a second to paint identical rectangles.
  const publish = (next: Detection[]) =>
    setStable((current) =>
      current.length === next.length && current.every((d, i) => d === next[i]) ? current : next,
    )

  useEffect(() => {
    const now = Date.now()
    const held = heldRef.current
    const matched = new Set<Held>()

    for (const detection of detections) {
      const existing = held.find((candidate) => !matched.has(candidate) && same(candidate.detection, detection))
      if (existing) {
        matched.add(existing)
        existing.detection = { ...detection, id: existing.detection.id }
        existing.seenAt = now
      } else {
        const fresh = { detection, seenAt: now }
        held.push(fresh)
        matched.add(fresh)
      }
    }

    heldRef.current = held.filter((candidate) => now - candidate.seenAt < HOLD_MS)
    publish(heldRef.current.map((candidate) => candidate.detection))
  }, [detections])

  // Telemetry going quiet must not leave a box up forever: the last tick's
  // detections would otherwise never be re-examined and never expire.
  useEffect(() => {
    if (stable.length === 0) return
    const timer = setTimeout(() => {
      const now = Date.now()
      heldRef.current = heldRef.current.filter((candidate) => now - candidate.seenAt < HOLD_MS)
      publish(heldRef.current.map((candidate) => candidate.detection))
    }, HOLD_MS)
    return () => clearTimeout(timer)
  }, [stable])

  return stable
}
