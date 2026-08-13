import { useEffect, useRef } from 'react'

import { DEFECT_TYPES, OTHER_CODE } from '@/constants/defects'
import { detectionClassOf } from '@/constants/detection-classes'
import { clockFromRegion, regionFromBox } from '@/lib/region'
import type { RobotClient } from '@/robot/client'
import { describeSpike, type Spike } from '@/robot/useClimateSpikes'
import type { DefectRegion, Detection, Motion, Run } from '@/robot/types'

/**
 * Flagging, without the operator.
 *
 * Auto mode exists because driving and observing are the same person's job on
 * this robot, and they compete. A crawl past a lateral takes four seconds and
 * the operator is watching the wall, the throttle and the chainage; the flag is
 * what gets dropped. Here the model and the air sensor file it instead.
 *
 * WHAT IT WILL AND WILL NOT DO. It logs observations. It does not drive, stop,
 * or return — nothing here touches the throttle, and nothing here is on the
 * safety path. The worst failure is a run with defects in it that a person has
 * to delete, which is recoverable; the worst failure of an autonomous *driver*
 * is not.
 *
 * THREE THINGS KEEP IT FROM FILLING THE RUN WITH RUBBISH:
 *
 *   confidence   a detection below the bar is not filed at all
 *   distance     the same class cannot be filed twice inside COOLDOWN_M, so a
 *                crack held in frame for eight seconds is one defect
 *   one in flight  a slow POST cannot overlap the next frame's decision
 *
 * The distance rule is the important one. Detections arrive every couple of
 * seconds while the robot creeps, so a time-based cooldown would file the same
 * crack repeatedly whenever the robot slowed down — which is exactly when an
 * operator slows down, because they are looking at something.
 */

/** Below this the model is guessing, and a guess in a report is worse than a gap. */
const MIN_CONFIDENCE = 0.55

/** The same class inside this distance is treated as the same defect. */
const COOLDOWN_M = 1.5

/** Air spikes have no class, so they get their own spacing. */
const CLIMATE_COOLDOWN_M = 5

const SEVERITY = 3

interface AutoFlagOptions {
  client: RobotClient | null
  enabled: boolean
  run: Run | null
  motion: Motion | null
  detections: Detection[]
  spikes: Spike[]
  /** From settings. Fall back to the constants above when not given. */
  threshold?: number
  cooldownM?: number
  onLogged: () => void
}

export function useAutoFlag({
  client,
  enabled,
  run,
  motion,
  detections,
  spikes,
  threshold = MIN_CONFIDENCE,
  cooldownM = COOLDOWN_M,
  onLogged,
}: AutoFlagOptions): void {
  // Chainage of the last flag per key, so the cooldown is in metres of pipe
  // rather than in seconds of wall clock.
  const lastAt = useRef(new Map<string, number>())
  const inFlight = useRef(false)
  const detectionsSeen = useRef(new Set<string>())

  // Leaving auto mode forgets everything, so switching it back on at a new
  // stretch of pipe does not sit in a cooldown from the last one.
  useEffect(() => {
    if (enabled) return
    lastAt.current.clear()
    detectionsSeen.current.clear()
  }, [enabled])

  useEffect(() => {
    if (!enabled || !client || !run || !motion || inFlight.current) return

    const chainage = motion.chainage_m
    const due = (key: string, spacing: number) => {
      const previous = lastAt.current.get(key)
      return previous === undefined || Math.abs(chainage - previous) >= spacing
    }

    const candidate =
      pickDetection(detections, detectionsSeen.current, due, threshold, cooldownM) ??
      pickSpike(spikes, due)
    if (!candidate) return

    inFlight.current = true
    lastAt.current.set(candidate.key, chainage)

    void client
      .request(`/api/runs/${run.id}/defects`, {
        method: 'POST',
        body: JSON.stringify({
          code: candidate.code,
          severity: SEVERITY,
          clock_position: candidate.region ? clockFromRegion(candidate.region) : null,
          note: candidate.note,
          with_snapshot: true,
          region: candidate.region,
        }),
      })
      .then(onLogged)
      .catch(() => {
        // Let the same trigger try again at the next opportunity rather than
        // holding a cooldown for a flag that was never filed.
        lastAt.current.delete(candidate.key)
      })
      .finally(() => {
        inFlight.current = false
      })
  }, [enabled, client, run, motion, detections, spikes, threshold, cooldownM, onLogged])
}

interface Candidate {
  key: string
  code: string
  note: string
  region: DefectRegion | null
}

function pickDetection(
  detections: Detection[],
  seen: Set<string>,
  due: (key: string, spacing: number) => boolean,
  threshold: number,
  cooldownM: number,
): Candidate | null {
  const best = detections
    .filter((detection) => !seen.has(detection.id))
    .filter((detection) => detection.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence)[0]
  if (!best) return null

  seen.add(best.id)

  const type = detectionClassOf(best.label)
  const code =
    DEFECT_TYPES.find((entry) => entry.className === type?.name)?.code ?? OTHER_CODE
  if (!due(code, cooldownM)) return null

  return {
    key: code,
    code,
    note: `Auto — model, ${Math.round(best.confidence * 100)}% confident`,
    region: regionFromBox(best.box),
  }
}

function pickSpike(
  spikes: Spike[],
  due: (key: string, spacing: number) => boolean,
): Candidate | null {
  const spike = spikes[0]
  if (!spike || !due('climate', CLIMATE_COOLDOWN_M)) return null
  return {
    key: 'climate',
    // The air says something is here, not what it is. Filing it as a guessed
    // class would put a defect type in a report that nothing observed.
    code: OTHER_CODE,
    note: `Auto — ${describeSpike(spike)}`,
    region: null,
  }
}
