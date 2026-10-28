"""The Nova media smoke probe must judge CONTENT (pixel spread, audible samples, decoded frames with motion), wait for the
new Studio to be ready (the old one has no `speech`), and say clearly what is wrong. No network: the HTTP layer is injected."""
import base64
import io
import json
import math
import os
import shutil
import struct
import subprocess
import tempfile
import unittest
import wave

import numpy as np
from PIL import Image

import nova_media_probe as P


def png(arr) -> bytes:
    b = io.BytesIO()
    Image.fromarray(arr.astype("uint8")).save(b, "PNG")
    return b.getvalue()


def scene(size=128):
    y, x = np.mgrid[0:size, 0:size]
    a = (x * 255 / size + 40 * np.sin(y / 9.0)).clip(0, 255)
    a[30:90, 40:100] = 230 - a[30:90, 40:100] * 0.5
    return np.stack([a, a * 0.8, 255 - a], axis=-1)


def wav(samples, rate=16000) -> bytes:
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1), w.setsampwidth(2), w.setframerate(rate)
        w.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return b.getvalue()


def clip(moving: bool) -> bytes:
    d = tempfile.mkdtemp()
    try:
        for i in range(8):
            a = scene(96).copy()
            if moving:
                a[10:40, 5 + i * 9:35 + i * 9] = 255
            Image.fromarray(a.astype("uint8")).save(f"{d}/f{i:02d}.png")
        out = f"{d}/o.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "8", "-i", f"{d}/f%02d.png", "-pix_fmt", "yuv420p", out], check=True)
        with open(out, "rb") as fh:
            return fh.read()
    finally:
        shutil.rmtree(d, ignore_errors=True)


class Image_(unittest.TestCase):
    def test_black_picture_is_rejected(self):
        with self.assertRaises(P.ProbeError) as c:
            P.verify_image(png(np.zeros((128, 128, 3))))
        self.assertIn("image", str(c.exception))

    def test_real_picture_reports_pixel_std(self):
        m = P.verify_image(png(scene()))
        self.assertGreater(m["std"], 20)

    def test_garbage_bytes_are_rejected(self):
        with self.assertRaises(P.ProbeError):
            P.verify_image(b"not a png at all")


class Audio_(unittest.TestCase):
    def test_silence_is_rejected(self):
        with self.assertRaises(P.ProbeError):
            P.verify_audio(wav([0] * 16000))

    def test_tone_passes(self):
        m = P.verify_audio(wav([int(9000 * math.sin(i / 7.0)) for i in range(16000)]))
        self.assertGreater(m["peak"], 0.1)
        self.assertGreaterEqual(m["seconds"], 0.9)


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg needed to build and decode a clip")
class Video_(unittest.TestCase):
    def test_moving_clip_reports_frames_and_motion(self):
        m = P.verify_video(clip(True))
        self.assertGreater(m["frames"], 1)
        self.assertGreater(m["motion"], 0.05)

    def test_frozen_clip_is_rejected(self):
        with self.assertRaises(P.ProbeError) as c:
            P.verify_video(clip(False))
        self.assertIn("motion", str(c.exception))

    def test_truncated_clip_is_rejected(self):
        with self.assertRaises(P.ProbeError):
            P.verify_video(clip(True)[:300])


class FakeStudio:
    """Scripted HTTP layer: (method, url, payload) -> (status, text)."""
    def __init__(self, status_replies, apis=("image", "speech", "video", "status")):
        self.status_replies, self.apis, self.calls, self.n = list(status_replies), set(apis), [], 0

    def __call__(self, method, url, payload=None):
        self.calls.append((method, url))
        api = url.split("/call/v2/")[-1] if "/call/v2/" in url else url.rsplit("/call/", 1)[-1].rsplit("/", 1)[0]
        if api not in self.apis:
            return 404, '{"detail":"Not Found"}'
        if method == "POST":
            return 200, '{"event_id":"e-' + api + '"}'
        body = self.status_replies[min(self.n, len(self.status_replies) - 1)] if api == "status" else payload_for(api)
        if api == "status":
            self.n += 1
        return 200, "event: complete\ndata: " + json.dumps([json.dumps(body)]) + "\n\n"


def payload_for(api):
    raw = {"image": png(scene()), "speech": wav([int(9000 * math.sin(i / 7.0)) for i in range(16000)])}.get(api, b"x")
    return {"type": {"image": "image", "speech": "audio"}.get(api, api), "b64": base64.b64encode(raw).decode()}


class Sse(unittest.TestCase):
    def test_heartbeat_before_the_result_is_skipped(self):
        body = 'event: heartbeat\ndata: null\n\nevent: heartbeat\ndata: null\n\nevent: complete\ndata: ["{\\"type\\": \\"video\\", \\"b64\\": \\"QQ==\\"}"]\n\n'
        self.assertEqual(P._unwrap(body), {"type": "video", "b64": "QQ=="})

    def test_only_heartbeats_means_not_ready_yet(self):
        self.assertIsNone(P._unwrap("event: heartbeat\ndata: null\n\n"))


class Waiting(unittest.TestCase):
    def studio(self, http, **kw):
        t = [0.0]
        return P.Studio("https://x.test", "tok", http, sleep=lambda s: t.__setitem__(0, t[0] + s), now=lambda: t[0], **kw)

    def test_waits_until_phase_ready(self):
        http = FakeStudio([{"phase": "loading"}, {"phase": "loading"}, {"phase": "ready", "video": {"engine": "AnimateDiff-Lightning", "ready": True}}])
        st = self.studio(http).wait_ready(timeout=600)
        self.assertEqual(st["phase"], "ready")
        self.assertEqual(http.n, 3)

    def test_old_studio_without_the_video_engine_is_named_as_stale(self):
        http = FakeStudio([{"phase": "ready"}], apis=("image", "status"))     # the old slideshow Studio: no `video` block in its status
        with self.assertRaises(P.ProbeError) as c:
            self.studio(http).wait_ready(timeout=60)
        self.assertIn("old", str(c.exception).lower())
        self.assertIn("AnimateDiff", str(c.exception))

    def test_missing_api_says_old_studio_not_a_bare_404(self):
        http = FakeStudio([{"phase": "ready"}], apis=("image", "status"))
        with self.assertRaises(P.ProbeError) as c:
            self.studio(http).call("speech", {"text": "x"})
        self.assertIn("speech", str(c.exception))
        self.assertIn("old", str(c.exception).lower())

    def test_never_ready_times_out_with_last_status(self):
        http = FakeStudio([{"phase": "loading"}])
        with self.assertRaises(P.ProbeError) as c:
            self.studio(http).wait_ready(timeout=30)
        self.assertIn("loading", str(c.exception))

    def test_token_is_never_in_an_error(self):
        http = FakeStudio([{"phase": "loading"}])
        with self.assertRaises(P.ProbeError) as c:
            self.studio(http).wait_ready(timeout=10)
        self.assertNotIn("tok", str(c.exception).replace("token", ""))

    def test_a_cut_connection_while_waiting_is_retried_not_a_crash(self):
        inner = FakeStudio([{"phase": "ready"}])
        state = {"cut": 2}
        def flaky(method, url, payload=None):
            if method == "GET" and "/call/image/" in url and state["cut"] > 0:
                state["cut"] -= 1
                return 0, "IncompleteRead"
            return inner(method, url, payload)
        out = self.studio(flaky).call("image", {"prompt": "x"})
        self.assertEqual(out["type"], "image")
        self.assertEqual(state["cut"], 0)

    def test_a_job_the_studio_forgot_is_a_clear_error(self):
        def gone(method, url, payload=None):
            return (404, "gone") if method == "GET" else (200, '{"event_id":"e"}')
        with self.assertRaises(P.ProbeError) as c:
            self.studio(gone).call("video", {"prompt": "x"})
        self.assertIn("restarted", str(c.exception))

    def test_call_returns_decoded_json(self):
        out = self.studio(FakeStudio([{"phase": "ready"}])).call("image", {"prompt": "x"})
        self.assertEqual(out["type"], "image")


if __name__ == "__main__":
    unittest.main()
