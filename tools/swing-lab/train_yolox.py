#!/usr/bin/env python3
"""Swing lab — fine-tune YOLOX-tiny (Apache-2.0) on the public club dataset (spike).

Data: Roboflow Universe club-head-tracking/golf-club-tracking v2, CC BY 4.0, COCO export
(640x640 stretched frames; classes shaft / head / hands). Download it with your own Roboflow key
into ~/datasets/golf-club-tracking-v2 (train/ valid/ test/, each with _annotations.coco.json).
Weights start from YOLOX's COCO yolox_tiny.pth; the class head is re-initialised.

Setup: `git clone https://github.com/Megvii-BaseDetection/YOLOX ~/src/YOLOX`, then make its head
device-agnostic for Apple MPS (it builds grids with `.type(x.type())`, which only knows CUDA):
  sed -i '' -e 's/xin\\[0\\]\\.type()/xin[0]/g' -e 's/\\.type(dtype)/.type_as(dtype)/g' yolox/models/yolo_head.py
  sed -i '' -E 's/\\.type\\(([A-Za-z_0-9]+)\\.type\\(\\)\\)/.type_as(\\1)/g' yolox/utils/boxes.py yolox/models/*.py
`uv venv -p 3.11 ~/.venvs/swing-yolox && uv pip install -p ~/.venvs/swing-yolox/bin/python torch
torchvision opencv-python-headless numpy loguru tabulate pycocotools thop psutil tqdm packaging`.

Usage: ~/.venvs/swing-yolox/bin/python -I train_yolox.py [--epochs 20] [--batch 16]
       [--aug strong] [--out models/yolox-club-v2] [--every 1]
Writes <out>/{epoch_N.pth,last.pth,log.jsonl} (default out models/yolox-club).

Run 1 (2026-10-16, --epochs 20, light aug) peaked at epoch 6 on the owner's marks and then
over-fitted: from epoch 8 the blurred top/transition frames get no detection at any threshold
(the dataset is 4,729 frames x 2 augmented copies from few videos). `--aug strong` adds what the
owner's clips differ in: motion blur (the failure mode), zoom/shift, and an aspect squash
(portrait 9:16 frames are stretched to 640x640 at inference).
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset

YOLOX_SRC = Path.home() / "src" / "YOLOX"
sys.path.insert(0, str(YOLOX_SRC))
from yolox.exp import get_exp  # noqa: E402
from yolox.utils import ModelEMA  # noqa: E402

LAB = Path(__file__).resolve().parent
DATA = Path.home() / "datasets" / "golf-club-tracking-v2"
PRETRAINED = Path.home() / "datasets" / "weights" / "yolox_tiny.pth"
OUT = LAB / "models" / "yolox-club"
SIZE = 640
MAX_LABELS = 120
# COCO category id -> our class: Roboflow names them "0" shaft, "1" head, "3" hands.
CAT = {1: 0, 2: 1, 3: 2}
NAMES = ["shaft", "head", "hands"]


def build_exp():
    exp = get_exp(str(YOLOX_SRC / "exps/default/yolox_tiny.py"))
    exp.num_classes = len(NAMES)
    return exp


def strong_aug(img: np.ndarray, boxes: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Axis-aligned zoom/shift/aspect squash (boxes stay exact) + directional motion blur."""
    if random.random() < 0.8:
        s = random.uniform(0.6, 1.5)
        sx, sy = s, s
        if random.random() < 0.5:  # squash one axis, like a 9:16 frame stretched to a square
            k = random.uniform(0.55, 1.0)
            if random.random() < 0.5:
                sx *= k
            else:
                sy *= k
        tx = random.uniform(-0.15, 0.15) * SIZE + (1 - sx) * SIZE / 2
        ty = random.uniform(-0.15, 0.15) * SIZE + (1 - sy) * SIZE / 2
        M = np.float32([[sx, 0, tx], [0, sy, ty]])
        img = cv2.warpAffine(img, M, (SIZE, SIZE), borderValue=(114, 114, 114))
        if len(boxes):
            x1 = (boxes[:, 1] - boxes[:, 3] / 2) * sx + tx
            x2 = (boxes[:, 1] + boxes[:, 3] / 2) * sx + tx
            y1 = (boxes[:, 2] - boxes[:, 4] / 2) * sy + ty
            y2 = (boxes[:, 2] + boxes[:, 4] / 2) * sy + ty
            w0, h0 = x2 - x1, y2 - y1
            x1, x2 = np.clip(x1, 0, SIZE), np.clip(x2, 0, SIZE)
            y1, y2 = np.clip(y1, 0, SIZE), np.clip(y2, 0, SIZE)
            keep = ((x2 - x1) * (y2 - y1) > 0.4 * w0 * h0) & (x2 - x1 > 2) & (y2 - y1 > 2)
            boxes = np.stack([boxes[:, 0], (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1], 1)[keep]
    if random.random() < 0.5:
        n = random.choice([5, 7, 9, 13, 17, 21])
        k = np.zeros((n, n), np.float32)
        k[n // 2, :] = 1
        R = cv2.getRotationMatrix2D((n / 2 - 0.5, n / 2 - 0.5), random.uniform(0, 180), 1)
        k = cv2.warpAffine(k, R, (n, n))
        img = cv2.filter2D(img, -1, k / max(k.sum(), 1e-6))
    return img, boxes.astype(np.float32).reshape(-1, 5)


class ClubSet(Dataset):
    def __init__(self, split: str, train: bool, aug: str = "light"):
        root = DATA / split
        coco = json.loads((root / "_annotations.coco.json").read_text())
        by_img = {im["id"]: [] for im in coco["images"]}
        for a in coco["annotations"]:
            if a["category_id"] in CAT:
                by_img[a["image_id"]].append((CAT[a["category_id"]], *a["bbox"]))
        self.items = [(root / im["file_name"], by_img[im["id"]]) for im in coco["images"]]
        self.train = train
        self.aug = aug

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        path, anns = self.items[i]
        img = cv2.imread(str(path))
        h, w = img.shape[:2]
        if (h, w) != (SIZE, SIZE):
            img = cv2.resize(img, (SIZE, SIZE))
        sx, sy = SIZE / w, SIZE / h
        boxes = np.array([[c, (x + bw / 2) * sx, (y + bh / 2) * sy, bw * sx, bh * sy]
                          for c, x, y, bw, bh in anns], dtype=np.float32).reshape(-1, 5)
        if self.train and self.aug == "strong":
            img, boxes = strong_aug(np.ascontiguousarray(img), boxes)
        if self.train:
            if random.random() < 0.5:  # left-handed golfers exist; the club looks the same
                img = img[:, ::-1]
                boxes[:, 1] = SIZE - boxes[:, 1]
            hsv = cv2.cvtColor(np.ascontiguousarray(img), cv2.COLOR_BGR2HSV).astype(np.int16)
            hsv[..., 0] = (hsv[..., 0] + random.randint(-5, 5)) % 180
            hsv[..., 1] = np.clip(hsv[..., 1] * random.uniform(0.7, 1.3), 0, 255)
            hsv[..., 2] = np.clip(hsv[..., 2] * random.uniform(0.7, 1.3), 0, 255)
            img = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
        labels = np.zeros((MAX_LABELS, 5), dtype=np.float32)
        boxes = boxes[(boxes[:, 3] > 1) & (boxes[:, 4] > 1)][:MAX_LABELS]
        labels[: len(boxes)] = boxes
        # YOLOX (non-legacy) takes raw BGR 0-255, CHW.
        x = torch.from_numpy(np.ascontiguousarray(img.transpose(2, 0, 1))).float()
        return x, torch.from_numpy(labels)


def load_pretrained(model):
    ckpt = torch.load(PRETRAINED, map_location="cpu")["model"]
    own = model.state_dict()
    keep = {k: v for k, v in ckpt.items() if k in own and own[k].shape == v.shape}
    model.load_state_dict(keep, strict=False)
    return len(keep), len(own)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--resume", type=Path)
    ap.add_argument("--aug", choices=["light", "strong"], default="light")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--every", type=int, default=2, help="save epoch_N.pth every N epochs")
    a = ap.parse_args()
    out_dir = a.out
    out_dir.mkdir(parents=True, exist_ok=True)
    dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

    exp = build_exp()
    model = exp.get_model()
    kept, total = load_pretrained(model)
    print(f"pretrained: {kept}/{total} tensors")
    model.to(dev).train()

    ds = ClubSet("train", train=True, aug=a.aug)
    dl = DataLoader(ds, batch_size=a.batch, shuffle=True, num_workers=a.workers,
                    drop_last=True, persistent_workers=True)
    iters = len(dl)

    # YOLOX recipe: SGD, lr 0.01 per 64 images, no weight decay on BN / biases.
    pg_bn, pg_w, pg_b = [], [], []
    for mod in model.modules():
        if hasattr(mod, "bias") and isinstance(mod.bias, torch.nn.Parameter):
            pg_b.append(mod.bias)
        if isinstance(mod, torch.nn.BatchNorm2d):
            pg_bn.append(mod.weight)
        elif hasattr(mod, "weight") and isinstance(mod.weight, torch.nn.Parameter):
            pg_w.append(mod.weight)
    base_lr = 0.01 * a.batch / 64
    opt = torch.optim.SGD(pg_bn, lr=base_lr, momentum=0.9, nesterov=True)
    opt.add_param_group({"params": pg_w, "weight_decay": 5e-4})
    opt.add_param_group({"params": pg_b})
    ema = ModelEMA(model, 0.9998)
    start = 0
    if a.resume:
        ck = torch.load(a.resume, map_location="cpu")
        model.load_state_dict(ck["model"])
        ema.ema.load_state_dict(ck["ema"])
        opt.load_state_dict(ck["opt"])
        ema.updates, start = ck["ema_updates"], ck["epoch"]
    warm = iters  # one epoch of warm-up
    total_it = a.epochs * iters
    log = open(out_dir / "log.jsonl", "a")

    for epoch in range(start, a.epochs):
        t0, run = time.time(), {}
        for i, (x, y) in enumerate(dl):
            it = epoch * iters + i
            lr = (base_lr * (it / warm) ** 2 if it < warm else
                  base_lr * 0.05 + 0.5 * base_lr * 0.95 *
                  (1 + math.cos(math.pi * (it - warm) / max(1, total_it - warm))))
            for g in opt.param_groups:
                g["lr"] = lr
            out = model(x.to(dev), y.to(dev))
            opt.zero_grad()
            out["total_loss"].backward()
            opt.step()
            ema.update(model)
            for k, v in out.items():
                run[k] = run.get(k, 0.0) + float(v)
            if i % 50 == 0:
                el = time.time() - t0
                print(f"ep {epoch + 1}/{a.epochs} it {i}/{iters} loss {float(out['total_loss']):.2f} "
                      f"lr {lr:.5f} {el / max(1, i):.2f}s/it", flush=True)
        row = {"epoch": epoch + 1, "sec": round(time.time() - t0),
               **{k: round(v / iters, 4) for k, v in run.items()}}
        log.write(json.dumps(row) + "\n")
        log.flush()
        print(row, flush=True)
        ck = {"model": model.state_dict(), "ema": ema.ema.state_dict(), "opt": opt.state_dict(),
              "ema_updates": ema.updates, "epoch": epoch + 1, "names": NAMES}
        torch.save(ck, out_dir / "last.pth")
        if (epoch + 1) % a.every == 0 or epoch + 1 == a.epochs:
            torch.save({"ema": ck["ema"], "epoch": epoch + 1, "names": NAMES},
                       out_dir / f"epoch_{epoch + 1}.pth")


if __name__ == "__main__":
    main()
