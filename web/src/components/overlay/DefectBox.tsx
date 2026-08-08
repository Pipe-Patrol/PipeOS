import type { CSSProperties, ReactNode } from 'react'

import { detectionClassOf } from '@/constants/detection-classes'
import { detectionColor } from '@/lib/detectionColors'

interface DefectBoxProps {
  /** Normalised against the parent box, 0..1. */
  rect: { x: number; y: number; w: number; h: number }
  /**
   * The class name. Drives the colour, so it is the model's label rather than a
   * pretty one — `detectionColor` does the matching.
   */
  label: string
  /** 0..1. Appended to the tag as a percentage, YOLO-style. Omit to leave it off. */
  confidence?: number | null
  /**
   * What to write when `label` is not one of the model's classes — an "Other"
   * observation, or a defect logged under an older vocabulary. Without it the
   * tag would show the raw code.
   */
  fallbackText?: string
  /** Faded with age on the live overlay; 1 everywhere the box is a record. */
  opacity?: number
  /**
   * False on a thumbnail. At 130 px wide the tag is wider than the box it
   * belongs to and clips mid-word, and the card already names the defect
   * underneath — the box only has to show where it is.
   */
  showLabel?: boolean
  /**
   * Makes the box a button that files it. Given for live model output, where
   * the box is a claim the operator can accept in one press; omitted for a
   * defect already logged, which is a record rather than an offer.
   */
  onFlag?: () => void
  /** Extra chrome inside the box — the drag handles on the region drawer. */
  children?: ReactNode
}

/**
 * A box around a defect, drawn the way YOLOv8 draws one.
 *
 * ONE COMPONENT, EVERYWHERE. Live detections on the feed, the still in the
 * defect panel, the box being dragged out by hand, and the same defect reopened
 * in a finished run are all the same claim about the same picture, and drawing
 * them four ways made them read as four unrelated things. Colour comes from the
 * class in every case, so an operator learns the palette once.
 *
 * The tag sits above the box and flips inside it near the top edge, which is
 * what YOLO's own annotator does and the reason it does it: a defect at the top
 * of frame would otherwise have its label clipped off, and the label is the
 * half that says what was found.
 *
 * A LIVE BOX IS ALSO A BUTTON. The model has already done the two things that
 * take an operator the longest — deciding what it is and drawing where it is —
 * so accepting that should be one press on the thing itself, not a trip to a
 * panel to re-enter both by hand.
 */
export function DefectBox({
  rect,
  label,
  confidence = null,
  fallbackText,
  opacity = 1,
  showLabel = true,
  onFlag,
  children,
}: DefectBoxProps) {
  const color = detectionColor(label)
  // The model's labels are lower case and underscored; show the operator's.
  const text = detectionClassOf(label)?.label ?? fallbackText ?? label
  // Above the box normally; tucked inside once there is no room above it.
  const inside = rect.y < 0.045

  const Tag = onFlag ? 'button' : 'div'

  return (
    <Tag
      type={onFlag ? 'button' : undefined}
      onClick={onFlag}
      title={onFlag ? `Log ${text} as a defect` : undefined}
      aria-label={onFlag ? `Log ${text} as a defect` : undefined}
      // The overlay above is pointer-events-none so the video keeps its drag
      // and zoom; a box that can be pressed has to opt itself back in.
      className={`absolute border-2 ${
        onFlag ? 'pointer-events-auto cursor-pointer hover:brightness-125' : ''
      }`}
      style={
        {
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`,
          height: `${rect.h * 100}%`,
          borderColor: color,
          opacity,
          // A dark halo under the stroke. A saturated line on wet grey brick is
          // legible; the same line on a pale sediment bank is not.
          boxShadow: '0 0 0 1px rgb(0 0 0 / 0.55), inset 0 0 0 1px rgb(0 0 0 / 0.35)',
        } as CSSProperties
      }
    >
      {showLabel && (
      <span
        className={`absolute left-[-2px] flex max-w-[calc(100%_+_4px)] items-center gap-1 truncate px-1 py-px text-[10px] leading-[13px] font-semibold whitespace-nowrap ${
          inside ? 'top-0' : 'bottom-full'
        }`}
        style={{ background: color, color: '#000000' }}
      >
        {text}
        {confidence !== null && (
          <span className="tnum opacity-75">{Math.round(confidence * 100)}%</span>
        )}
      </span>
      )}
      {children}
    </Tag>
  )
}
