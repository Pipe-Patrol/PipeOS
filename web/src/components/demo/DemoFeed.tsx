import { useEffect, useRef } from 'react'

import type { DemoSource } from '@/lib/demoMode'

/**
 * The footage, driven by the robot.
 *
 * THE VIDEO DOES NOT PLAY. It is scrubbed. A video that simply played would
 * carry on down the pipe while the robot sat still, and stop while the robot
 * drove — which is exactly backwards, and obvious to anybody watching within
 * about four seconds. Instead the robot's chainage is mapped onto the video's
 * timeline:
 *
 *     videoTime = (chainage − chainage when this clip was selected) × s/m
 *
 * so driving forward moves the footage forward, stopping stops it, and reversing
 * runs it back. Hold the throttle and it looks like a drive; let go and it looks
 * like a robot holding station. That is the whole engine.
 *
 * SEEKING, NOT SETTING. `currentTime` is clamped and quantised to avoid asking
 * the decoder for a seek it cannot service — a browser given a new time forty
 * times a second on a long clip will drop most of them and stutter. A small
 * dead-band means only real movement causes a seek.
 */

/** Don't seek for less than this. Below it the decoder work is wasted. */
const SEEK_EPSILON_S = 0.03

interface DemoFeedProps {
  source: DemoSource
  /** Signed distance from the entry point, metres. */
  chainage_m: number
  /** How much footage plays per metre driven. */
  secondsPerMetre: number
}

export function DemoFeed({ source, chainage_m, secondsPerMetre }: DemoFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // Where the robot was when this clip went on screen. Everything is measured
  // from there, so switching clips starts the new one at its beginning rather
  // than forty metres in.
  const originRef = useRef(chainage_m)

  useEffect(() => {
    originRef.current = chainage_m
    // Only when the clip changes. Re-running on every chainage tick would keep
    // resetting the origin and the video would never advance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id])

  useEffect(() => {
    const video = videoRef.current
    if (!video || source.kind !== 'video') return

    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) return

    const travelled = chainage_m - originRef.current
    // Wrapped rather than clamped: a judge driving past the end of a two-minute
    // clip should see the pipe carry on, not the picture freeze on the last
    // frame with the robot still moving.
    const raw = travelled * secondsPerMetre
    const wrapped = ((raw % duration) + duration) % duration

    if (Math.abs(video.currentTime - wrapped) > SEEK_EPSILON_S) {
      video.currentTime = wrapped
    }
  }, [chainage_m, secondsPerMetre, source.kind])

  if (source.kind === 'image') {
    return (
      <img
        src={source.url}
        alt={source.name}
        draggable={false}
        className="h-full w-full object-cover"
      />
    )
  }

  return (
    <video
      ref={videoRef}
      key={source.id}
      src={source.url}
      muted
      playsInline
      // Never `autoPlay` and never `controls`. The robot is the transport.
      preload="auto"
      className="h-full w-full object-cover"
    />
  )
}
