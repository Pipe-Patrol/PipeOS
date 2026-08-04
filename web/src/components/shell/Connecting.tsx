/**
 * Shown while a connection attempt is in flight.
 *
 * It exists so that a reload does not flash the picker on its way to the robot
 * it was already talking to.
 */
export function Connecting() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="label animate-pulse text-[11px]">connecting</p>
    </div>
  )
}
