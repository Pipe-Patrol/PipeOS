/**
 * What the model can detect, and what colour each one is drawn in.
 *
 * Taken from `class_names` inside checkpoint_best_total.pth — an RF-DETR
 * trained on the `Pipe-Defects-Detection-sewe-etkz` Roboflow set. The list in
 * the checkpoint has the dataset's own name sitting at index 0 where a class
 * should be, which is an artefact of the export and not something the model can
 * ever mean. Indices here start at 1 to match the head, and index 0 is absent
 * on purpose: a box labelled with the name of a dataset is worse than no box.
 *
 * COLOURS. The neutral scale in index.css is pure greyscale and every hue in
 * this UI is a state signal — these are the one exception, because a box has to
 * say which of seven things it found without the operator reading the label.
 * They are picked to survive the two conditions this screen is actually read
 * in: over wet grey brick, and on a laptop in daylight. Deposition and
 * incrustation are deliberately far apart in hue despite being adjacent in the
 * list, because they are the pair that looks alike on camera and a near miss
 * there is a misread rather than a hesitation.
 *
 * The operator can override any of these in settings; see lib/detectionColors.
 */

export interface DetectionClass {
  /** The model's own index. Matches the classifier head, 1-based. */
  id: number
  /** The label the model was trained with — used to match incoming detections. */
  name: string
  /** What the operator sees. */
  label: string
  color: string
}

export const DETECTION_CLASSES: DetectionClass[] = [
  { id: 1, name: 'crack', label: 'Crack', color: '#f04438' },
  { id: 2, name: 'deposition', label: 'Deposition', color: '#f5a524' },
  { id: 3, name: 'incrustation', label: 'Incrustation', color: '#a855f7' },
  { id: 4, name: 'joint offset', label: 'Joint offset', color: '#4da3ff' },
  { id: 5, name: 'obstruction', label: 'Obstruction', color: '#ff6fb5' },
  { id: 6, name: 'root intrusion', label: 'Root intrusion', color: '#3ddc84' },
  { id: 7, name: 'utility intrusion', label: 'Utility intrusion', color: '#22d3ee' },
]

/** Anything the model reports that this table does not know about. */
export const UNKNOWN_CLASS_COLOR = '#b0b0b0'

const BY_NAME = new Map(DETECTION_CLASSES.map((type) => [type.name, type]))

/**
 * Match a detection's label to a class.
 *
 * Lenient about case and separators because the label crosses a wire as free
 * text: `joint offset`, `Joint_Offset` and `joint-offset` are the same class,
 * and a mismatch here would silently grey out a real defect.
 */
export function detectionClassOf(label: string): DetectionClass | null {
  return BY_NAME.get(label.trim().toLowerCase().replace(/[_-]+/g, ' ')) ?? null
}
