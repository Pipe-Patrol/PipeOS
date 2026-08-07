import { Button } from '@/components/primitives/Button'

interface NoRunOverlayProps {
  onCreate: () => void
}

/**
 * What the driving screen is before there is anything to drive.
 *
 * The feed keeps playing underneath, tinted, so the operator can still see that
 * the camera works and roughly where the robot is pointing. The tint is the
 * whole message: the picture is live, but nothing is being recorded against it
 * yet, and one button changes that.
 */
export function NoRunOverlay({ onCreate }: NoRunOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div className="pointer-events-auto flex flex-col items-center gap-4">
        <h2 className="display overlay-text text-[16px]">No run started</h2>
        <Button variant="primary" onClick={onCreate} className="h-10 px-5 shadow-lg">
          Create new run
        </Button>
      </div>
    </div>
  )
}
