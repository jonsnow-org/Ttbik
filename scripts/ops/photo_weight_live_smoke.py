#!/usr/bin/env python3
"""Live, model-identity-checked image smoke test for a dedicated ModelScope photo Studio.

The script submits one benign prompt to the selected Studio only. It verifies
that the returned checkpoint matches the expected private repository and SHA,
then decodes the actual PNG and reports visual-content metrics.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def _request(url: str, *, method: str = "GET", payload: dict | None = None, timeout: int = 60):
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    return urllib.request.urlopen(req, timeout=timeout)


def _event_value(url: str, api: str, data: list, timeout: int):
    with _request(f"{url}/gradio_api/call/{api}", method="POST", payload={"data": data}, timeout=45) as response:
        submitted = json.loads(response.read().decode("utf-8"))
    event_id = str(submitted.get("event_id") or "")
    if not event_id:
        raise RuntimeError(f"{api}: Gradio returned no event_id: {str(submitted)[:300]}")
    result_url = f"{url}/gradio_api/call/{api}/{urllib.parse.quote(event_id, safe='')}"
    deadline = time.monotonic() + timeout
    last_event = ""
    values = []
    with _request(result_url, timeout=timeout) as response:
        while time.monotonic() < deadline:
            raw = response.readline()
            if not raw:
                break
            line = raw.decode("utf-8", errors="replace").strip()
            if line.startswith("event:"):
                last_event = line[6:].strip()
            elif line.startswith("data:"):
                payload = line[5:].strip()
                try:
                    values.append(json.loads(payload))
                except json.JSONDecodeError:
                    continue
                if last_event == "error":
                    raise RuntimeError(f"{api}: Gradio error event: {payload[:500]}")
                if last_event == "complete":
                    return values[-1]
    raise TimeoutError(f"{api}: no complete Gradio event within {timeout}s")


def _walk(value):
    if isinstance(value, str):
        try:
            yield from _walk(json.loads(value))
        except Exception:
            return
    elif isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def _normalize_single(value):
    while isinstance(value, list) and len(value) == 1:
        value = value[0]
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return value
    return value


def _safe_file_path(file_obj: dict) -> str:
    raw_path = str(file_obj.get("path") or "")
    if not raw_path and file_obj.get("url"):
        raw_path = urllib.parse.urlparse(str(file_obj["url"])).path
    marker = "/gradio_api/file="
    if marker in raw_path:
        raw_path = raw_path.split(marker, 1)[1]
    raw_path = raw_path.lstrip("/")
    parts = Path(raw_path).parts
    if not raw_path or any(part in ("..", ".") for part in parts) or "\\0" in raw_path:
        raise RuntimeError("Studio returned an unsafe or empty generated-image path.")
    return raw_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--aspect", required=True)
    parser.add_argument("--steps", type=int, required=True)
    parser.add_argument("--cfg", type=float, required=True)
    parser.add_argument("--out", default="/tmp/photo-weight-smoke.png")
    parser.add_argument("--timeout", type=int, default=1200)
    args = parser.parse_args()
    base = args.api.rstrip("/")
    if not TOKEN:
        raise RuntimeError("MODELSCOPE_TOKEN is missing.")
    if not re.fullmatch(r"[a-f0-9]{64}", args.sha256, re.I):
        raise ValueError("Expected checkpoint SHA-256 is invalid.")

    status = _normalize_single(_event_value(base, "status", [], 90))
    if not isinstance(status, dict):
        raise RuntimeError(f"Studio status is not a JSON object: {str(status)[:300]}")
    if status.get("phase") != "ready":
        raise RuntimeError("Studio is not ready: " + json.dumps(status, ensure_ascii=False)[:1200])
    status_repo = str(status.get("model_repo") or status.get("modelscope_model_repo") or "")
    status_hash = str(status.get("checkpoint_sha256") or "")
    if status_repo != args.repo:
        raise RuntimeError(f"Wrong Studio model repo: expected {args.repo}, got {status_repo or 'missing'}.")
    if status_hash.lower() != args.sha256.lower():
        raise RuntimeError(f"Wrong checkpoint SHA-256: expected {args.sha256}, got {status_hash or 'missing'}.")

    prompt = "A red bicycle leaning against an old brick wall on a quiet European street, soft morning sunlight, realistic editorial photograph, natural colors, detailed textures, professional photography"
    negative = "cartoon, anime, illustration, drawing, painting, cgi, 3d render, doll, plastic skin, waxy skin, airbrushed, deformed eyes, asymmetrical eyes, bad anatomy, bad proportions, malformed hands, extra fingers, fused fingers, missing fingers, extra limbs, blurry, low quality, jpeg artifacts, watermark, logo, text"
    started = time.monotonic()
    result = _event_value(base, "image", [prompt, negative, args.aspect, args.steps, args.cfg, 314159], args.timeout)
    elapsed = round(time.monotonic() - started, 2)

    values = result if isinstance(result, list) else [result]
    objs = list(_walk(values))
    metadata = next((obj for obj in objs if obj.get("result") == "image_generated"), None)
    file_obj = next((obj for obj in objs if isinstance(obj.get("path"), str) or isinstance(obj.get("url"), str)), None)
    if not metadata or not file_obj:
        raise RuntimeError("Image Studio completed without a file and image_generated metadata.")
    if metadata.get("model_repo") != args.repo:
        raise RuntimeError("Generated image metadata belongs to a different model repository.")
    if str(metadata.get("checkpoint_sha256") or "").lower() != args.sha256.lower():
        raise RuntimeError("Generated image checkpoint SHA-256 does not match the selected model.")
    rel = _safe_file_path(file_obj)
    download = base + "/gradio_api/file=/" + "/".join(urllib.parse.quote(p, safe="") for p in rel.split("/"))
    with _request(download, timeout=120) as response:
        image_bytes = response.read()
    if len(image_bytes) < 1000:
        raise RuntimeError(f"Generated PNG is suspiciously small: {len(image_bytes)} bytes.")

    from PIL import Image
    import numpy as np
    from io import BytesIO
    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    pixels = np.asarray(image, dtype=np.float32)
    gray = pixels.mean(axis=2)
    stats = {
        "width": image.width,
        "height": image.height,
        "gray_std": round(float(gray.std()), 2),
        "gray_range": round(float(gray.max() - gray.min()), 2),
        "distinct_colors_64px": len(set(image.resize((64, 64)).getdata())),
    }
    if image.width < 256 or image.height < 256 or stats["gray_std"] < 8 or stats["gray_range"] < 24 or stats["distinct_colors_64px"] < 200:
        raise RuntimeError("Generated image failed basic visual-content checks: " + json.dumps(stats))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_bytes(image_bytes)
    print(json.dumps({
        "status": "PASS",
        "studio": base,
        "model_repo": args.repo,
        "checkpoint_sha256": args.sha256,
        "generation_seconds": elapsed,
        "image_bytes": len(image_bytes),
        "image": stats,
        "metadata": {k: metadata.get(k) for k in ("model", "source", "steps", "guidance_scale", "cfg", "seed", "precision", "seconds")},
        "artifact": args.out,
    }, ensure_ascii=False, indent=2))
    return 0


TOKEN = (os.environ.get("MODELSCOPE_TOKEN") or os.environ.get("MODELSCOPE_API_TOKEN") or "").strip()

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as exc:
        body = exc.read(1000).decode("utf-8", errors="replace")
        print(f"HTTP {exc.code}: {body}", file=sys.stderr)
        raise SystemExit(1)
    except Exception as exc:
        print(f"FAIL {type(exc).__name__}: {str(exc)[:1600]}", file=sys.stderr)
        raise SystemExit(1)
