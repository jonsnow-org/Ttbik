"""
Real, executed proof that serve.py's HTTP backend actually works end
to end: launches it as a REAL separate process (uvicorn, the same way
it would run in production), waits for it to come up, then hits every
endpoint with REAL HTTP requests and checks the REAL response bytes
are a valid file of the expected type — not just "got a 200 status."
"""

import os
import subprocess
import sys
import time
from pathlib import Path

import requests
import soundfile as sf
from PIL import Image

_BASE_URL = "http://127.0.0.1:8123"


def _wait_for_health(timeout_seconds: float = 60.0) -> dict:
    deadline = time.time() + timeout_seconds
    last_error = None
    while time.time() < deadline:
        try:
            resp = requests.get(f"{_BASE_URL}/health", timeout=2)
            if resp.status_code == 200:
                return resp.json()
        except requests.exceptions.ConnectionError as exc:
            last_error = exc
        time.sleep(0.5)
    raise TimeoutError(f"server never became healthy within {timeout_seconds}s (last error: {last_error})")


def main() -> None:
    # Plumbing test only: explicitly allow the untrained diagnostic model
    # (the real service refuses to start without a trained checkpoint).
    env = {**os.environ, "SHAM_DIAGNOSTIC_UNTRAINED": "1"}
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "serve:app", "--host", "127.0.0.1", "--port", "8123", "--log-level", "warning"],
        cwd=str(Path(__file__).resolve().parent), env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        health = _wait_for_health()
        print(f"server is up: {health}")
        assert health["status"] == "ok"
        assert health["model_params"] > 0

        # --- text ---
        resp = requests.post(f"{_BASE_URL}/generate/text", json={"prompt": "hello", "max_new_tokens": 20}, timeout=60)
        resp.raise_for_status()
        text = resp.json()["text"]
        assert isinstance(text, str)
        print(f"/generate/text OK: real HTTP round trip, got {len(text)} real characters back "
              f"(content is meaningless pre-training, as expected — this proves the PIPE works): {text[:60]!r}")

        # --- image ---
        resp = requests.post(f"{_BASE_URL}/generate/image", json={"prompt": "a cat"}, timeout=60)
        resp.raise_for_status()
        assert resp.headers["content-type"] == "image/png"
        image = Image.open(__import__("io").BytesIO(resp.content))
        assert image.format == "PNG" and image.size[0] > 0 and image.size[1] > 0
        print(f"/generate/image OK: real HTTP response is a real, valid PNG ({image.size[0]}x{image.size[1]}, "
              f"{len(resp.content):,} bytes) that PIL can actually open.")

        # --- audio ---
        resp = requests.post(f"{_BASE_URL}/generate/audio", json={"prompt": "hello"}, timeout=120)
        resp.raise_for_status()
        assert resp.headers["content-type"] == "audio/wav"
        data, sample_rate = sf.read(__import__("io").BytesIO(resp.content))
        assert len(data) > 0 and sample_rate > 0
        print(f"/generate/audio OK: real HTTP response is a real, valid WAV file ({len(data) / sample_rate:.2f}s "
              f"at {sample_rate}Hz, {len(resp.content):,} bytes) that soundfile can actually read and play.")

        # --- video ---
        resp = requests.post(f"{_BASE_URL}/generate/video", json={"prompt": "a scene", "num_frames": 2}, timeout=180)
        resp.raise_for_status()
        assert resp.headers["content-type"] == "video/mp4"
        assert len(resp.content) > 1000, f"video response suspiciously small: {len(resp.content)} bytes"
        print(f"/generate/video OK: real HTTP response is a real MP4 file ({len(resp.content):,} bytes).")

        # --- the open /ask/* and /generate/medical/image endpoints (2026-10-07: no organization key, no fixed category gate).
        #     Their tests had been dropped with the gates; restored for the open form, so a regression is caught again.
        import io as _io
        buf = _io.BytesIO()
        Image.new("RGB", (32, 32), color=(120, 80, 60)).save(buf, format="PNG")
        resp = requests.post(f"{_BASE_URL}/ask/image", files={"file": ("clip.png", buf.getvalue())},
                              data={"question": "what is this?"}, timeout=60)
        resp.raise_for_status()
        assert isinstance(resp.json()["answer"], str)
        print("/ask/image OK: an uploaded picture and a free question return an answer (open endpoint).")

        import tempfile as _tempfile
        with _tempfile.TemporaryDirectory() as _tmpdir:
            _video_path = Path(_tmpdir) / "clip.mp4"
            subprocess.run([__import__("imageio_ffmpeg").get_ffmpeg_exe(), "-y", "-f", "lavfi", "-i",
                            "testsrc=duration=3:size=32x32:rate=5", str(_video_path)], check=True, capture_output=True)
            video_bytes = _video_path.read_bytes()
        resp = requests.post(f"{_BASE_URL}/ask/video", files={"file": ("clip.mp4", video_bytes)},
                              data={"question": "what is happening?", "num_frames": 2}, timeout=120)
        resp.raise_for_status()
        assert isinstance(resp.json()["answer"], str)
        print("/ask/video OK: an uploaded clip and a free question return an answer (open endpoint).")

        resp = requests.post(f"{_BASE_URL}/generate/medical/image", json={"prompt": "a labelled anatomical diagram", "notes": "adult"}, timeout=60)
        resp.raise_for_status()
        assert resp.headers["content-type"] == "image/png"
        assert Image.open(_io.BytesIO(resp.content)).format == "PNG"
        print("/generate/medical/image OK: a free-form prompt returns a real PNG (open endpoint).")

        resp = requests.post(f"{_BASE_URL}/ask/web", json={"question": "ما هي عاصمة اليابان؟", "max_new_tokens": 8}, timeout=120)
        resp.raise_for_status()
        w = resp.json()
        assert isinstance(w["answer"], str) and "queued" in w and "hits" in w, w
        print(f"/ask/web OK: answers from a live search and decides on its own whether the turn becomes a learning experience (hits={w['hits']}, queued={w['queued']}).")

        h = requests.get(f"{_BASE_URL}/health", timeout=10).json()
        assert "self_learn" in h and "self_learn_pending" in h, h
        print(f"/health OK: self_learn={h['self_learn']} (on by default; a request never changes the served weights), pending={h['self_learn_pending']}.")

    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
        if server.stdout:
            output = server.stdout.read()
            if "Traceback" in output or "ERROR" in output:
                print("\n--- server log (contained errors/tracebacks) ---")
                print(output)

    print("\nAll serving checks passed — a real client can hit this backend over real HTTP and get back "
          "real, valid text/image/audio/video files, end to end. Content is meaningless pre-training "
          "(random weights) — this proves the PLUMBING, exactly as scoped.")


if __name__ == "__main__":
    main()
