#!/usr/bin/env python3
"""python test_media_workers.py -> contracts of the four-direction workers against a fake service shaped like Sham's real endpoints (serve.py). It checks the contract and the gate, not Sham's quality."""
import io
import json
import math
import os
import struct
import sys
import tempfile
import threading
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tasks import Coordinator  # noqa: E402
from media_workers import ShamMedia, install, quality_of  # noqa: E402

TESTS = []
SEEN = {}


def test(f):
    TESTS.append(f)
    return f


def png(kind):
    n = 64
    if kind == "good":
        y, x = np.mgrid[0:n, 0:n]
        a = np.stack([x * 4 % 256, y * 4 % 256, (x + y) * 2 % 256], -1).astype("uint8")
    elif kind == "noise":
        a = np.random.RandomState(0).randint(0, 256, (n, n, 3), dtype="uint8")
    else:
        a = np.zeros((n, n, 3), dtype="uint8")
    b = io.BytesIO(); Image.fromarray(a).save(b, "PNG"); return b.getvalue()


def wav(kind):
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"".join(struct.pack("<h", int(12000 * math.sin(i / 8)) if kind == "good" else 0) for i in range(16000)))
    return b.getvalue()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        SEEN[self.path] = body
        p = self.path
        if p.startswith("/ask/"):
            assert b'name="file"' in body and b'name="question"' in body, "multipart contract"
            return self._send(200, json.dumps({"answer": f"answer about the {p.split('/')[-1]}", "queued": False}).encode())
        req = json.loads(body)
        if p == "/generate/text":
            return self._send(200, json.dumps({"text": "# Report\n" + req["prompt"]}).encode())
        mode = req["prompt"].split()[0]
        if p == "/generate/image":
            return self._send(200, png(mode), "image/png")
        if p == "/generate/audio":
            return self._send(200, wav(mode), "audio/wav")
        if p == "/generate/video":
            return self._send(503, json.dumps({"detail": "native-video-unavailable: no motion tokenizer beside the served checkpoint"}).encode())
        self._send(404, b"{}")


def served():
    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, ShamMedia(f"http://127.0.0.1:{srv.server_port}", timeout=10)


class P:
    def __init__(self, plan):
        self.p = plan

    def plan(self, goal):
        return self.p


def coord(plan):
    srv, media = served()
    c = Coordinator(tempfile.mkdtemp(prefix="media_"), P(plan))
    install(c, media)
    open(os.path.join(c.dir, "photo.png"), "wb").write(png("good"))
    open(os.path.join(c.dir, "voice.wav"), "wb").write(wav("good"))
    return c


@test
def see_hear_write_make_run_through_the_service_contract_and_every_output_is_a_file():
    plan = [{"id": "look", "kind": "see", "args": {"media": "image", "file": "photo.png", "question": "what is here?"}, "check": {"file": "look.json", "has": "answer about the image"}},
            {"id": "listen", "kind": "hear", "args": {"file": "voice.wav"}, "check": {"file": "listen.json", "has": "answer about the audio"}},
            {"id": "text", "kind": "write", "args": {"prompt": "write the report"}, "needs": ["look", "listen"], "check": {"file": "text.md", "has": "# Report"}},
            {"id": "pic", "kind": "make", "args": {"media": "image", "prompt": "good sunset"}, "check": {"file": "pic.png", "quality": True}},
            {"id": "snd", "kind": "make", "args": {"media": "audio", "prompt": "good tone"}, "check": {"file": "snd.wav", "quality": True}}]
    c = coord(plan)
    t = c.run(c.new_task("g"))
    assert t.status == "done", t.log
    assert os.path.getsize(os.path.join(c.dir, "pic.png")) > 100


@test
def a_noise_picture_and_a_silent_sound_fail_the_gate_and_are_not_kept():
    for media, prompt, name in (("image", "noise x", "bad.png"), ("image", "blank x", "bad.png"), ("audio", "silent x", "bad.wav")):
        plan = [{"id": "bad", "kind": "make", "args": {"media": media, "prompt": prompt, "out": name}, "check": {"file": name, "quality": True}}]
        c = coord(plan)
        t = c.run(c.new_task("g"))
        assert t.status == "failed" and not os.path.exists(os.path.join(c.dir, name)), (prompt, t.log)
        print(f"  {prompt}: rejected -> {t.step('bad').result[:90]}")


@test
def a_service_that_says_no_video_is_reported_honestly_not_faked():
    plan = [{"id": "clip", "kind": "make", "args": {"media": "video", "prompt": "good clip"}, "check": {"file": "clip.mp4", "quality": True}}]
    c = coord(plan)
    t = c.run(c.new_task("g"))
    assert t.status == "failed" and "503" in t.step("clip").result and "native-video-unavailable" in t.step("clip").result, t.step("clip").result


@test
def the_verifier_alone_rejects_a_bad_file_even_if_a_worker_lied():
    plan = [{"id": "w", "kind": "file", "args": {"op": "write", "path": "x.png", "content": "not an image"}, "check": {"file": "x.png", "quality": True}}]
    c = coord(plan)
    t = c.run(c.new_task("g"))
    assert t.status == "failed" and any("quality gate" in l for l in t.log), t.log


@test
def media_steps_cannot_read_or_write_outside_the_task_folder():
    plan = [{"id": "s", "kind": "see", "args": {"media": "image", "file": "../../etc/hostname", "question": "?"}, "check": {"exit0": True}}]
    c = coord(plan)
    assert c.run(c.new_task("g")).status == "failed"


class Gr(BaseHTTPRequestHandler):
    """A fake Studio shaped like Gradio's call/v2 + event-stream protocol and the real api_names/results of modelscope-sham/app.py."""
    EV = {}
    SEEN_AUTH = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        import base64
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        Gr.SEEN_AUTH.append(self.headers.get("Authorization"))
        api = self.path.rsplit("/", 1)[-1]
        if api == "understand_media":
            out = {"type": "text", "text": f"I see a {body['kind']}"}
        elif api == "generate_chat":
            out = {"type": "text", "text": "[]" if "PLAN" in body["messages_json"] else "# Report"}
        elif api == "generate_media":
            m = body["prompt"].split()[0]
            data = png(m) if body["kind"] == "image" else wav(m)
            out = {"type": body["kind"], "b64": base64.b64encode(data).decode()} if m != "busy" else {"type": "busy", "text": "الاستوديو مشغول"}
        else:
            out = {"type": "error"}
        eid = str(len(Gr.EV)); Gr.EV[eid] = out
        b = json.dumps({"event_id": eid}).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        out = Gr.EV[self.path.rsplit("/", 1)[-1]]
        b = ("event: complete\ndata: " + json.dumps([json.dumps(out)]) + "\n\n").encode()
        self.send_response(200); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)


def gradio_coord(plan):
    from media_workers import GradioMedia
    srv = HTTPServer(("127.0.0.1", 0), Gr)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    c = Coordinator(tempfile.mkdtemp(prefix="gr_"), P(plan))
    install(c, GradioMedia(f"http://127.0.0.1:{srv.server_port}", "tok-123", timeout=10))
    open(os.path.join(c.dir, "photo.png"), "wb").write(png("good"))
    return c


@test
def the_gradio_adapter_runs_see_write_make_against_a_studio_shaped_service():
    plan = [{"id": "look", "kind": "see", "args": {"media": "image", "file": "photo.png"}, "check": {"file": "look.json", "has": "I see a image"}},
            {"id": "text", "kind": "write", "args": {"prompt": "write"}, "needs": ["look"], "check": {"file": "text.md", "has": "# Report"}},
            {"id": "pic", "kind": "make", "args": {"media": "image", "prompt": "good sunset"}, "check": {"file": "pic.png", "quality": True}},
            {"id": "snd", "kind": "make", "args": {"media": "audio", "prompt": "good tone"}, "check": {"file": "snd.wav", "quality": True}}]
    c = gradio_coord(plan)
    t = c.run(c.new_task("g"))
    assert t.status == "done", t.log
    assert set(Gr.SEEN_AUTH) == {"Bearer tok-123"}


@test
def a_busy_studio_and_a_noise_picture_fail_the_step_never_become_a_result():
    for prompt, name in (("busy x", "b.png"), ("noise x", "n.png")):
        c = gradio_coord([{"id": "p", "kind": "make", "args": {"media": "image", "prompt": prompt, "out": name}, "check": {"file": name, "quality": True}}])
        t = c.run(c.new_task("g"))
        assert t.status == "failed" and not os.path.exists(os.path.join(c.dir, name)), (prompt, t.log)


@test
def the_adapter_has_no_default_studio_and_the_planner_refuses_a_bad_plan():
    from media_workers import GradioMedia
    for args in (("", "t"), ("http://x", "")):
        try:
            GradioMedia(*args); raise SystemExit("must refuse")
        except ValueError:
            pass
    from sham_pro_agent import _json_list
    assert _json_list("junk") == [] and _json_list('x [{"id":"a","kind":"make","args":{}}] y')[0]["kind"] == "make" and _json_list('[1,2]') == []


if __name__ == "__main__":
    bad = 0
    for f in TESTS:
        try:
            f(); print("PASS", f.__name__)
        except Exception as e:
            import traceback; traceback.print_exc(); print("FAIL", f.__name__, repr(e)); bad += 1
    print(f"{len(TESTS) - bad}/{len(TESTS)} passed")
    sys.exit(1 if bad else 0)
