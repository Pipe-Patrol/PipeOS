"""What healthy pipe looks like, as coordinates.

A pretrained ResNet, frozen and never updated, turns each patch of an image
into a few hundred numbers. Patches that look alike land close together. Run
clean pipe through it and keep every patch's numbers, and you have a record of
normal with no training, no loss curve, and no labels.

Scoring a new frame converts its patches the same way and, for each, measures
the distance to the closest thing in that record. Small means something like
this appeared in clean pipe. Large means nothing in the entire record resembles
it. The frame's score is its worst patch.

WHY PER PATCH. A crack covers a few hundred pixels of sixty thousand. Judged
whole, it drowns in the clean pipe around it. Judged per patch, the patch
containing it is entirely crack, and it sits far from anything stored however
ordinary the rest of the frame is.

Banks are built by the standalone tooling and dropped in as .npz. This module
only reads them.
"""

import numpy as np
import torch
import torch.nn.functional as F
from torchvision import models, transforms

IMG_SIZE = 256

PREP = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


class PatchFeatures(torch.nn.Module):
    """A ResNet cut off partway through, used as a fixed measuring device.

    Two depths are combined: the earlier one carries fine detail, the later one
    carries context. Neither is trained here.
    """

    def __init__(self):
        super().__init__()
        net = models.resnet18(weights=models.ResNet18_Weights.DEFAULT)
        self.stem = torch.nn.Sequential(
            net.conv1, net.bn1, net.relu, net.maxpool, net.layer1, net.layer2
        )
        self.layer3 = net.layer3
        self.eval()

    @torch.no_grad()
    def forward(self, x):
        fine = self.stem(x)
        context = F.interpolate(
            self.layer3(fine), size=fine.shape[-2:], mode="bilinear",
            align_corners=False,
        )
        feats = torch.cat([fine, context], dim=1)
        batch, channels, height, width = feats.shape
        return feats.permute(0, 2, 3, 1).reshape(batch, height * width, channels)


def _centre_crop(image, keep):
    if keep >= 1.0:
        return image
    width, height = image.size
    cw, ch = int(width * keep), int(height * keep)
    left, top = (width - cw) // 2, (height - ch) // 2
    return image.crop((left, top, left + cw, top + ch))


@torch.no_grad()
def score_image(model, bank, image, crop=1.0):
    """Distance from the worst patch of this frame to the closest normal one."""
    prepared = _centre_crop(image, crop).resize((IMG_SIZE, IMG_SIZE))
    tensor = PREP(np.array(prepared)).unsqueeze(0).to(bank.device)
    patches = model(tensor)[0]
    nearest = torch.cdist(patches, bank).min(dim=1).values
    return float(nearest.max().item())
