"""Face-image curation with MediaPipe on CPU (Apache-2.0): is there one clear, reasonably frontal, sharp face, and what is it doing (mouth, blink)?

OPTIONAL and accepted by the Sham session ONLY IF MEASURED: include it in training data selection only when the image tokenizer's held-out error improves
on the filtered set versus the unfiltered one (protocol in README.md). Needs `pip install mediapipe pillow` (not numpy-only) and the model file
(Apache-2.0, ~3.7 MB):  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
It PREPARES and MEASURES data only; it never decides what a model draws or says.

   python face_curation.py --model face_landmarker.task img1.jpg img2.png ...     -> one JSON line per image
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np

# MediaPipe FaceMesh landmark indices
R_EYE_OUT, R_EYE_IN, L_EYE_IN, L_EYE_OUT = 33, 133, 362, 263
NOSE, CHIN, FOREHEAD = 1, 152, 10
LIP_UP_IN, LIP_LOW_IN = 13, 14
R_UP, R_LOW, L_UP, L_LOW = 159, 145, 386, 374


def make_landmarker(model_path: str):
    from mediapipe.tasks import python as mpp
    from mediapipe.tasks.python import vision
    opts = vision.FaceLandmarkerOptions(base_options=mpp.BaseOptions(model_asset_path=model_path), num_faces=2, output_face_blendshapes=True,
                                        running_mode=vision.RunningMode.IMAGE)
    return vision.FaceLandmarker.create_from_options(opts)


def laplacian_sharpness(gray: np.ndarray) -> float:
    """Variance of the Laplacian (higher = sharper); numpy only."""
    g = gray.astype(np.float64)
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return float(lap.var())


def measure(landmarker, path: str) -> dict:
    import mediapipe as mp
    from PIL import Image
    img = Image.open(path).convert("RGB")
    arr = np.asarray(img)
    h, w = arr.shape[:2]
    res = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(arr)))
    out: dict = {"path": path, "width": w, "height": h, "faces": len(res.face_landmarks)}
    if not res.face_landmarks:
        out.update({"ok": False, "score": 0.0, "why": "no face"})
        return out
    lm = np.array([[p.x, p.y, p.z] for p in res.face_landmarks[0]])
    xy = lm[:, :2] * [w, h]
    iod = np.linalg.norm(xy[R_EYE_OUT] - xy[L_EYE_OUT]) + 1e-9
    mid_eye = (xy[R_EYE_OUT] + xy[L_EYE_OUT]) / 2
    face_h = np.linalg.norm(xy[FOREHEAD] - xy[CHIN]) + 1e-9
    x0, y0 = np.maximum(0, xy.min(axis=0)).astype(int)
    x1, y1 = np.minimum([w, h], xy.max(axis=0)).astype(int)
    crop = arr[y0:y1, x0:x1].mean(axis=2) if (x1 - x0 > 8 and y1 - y0 > 8) else arr.mean(axis=2)
    bs = {c.category_name: c.score for c in (res.face_blendshapes[0] if res.face_blendshapes else [])}
    ear = lambda up, low, a, b: np.linalg.norm(xy[up] - xy[low]) / (np.linalg.norm(xy[a] - xy[b]) + 1e-9)
    out.update({
        "face_area": float((x1 - x0) * (y1 - y0) / (w * h)),
        "yaw_proxy": float((xy[NOSE, 0] - mid_eye[0]) / iod),              # 0 = frontal, +-0.5 = strongly turned
        "pitch_proxy": float((xy[NOSE, 1] - mid_eye[1]) / face_h),          # about 0.3 when level
        "roll_deg": float(np.degrees(np.arctan2(xy[L_EYE_OUT, 1] - xy[R_EYE_OUT, 1], xy[L_EYE_OUT, 0] - xy[R_EYE_OUT, 0]))),
        "mouth_open": float(bs.get("jawOpen", np.linalg.norm(xy[LIP_UP_IN] - xy[LIP_LOW_IN]) / face_h)),
        "blink": float((bs.get("eyeBlinkLeft", 0) + bs.get("eyeBlinkRight", 0)) / 2) if bs else float(1 - min(1.0, (ear(R_UP, R_LOW, R_EYE_OUT, R_EYE_IN) + ear(L_UP, L_LOW, L_EYE_IN, L_EYE_OUT)) / 0.6)),
        "sharpness": laplacian_sharpness(crop) if min(crop.shape) > 4 else 0.0,
        "brightness": float(crop.mean() / 255),
    })
    return out


def score(m: dict, *, min_area=0.08, max_yaw=0.28, max_roll=20.0, min_sharp=20.0) -> dict:
    """Transparent rule of thumb (every factor in 0..1, the score is their product); tune the thresholds on your own data with the protocol in README.md."""
    if m.get("faces", 0) == 0 or "face_area" not in m:
        return m
    f = {
        "one_face": 1.0 if m["faces"] == 1 else 0.5,
        "size": min(1.0, m["face_area"] / min_area),
        "frontal": max(0.0, 1 - abs(m["yaw_proxy"]) / max_yaw) ** 0.5,
        "level": max(0.0, 1 - abs(m["roll_deg"]) / max_roll),
        "sharp": min(1.0, m["sharpness"] / min_sharp),
        "exposure": 1.0 if 0.2 < m["brightness"] < 0.85 else 0.5,
        "eyes_open": 1.0 - 0.7 * min(1.0, m["blink"]),
    }
    m["factors"] = {k: round(v, 3) for k, v in f.items()}
    m["score"] = round(float(np.prod(list(f.values()))), 4)
    m["ok"] = m["score"] >= 0.5
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("images", nargs="+")
    a = ap.parse_args()
    lmk = make_landmarker(a.model)
    for p in a.images:
        try:
            print(json.dumps(score(measure(lmk, p)), ensure_ascii=False))
        except Exception as e:                                    # a broken file must not stop a batch
            print(json.dumps({"path": p, "ok": False, "score": 0.0, "why": f"{e.__class__.__name__}: {e}"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
