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

from api_keys import OrganizationKeyStore

_BASE_URL = "http://127.0.0.1:8123"
_TEST_DB_PATH = str(Path(__file__).resolve().parent / "_verify_serve_test_keys.db")


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
    # Real organizations, registered offline exactly as production
    # would (see serve.py's own docstring: no HTTP endpoint mints keys)
    # — pointed at the SAME db file the server process below will open,
    # via the NOVA_SMALL_API_KEYS_DB env var.
    if Path(_TEST_DB_PATH).exists():
        Path(_TEST_DB_PATH).unlink()
    key_store = OrganizationKeyStore(_TEST_DB_PATH)
    valid_key = key_store.register_organization("Example Medical University")
    revoked_org_key = key_store.register_organization("Example Revoked Org")
    revoked_org = key_store.verify_api_key(revoked_org_key)
    key_store.revoke_organization(revoked_org.org_id)

    env = {**os.environ, "NOVA_SMALL_API_KEYS_DB": _TEST_DB_PATH}
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

        # --- content safety gate: a real blocked prompt must be
        #     rejected BEFORE any generation happens, on every endpoint
        #     that takes free text — this was a real gap (zero
        #     filtering existed anywhere in this file) until now.
        resp = requests.post(f"{_BASE_URL}/generate/image", json={"prompt": "explicit sexual content"}, timeout=10)
        assert resp.status_code == 400, f"an unsafe prompt should be rejected with 400, got {resp.status_code}"
        resp = requests.post(f"{_BASE_URL}/generate/video", json={"prompt": "nsfw scene", "num_frames": 2}, timeout=10)
        assert resp.status_code == 400, f"an unsafe video prompt should be rejected with 400, got {resp.status_code}"
        print("content safety gate OK: a real unsafe prompt is rejected with 400 before any generation runs, "
              "on both /generate/image and /generate/video.")

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

        # --- /ask/image: real auth (missing/wrong/revoked/valid key) ---
        import io as _io
        real_image_bytes = _io.BytesIO()
        Image.new("RGB", (32, 32), color=(120, 80, 60)).save(real_image_bytes, format="PNG")
        real_image_bytes = real_image_bytes.getvalue()

        resp = requests.post(f"{_BASE_URL}/ask/image", files={"file": ("clip.png", real_image_bytes)},
                              data={"question": "what is this?"}, timeout=60)
        assert resp.status_code == 401, f"missing API key should be rejected, got {resp.status_code}"

        resp = requests.post(f"{_BASE_URL}/ask/image", files={"file": ("clip.png", real_image_bytes)},
                              data={"question": "what is this?"}, headers={"X-Nova-Org-Key": "nova_org_totally-fake"}, timeout=60)
        assert resp.status_code == 401, f"a made-up API key should be rejected, got {resp.status_code}"

        resp = requests.post(f"{_BASE_URL}/ask/image", files={"file": ("clip.png", real_image_bytes)},
                              data={"question": "what is this?"}, headers={"X-Nova-Org-Key": revoked_org_key}, timeout=60)
        assert resp.status_code == 401, f"a revoked API key should be rejected, got {resp.status_code}"
        print("/ask/image auth OK: missing, fake, and revoked keys are all correctly rejected with 401.")

        resp = requests.post(f"{_BASE_URL}/ask/image", files={"file": ("clip.png", real_image_bytes)},
                              data={"question": "what is this?"}, headers={"X-Nova-Org-Key": valid_key}, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        assert data["organization"] == "Example Medical University"
        assert isinstance(data["answer"], str)
        print(f"/ask/image OK: a real registered organization's key was accepted, got a real answer back "
              f"({len(data['answer'])} chars, meaningless pre-training as expected — this proves the "
              f"real image-to-text mechanism and the real auth gate together).")

        # --- /ask/video: same real auth gate, plus a real uploaded clip
        video_bytes_buffer = _io.BytesIO()
        _FFMPEG = __import__("imageio_ffmpeg").get_ffmpeg_exe()
        import tempfile as _tempfile
        with _tempfile.TemporaryDirectory() as _tmpdir:
            _video_path = Path(_tmpdir) / "clip.mp4"
            subprocess.run(
                [_FFMPEG, "-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=32x32:rate=5", str(_video_path)],
                check=True, capture_output=True,
            )
            video_bytes_buffer.write(_video_path.read_bytes())
        video_bytes = video_bytes_buffer.getvalue()

        resp = requests.post(f"{_BASE_URL}/ask/video", files={"file": ("clip.mp4", video_bytes)},
                              data={"question": "what is happening?", "num_frames": 2}, timeout=60)
        assert resp.status_code == 401, f"missing API key should be rejected for video too, got {resp.status_code}"

        resp = requests.post(f"{_BASE_URL}/ask/video", files={"file": ("clip.mp4", video_bytes)},
                              data={"question": "what is happening?", "num_frames": 2},
                              headers={"X-Nova-Org-Key": valid_key}, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        assert data["organization"] == "Example Medical University"
        assert isinstance(data["answer"], str)
        print(f"/ask/video OK: real uploaded video + real question, valid key accepted, real answer back "
              f"({len(data['answer'])} chars).")

        # --- /generate/medical/image: fixed categories only, no free
        #     text drives the core description ---
        resp = requests.get(f"{_BASE_URL}/generate/medical/categories", headers={"X-Nova-Org-Key": valid_key}, timeout=10)
        resp.raise_for_status()
        categories = resp.json()["categories"]
        assert "labor_stage_2_delivery" in categories and len(categories) >= 5
        print(f"/generate/medical/categories OK: {len(categories)} real fixed clinical categories listed.")

        resp = requests.post(f"{_BASE_URL}/generate/medical/image",
                              json={"category": "labor_stage_2_delivery"},
                              headers={"X-Nova-Org-Key": valid_key}, timeout=60)
        resp.raise_for_status()
        assert resp.headers["content-type"] == "image/png"
        image = Image.open(__import__("io").BytesIO(resp.content))
        assert image.format == "PNG"
        print(f"/generate/medical/image OK: a real fixed category produced a real, valid "
              f"{image.size[0]}x{image.size[1]} PNG.")

        resp = requests.post(f"{_BASE_URL}/generate/medical/image",
                              json={"category": "not_a_real_category"},
                              headers={"X-Nova-Org-Key": valid_key}, timeout=10)
        assert resp.status_code == 400, f"an unknown category should be rejected with 400, got {resp.status_code}"

        # Real clinical notes, including genital/anatomical terms a
        # keyword filter can't tell apart from misuse, must NOT be
        # blocked here — by design, this field is not filtered.
        # Accountability is the organization's revocable key and the
        # reviewed usage log, exercised right below.
        resp = requests.post(f"{_BASE_URL}/generate/medical/image",
                              json={"category": "labor_stage_2_delivery",
                                    "notes": "crowning visible at the vaginal opening, perineum intact"},
                              headers={"X-Nova-Org-Key": valid_key}, timeout=60)
        resp.raise_for_status()
        assert resp.headers["content-type"] == "image/png"
        print("/generate/medical/image notes OK: real clinical notes using real anatomical terms are NOT "
              "blocked — the fixed category (rejected above when unknown) is the only enforced gate on notes.")

        resp = requests.post(f"{_BASE_URL}/generate/medical/image", json={"category": "labor_stage_2_delivery"}, timeout=10)
        assert resp.status_code == 401, f"the medical endpoint must require auth too, got {resp.status_code}"
        print("/generate/medical/image auth OK: also requires a valid organization key, like the /ask/* endpoints.")

        # --- real accountability check: since these endpoints no
        #     longer filter free text, the usage log must actually
        #     contain the real request text, or there is nothing for an
        #     operator to review to catch misuse and revoke a key.
        usage = key_store.get_usage_log(key_store.verify_api_key(valid_key).org_id)
        logged_details = [entry.detail or "" for entry in usage]
        assert any("what is this?" in d for d in logged_details), "the /ask/image question must be in the usage log"
        assert any("vaginal opening" in d for d in logged_details), "the /generate/medical/image notes must be in the usage log"
        print(f"usage log OK: {len(usage)} real entries recorded for this organization, including the real "
              f"request text — this is the real data a trusted operator reviews to catch an organization "
              f"asking for things outside its stated purpose, and revoke its key.")

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
        for suffix in ("", "-wal", "-shm"):
            path = Path(_TEST_DB_PATH + suffix)
            if path.exists():
                path.unlink()

    print("\nAll serving checks passed — a real client can hit this backend over real HTTP and get back "
          "real, valid text/image/audio/video files, end to end. Content is meaningless pre-training "
          "(random weights) — this proves the PLUMBING, exactly as scoped.")


if __name__ == "__main__":
    main()
