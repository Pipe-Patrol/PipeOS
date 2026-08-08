#!/usr/bin/env python3
"""Run the defect model over an image and say what it found, and how long it took.

The point of this is the timing. Everything about how the console behaves --
how stale a detection is by the time it lands, whether auto flagging can keep
up, whether demo day needs a slower pace -- follows from one number that can
only be measured on the machine that will run it.

    # on the robot
    ssh pipepatrol@pipepatrol.local
    cd ~/PipeOS/server && .venv/bin/python deploy/try-model.py some-pipe.jpg

    # on a laptop, before deploying
    server/.venv/bin/python server/deploy/try-model.py some-pipe.jpg

Repeats the inference a few times and reports the median, because the first run
includes lazy allocation and is never representative.

With --save it writes a copy of the image with the boxes drawn on, which is the
quickest way to tell a working model from one whose coordinates are transposed.
"""

import argparse
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipepatrol.perception.rfdetr import RfDetrDetector  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path, help="a JPEG to run the model over")
    parser.add_argument("--model", type=Path, default=None)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--save", type=Path, help="write the image with boxes drawn")
    args = parser.parse_args()

    if not args.image.is_file():
        sys.exit(f"no such image: {args.image}")

    detector = RfDetrDetector(model_path=args.model)
    if not detector.available:
        sys.exit(f"model not available: {detector.error}")

    print(f"model   {detector.model_path}")
    print(f"input   {detector._size}x{detector._size}")
    print(f"threads {detector._session.get_session_options().intra_op_num_threads}")

    jpeg = args.image.read_bytes()

    timings = []
    found = []
    for index in range(max(1, args.runs)):
        started = time.monotonic()
        found = detector.infer(jpeg)
        elapsed = time.monotonic() - started
        timings.append(elapsed)
        note = "  (first run — includes warm-up)" if index == 0 else ""
        print(f"  run {index + 1}: {elapsed:.2f} s{note}")

    # The first is dropped when there is anything else to average: it carries
    # allocation the steady state does not.
    steady = timings[1:] or timings
    median = statistics.median(steady)
    print(f"\nmedian {median:.2f} s per frame  ({1 / median:.2f} fps)")

    print(f"\n{len(found)} detection(s):")
    for detection in sorted(found, key=lambda d: -d.confidence):
        x1, y1, x2, y2 = detection.box
        print(
            f"  {detection.label:<18} {detection.confidence * 100:5.1f}%"
            f"  box [{x1:.3f} {y1:.3f} {x2:.3f} {y2:.3f}]"
        )

    if args.save:
        _draw(args.image, found, args.save)
        print(f"\nwrote {args.save}")


def _draw(source, detections, out):
    """The boxes, on the picture. Catches a transposed coordinate instantly."""
    import cv2

    image = cv2.imread(str(source))
    height, width = image.shape[:2]
    for detection in detections:
        x1, y1, x2, y2 = detection.box
        p1 = (int(x1 * width), int(y1 * height))
        p2 = (int(x2 * width), int(y2 * height))
        cv2.rectangle(image, p1, p2, (0, 220, 255), 2)
        cv2.putText(
            image,
            f"{detection.label} {detection.confidence * 100:.0f}%",
            (p1[0], max(14, p1[1] - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 220, 255),
            1,
            cv2.LINE_AA,
        )
    cv2.imwrite(str(out), image)


if __name__ == "__main__":
    main()
