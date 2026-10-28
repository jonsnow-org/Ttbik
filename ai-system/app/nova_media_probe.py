"""Smoke probe for the deployed Nova media Studio (image, Arabic speech, real AnimateDiff video).

Judges CONTENT, not payload size: picture spread (pixel std), audible samples, a decoded video with more than one frame and
real frame-to-frame motion. Waits for the new Studio to be ready first (a probe that races the deploy hits the old code).
The token is only ever sent as a Bearer header and is never printed. Run:  python nova_media_probe.py  (env: MODELSCOPE_TOKEN, NOVA_MEDIA_URL)
"""
from __future__ import annotations

import base64
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import wave
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

MIN_PIXEL_STD = 8.0
MIN_MOTION = 0.05          # mean absolute grey-level change between consecutive frames (0..255)
ENGINE = "AnimateDiff-Lightning"


class ProbeError(RuntimeError):
    pass


def verify_image(raw: bytes) -> dict:
    import numpy as np
    from PIL import Image
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
        g = np.asarray(img.convert("L"), dtype="float64")
    except Exception as exc:                                                    # noqa: BLE001
        raise ProbeError(f"image: not a decodable picture ({type(exc).__name__})") from exc
    std, lo, hi = float(g.std()), float(g.min()), float(g.max())
    if std < MIN_PIXEL_STD or hi - lo < 24:
        raise ProbeError(f"image: black or constant picture (pixel std {std:.1f}, range {hi - lo:.0f})")
    return {"width": img.size[0], "height": img.size[1], "std": round(std, 1), "mean": round(float(g.mean()), 1)}


def verify_audio(raw: bytes) -> dict:
    import numpy as np
    try:
        with wave.open(io.BytesIO(raw), "rb") as w:
            n, rate, width, ch = w.getnframes(), w.getframerate(), w.getsampwidth(), w.getnchannels()
            data = w.readframes(n)
    except Exception as exc:                                                    # noqa: BLE001
        raise ProbeError(f"audio: not a decodable WAV ({type(exc).__name__})") from exc
    if width != 2 or n <= 0 or rate <= 0:
        raise ProbeError(f"audio: unsupported or empty WAV ({n} frames, {width * 8}-bit)")
    x = np.frombuffer(data, dtype="<i2").astype("float64") / 32768.0
    peak, seconds = float(np.abs(x).max()), n / rate
    if seconds < 0.2 or peak < 0.01 or x.std() < 0.0025:
        raise ProbeError(f"audio: silent or too short (peak {peak:.4f}, {seconds:.2f}s)")
    return {"seconds": round(seconds, 2), "peak": round(peak, 3), "rate": rate, "channels": ch}


def verify_video(raw: bytes) -> dict:
    import numpy as np
    exe = shutil.which("ffmpeg")
    if not exe:
        try:
            import imageio_ffmpeg
            exe = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:                                                       # noqa: BLE001
            raise ProbeError("video: no ffmpeg available to decode the clip") from None
    side = 96
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "in.mp4")
        with open(src, "wb") as fh:
            fh.write(raw)
        proc = subprocess.run([exe, "-v", "error", "-i", src, "-vf", f"scale={side}:{side}", "-pix_fmt", "gray", "-f", "rawvideo", "-"],
                              capture_output=True, timeout=120)
    if len(proc.stdout) < side * side:
        raise ProbeError(f"video: could not decode any frame ({proc.stderr.decode(errors='replace')[:120]})")
    f = np.frombuffer(proc.stdout[: len(proc.stdout) // (side * side) * side * side], dtype="u1").reshape(-1, side, side).astype("float64")
    if len(f) < 2:
        raise ProbeError(f"video: only {len(f)} decoded frame")
    stds = [float(x.std()) for x in f]
    motion = float(np.abs(f[1:] - f[:-1]).mean())
    if max(stds) < 2.0:
        raise ProbeError("video: every frame is blank")
    if motion < MIN_MOTION:
        raise ProbeError(f"video: no motion between frames (mean change {motion:.3f})")
    return {"frames": int(len(f)), "motion": round(motion, 2), "frame_std": round(float(np.mean(stds)), 1), "bytes": len(raw)}


def _urllib(token: str):
    def http(method: str, url: str, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = Request(url, data=data, method=method, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        try:
            with urlopen(req, timeout=90) as res:
                return res.status, res.read().decode("utf-8", errors="replace")
        except HTTPError as exc:
            return exc.code, exc.read().decode("utf-8", errors="replace")[:200]
        except (URLError, OSError, HTTPException) as exc:                          # a dropped connection / cut stream (a restarting Studio): code 0 = transient
            return 0, type(exc).__name__
    return http


def _unwrap(body: str):
    for line in body.splitlines():
        if line.startswith("data:"):
            try:
                v = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            v = v[0] if isinstance(v, list) and v else v
            if v is None:                                                       # "event: heartbeat / data: null": the result has not arrived yet, keep reading
                continue
            if isinstance(v, str):
                try:
                    return json.loads(v)
                except json.JSONDecodeError:
                    return v
            return v
    return None


class Studio:
    def __init__(self, base: str, token: str, http=None, *, sleep=time.sleep, now=time.time):
        self.base, self.http, self.sleep, self.now = base.rstrip("/"), http or _urllib(token), sleep, now

    def call(self, api: str, payload: dict, timeout: float = 900) -> dict:
        code, text = self.http("POST", f"{self.base}/gradio_api/call/v2/{api}", {} if api == "status" else {"body": json.dumps(payload)})
        if code == 404:
            raise ProbeError(f"the Studio has no '{api}' API: it is still running OLD code (deploy not finished or not applied)")
        if code != 200:
            raise ProbeError(f"{api}: HTTP {code} from the Studio")
        try:
            event = json.loads(text).get("event_id")
        except json.JSONDecodeError:
            event = None
        if not event:
            raise ProbeError(f"{api}: the Studio returned no event_id")
        end = self.now() + timeout
        while self.now() < end:
            code, text = self.http("GET", f"{self.base}/gradio_api/call/{api}/{event}")
            if code in (404, 410):
                raise ProbeError(f"{api}: the Studio no longer knows this job (it restarted while working on it)")
            value = _unwrap(text) if code == 200 else None
            if value is not None:
                if not isinstance(value, dict):
                    raise ProbeError(f"{api}: unexpected reply {str(value)[:120]}")
                return value
            self.sleep(3)
        raise ProbeError(f"{api}: no result after {timeout:.0f}s")

    def status(self) -> dict:
        return self.call("status", {}, timeout=60)

    def wait_ready(self, timeout: float = 1500) -> dict:
        """Poll `status` until the Studio says phase=ready with the AnimateDiff video engine (the new code), else raise."""
        end, last = self.now() + timeout, None
        while True:
            try:
                last = self.status()
            except ProbeError as exc:
                last = {"error": str(exc)[:120]}
            if last.get("phase") == "ready":
                eng = (last.get("video") or {}).get("engine")
                if eng == ENGINE:
                    return last
                if self.now() + 120 >= end:
                    raise ProbeError(f"the Studio is ready but runs OLD code: its status has no {ENGINE} video engine (engine={eng!r})")
            if self.now() >= end:
                raise ProbeError(f"the Studio was not ready in {timeout:.0f}s; last status: {json.dumps(last)[:200]}")
            self.sleep(15)


def _bytes(reply: dict, kind: str, label: str) -> bytes:
    if reply.get("type") != kind or not reply.get("b64"):
        raise ProbeError(f"{label}: expected {kind}, got {reply.get('type')!r} {str(reply.get('text') or reply.get('detail') or '')[:160]}")
    return base64.b64decode(reply["b64"], validate=False)


def main() -> int:
    base = os.environ.get("NOVA_MEDIA_URL") or "https://studio-novaai2026-nova-media-server.api-inference.modelscope.net"
    token = (os.environ.get("MODELSCOPE_TOKEN") or "").strip()
    if not token:
        print("MODELSCOPE_TOKEN is not set")
        return 2
    outdir = os.environ.get("PROBE_OUT", ".")
    st = Studio(base, token)
    failures = []
    try:
        s = st.wait_ready(float(os.environ.get("READY_TIMEOUT", "1500")))
        print(f"READY phase={s.get('phase')} video_engine={(s.get('video') or {}).get('engine')} cpus={s.get('cpus')}")
    except ProbeError as exc:
        print(f"FAIL ready: {exc}")
        return 1
    steps = [
        ("image", "image", {"prompt": "a small red apple on a clean white table, natural light", "size": 512, "seed": 17}, verify_image, "probe.png", "image"),
        ("speech", "audio", {"text": "مرحبا، هذا اختبار صوت نوفا العربي."}, verify_audio, "probe.wav", "speech"),
        ("video", "video", {"prompt": "a red apple slowly rotating on a white table, camera slowly orbiting", "seconds": 1, "seed": 17}, verify_video, "probe.mp4", "video"),
    ]
    for api, kind, payload, verify, fname, label in steps:
        t0 = time.time()
        try:
            raw = _bytes(st.call(api, payload), kind, label)
            with open(os.path.join(outdir, fname), "wb") as fh:
                fh.write(raw)
            print(f"PASS {label}: {len(raw)} bytes in {time.time() - t0:.0f}s {json.dumps(verify(raw))}")
        except ProbeError as exc:
            failures.append(label)
            print(f"FAIL {label}: {exc}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
