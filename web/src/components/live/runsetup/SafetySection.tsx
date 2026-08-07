/**
 * The safety check confirmed before every run.
 *
 * Edit this list to match your crew's SOP. It is the single source of truth for
 * what an operator confirms before the robot goes down a live pipe, and unlike
 * the preflight check above it, nothing here can be measured: these are the
 * things a person has to go and look at.
 */
export const SAFETY_CHECKS = [
  'The housing is intact, with no cracks or damage',
  'The pipe and the area around it are safe to work in',
  'The tether is secure and the robot is clear to go in',
  'Weather and the risk of a surge have been checked',
  'Traffic management and site access are in place',
]

interface SafetySectionProps {
  accepted: boolean
  onAccept: (accepted: boolean) => void
}

/**
 * Re-confirmed once per run, and never remembered. A checklist that can be
 * dismissed forever is not a checklist.
 */
export function SafetySection({ accepted, onAccept }: SafetySectionProps) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5 text-[13px] text-ink-200">
        {SAFETY_CHECKS.map((check) => (
          <li key={check} className="flex gap-2.5">
            <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-500" />
            {check}
          </li>
        ))}
      </ul>

      <label className="flex items-start gap-3 rounded-panel border border-state-warning-signal/40 bg-state-warning-signal/10 px-3 py-2.5 text-[12.5px] leading-[17px] text-ink-100">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => onAccept(event.target.checked)}
          className="mt-0.5 accent-state-warning-signal"
        />
        I have checked all of the above, and assume responsibility.
      </label>
    </div>
  )
}
