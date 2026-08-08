/**
 * The features the distance estimate is following, drawn where it is following
 * them.
 *
 * Distance on this robot is measured off the picture — there are no wheel
 * encoders — so "how far have I gone" ultimately rests on whether the camera
 * found anything to track. On a clean wet wall in the dark it sometimes does
 * not, and the failure is quiet: the number keeps updating, just from a worse
 * source. This makes that visible. A screen full of dots is a distance worth
 * trusting; four dots huddled in one corner is not, and the operator can do
 * something about it — more light, or a slower crawl.
 *
 * Off by default. It is the working rather than the answer, and an operator
 * driving does not need forty dots over the pipe wall they are inspecting.
 */

interface FlowPointsProps {
  /** Normalised against the frame, 0..1. Empty or absent when nothing is tracked. */
  points?: [number, number][] | null
}

export function FlowPoints({ points }: FlowPointsProps) {
  if (!points || points.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden
      >
        {points.map(([x, y], index) => (
          <circle
            key={index}
            cx={x * 100}
            cy={y * 100}
            // Non-uniform scaling would turn a circle into an ellipse, so the
            // radius is given in viewport units and stays round.
            r={0.45}
            className="fill-state-recording-signal"
            opacity={0.85}
          />
        ))}
      </svg>

      <span className="overlay-shadow absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-medium tracking-[0.06em] text-state-recording-signal uppercase">
        {points.length} tracked
      </span>
    </div>
  )
}
