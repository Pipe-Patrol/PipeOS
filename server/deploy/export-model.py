#!/usr/bin/env python3
"""Turn the trained checkpoint into an ONNX file the robot can run.

RUN THIS ON A LAPTOP, NOT ON THE PI. It needs PyTorch and the rfdetr package,
which together are several gigabytes and take an age to install on a Pi -- and
none of it is needed at inference time. The output is a single .onnx file that
onnxruntime loads on its own.

    python3 -m venv /tmp/export && /tmp/export/bin/pip install rfdetr onnx onnxruntime
    /tmp/export/bin/python server/deploy/export-model.py ~/Downloads/checkpoint_best_total.pth

It writes server/model/pipe-defects.onnx, which deploy.sh copies to the robot.
That directory is deliberately NOT server/data -- deploy excludes that, because
it is where the robot keeps its own runs.

The .onnx is gitignored: it is a ~115 MB build artefact regenerated from the
checkpoint, and git is the wrong place to version one. That means a fresh clone
has no model until this is run, which is why deploy.sh says so loudly rather
than shipping a robot that silently detects nothing.

WHY ONNX AND NOT TORCH ON THE PI. A Pi 5 has four Cortex-A76 cores and no GPU.
onnxruntime is built for exactly that -- it fuses the graph ahead of time and
uses the ARM NEON kernels -- where torch carries an autograd engine and a
dispatcher this never uses. Same arithmetic, a fraction of the install, and
several times faster per frame.
"""

import argparse
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = REPO_ROOT / "server" / "model" / "pipe-defects.onnx"

# The class list, in the model's own index order. Index 0 in the checkpoint is
# the Roboflow project name rather than a class, so it is not here -- see
# MODEL.md. Written next to the ONNX so the runtime does not have to hardcode
# a list that could drift from the weights.
CLASS_NAMES = {
    1: "crack",
    2: "deposition",
    3: "incrustation",
    4: "joint offset",
    5: "obstruction",
    6: "root intrusion",
    7: "utility intrusion",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkpoint", type=Path, help="checkpoint_best_total.pth")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--resolution",
        type=int,
        default=576,
        help="square input size. Must be a multiple of 32 for this backbone.",
    )
    args = parser.parse_args()

    if not args.checkpoint.is_file():
        sys.exit(f"no such checkpoint: {args.checkpoint}")

    try:
        from rfdetr import RFDETRMedium
    except ImportError:
        sys.exit(
            "rfdetr is not installed. This script runs on a laptop:\n"
            "  python3 -m venv /tmp/export\n"
            "  /tmp/export/bin/pip install rfdetr onnx onnxruntime\n"
            "  /tmp/export/bin/python %s %s" % (__file__, args.checkpoint)
        )

    args.out.parent.mkdir(parents=True, exist_ok=True)

    # WHICH VARIANT, AND HOW WE KNOW. The checkpoint carries no architecture
    # field, so it was read off the weights themselves: a DINOv2 ViT-S backbone
    # with 12 layers at patch size 16, a 256-wide decoder with FOUR layers.
    # Patch 16 rules out Base (which is 14 in current rfdetr), and four decoder
    # layers distinguishes Medium from Small (3) and Nano (2). Getting this
    # wrong does not fail quietly -- the loader refuses on a shape mismatch --
    # but it is worth writing down, because "Base" is the obvious guess and it
    # is the wrong one.
    print(f"loading {args.checkpoint} ...")
    model = RFDETRMedium(
        pretrain_weights=str(args.checkpoint),
        num_classes=len(CLASS_NAMES) + 1,
        resolution=args.resolution,
    )

    print(f"exporting at {args.resolution}x{args.resolution} ...")
    # Which .onnx files were already here. The package names its own output, so
    # the new file is found by difference rather than by globbing and taking the
    # first match — that used to rename an existing model out from under the
    # robot as soon as the directory held more than one.
    before = set(args.out.parent.glob("*.onnx"))
    model.export(output_dir=str(args.out.parent))

    produced = next(iter(set(args.out.parent.glob("*.onnx")) - before), None)
    if produced is None:
        sys.exit("the export produced no .onnx file")
    if produced != args.out:
        shutil.move(str(produced), str(args.out))

    labels = args.out.with_suffix(".labels")
    labels.write_text(
        "\n".join(f"{index}\t{name}" for index, name in sorted(CLASS_NAMES.items()))
        + "\n"
    )

    size_mb = args.out.stat().st_size / 1e6
    print(f"\nwrote {args.out}  ({size_mb:.0f} MB)")
    print(f"wrote {labels}")
    print("\nDeploy it with ./deploy.sh — the model directory is copied with the repo.")


if __name__ == "__main__":
    main()
