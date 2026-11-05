"""The media Studio's background video jobs: a clip runs in a thread; each `job` poll holds no longer than five seconds."""
import importlib.util
import json
import threading
import time
import unittest
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "modelscope-media" / "app.py"


def load():
    spec = importlib.util.spec_from_file_location("media_app_jobs", PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class VideoJobs(unittest.TestCase):
    def setUp(self):
        self.app = load()
        self.gate = threading.Event()

        def fake_run(kind, payload):
            with self.app._LOCK:
                self.gate.wait(60)
                return {"type": "video", "b64": "AAAA", "text": payload.get("prompt", "")}
        self.app._run = fake_run

    def test_start_then_poll_until_done(self):
        start = json.loads(self.app.api_video_start(json.dumps({"prompt": "a girl dancing", "seconds": 6})))
        self.assertEqual(start["type"], "job")
        t0 = time.time()
        running = json.loads(self.app.api_job(json.dumps({"job": start["job"], "wait": 0.3})))
        self.assertEqual(running["type"], "running")
        self.assertLess(time.time() - t0, 2)
        self.gate.set()
        done = json.loads(self.app.api_job(json.dumps({"job": start["job"], "wait": 5})))
        self.assertEqual(done, {"type": "video", "b64": "AAAA", "text": "a girl dancing"})
        # asking again (a cut connection) returns the same result
        self.assertEqual(json.loads(self.app.api_job(json.dumps({"job": start["job"], "wait": 0})))["type"], "video")

    def test_busy_while_another_job_holds_the_studio(self):
        first = json.loads(self.app.api_video_start(json.dumps({"prompt": "x", "seconds": 6})))
        time.sleep(0.2)
        self.assertEqual(json.loads(self.app.api_video_start(json.dumps({"prompt": "y", "seconds": 6}))), {"type": "busy"})
        self.gate.set()
        self.app.api_job(json.dumps({"job": first["job"], "wait": 5}))

    def test_unknown_job_is_lost(self):
        self.assertEqual(json.loads(self.app.api_job(json.dumps({"job": "nope", "wait": 0})))["reason"], "job_lost")

    def test_wait_is_capped_to_five_seconds_even_for_legacy_long_polls(self):
        start = json.loads(self.app.api_video_start(json.dumps({"prompt": "x", "seconds": 6})))
        t0 = time.time()
        running = json.loads(self.app.api_job(json.dumps({"job": start["job"], "wait": 999})))
        self.assertEqual(running["type"], "running")
        self.assertLess(time.time() - t0, 7)
        self.gate.set()
        done = json.loads(self.app.api_job(json.dumps({"job": start["job"], "wait": 999})))
        self.assertEqual(done["type"], "video")

    def test_endpoints_are_exposed(self):
        src = PATH.read_text(encoding="utf-8")
        self.assertIn('("video_start", api_video_start), ("job", api_job)', src)


class VideoInFreshProcess(unittest.TestCase):
    """A clip runs in a child process (the RAM of one clip is returned before the next); the child's error comes back to the caller."""

    def test_child_error_reaches_the_caller(self):
        import subprocess
        import sys
        script = (
            "import sys; sys.path.insert(0, %r)\n"
            "import app\n"
            "if __name__ == '__main__':\n"
            "    try:\n"
            "        app._make_video('a cat', 5)\n"
            "    except Exception as e:\n"
            "        print('RAISED', type(e).__name__, e)\n"
        ) % str(PATH.parent)
        import os
        out = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=60, env={**os.environ, "NOVA_VIDEO_SUBPROCESS": "1"})
        self.assertIn("RAISED RuntimeError", out.stdout)
        self.assertIn("native-video-duration-limit", out.stdout)

class ShamV2VideoJobs(unittest.TestCase):
    """The Sham v2 video Studio (modelscope-sham-video/app.py) has the same job API."""

    def setUp(self):
        import sys
        import types
        cv = types.ModuleType("cpu_video")
        cv._CV = {"pipe": None}
        cv.CV_SUPPORTED_DURATIONS = (2, 4, 6)
        self.gate = threading.Event()

        def long(root, prompt, seconds, seed, envs):
            self.gate.wait(5)
            return b"mp4"
        cv.cv_generate_long = long
        mq = types.ModuleType("media_quality")
        mq.MediaQualityError = type("MediaQualityError", (Exception,), {})
        mq.check_mp4 = lambda *a, **k: None
        sys.modules["cpu_video"], sys.modules["media_quality"] = cv, mq
        p = Path(__file__).resolve().parents[1] / "modelscope-sham-video" / "app.py"
        spec = importlib.util.spec_from_file_location("sham_video_app_jobs", p)
        self.app = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.app)

    def test_job_round_trip(self):
        start = json.loads(self.app.generate_video_start(json.dumps({"prompt": "a girl dancing", "seconds": 6})))
        self.assertEqual(start["type"], "job")
        self.assertEqual(json.loads(self.app.job(json.dumps({"job": start["job"], "wait": 0.2})))["type"], "running")
        self.gate.set()
        done = json.loads(self.app.job(json.dumps({"job": start["job"], "wait": 5})))
        self.assertEqual(done["type"], "video")
        self.assertEqual(json.loads(self.app.job(json.dumps({"job": "x", "wait": 0})))["reason"], "job_lost")


class FreeParentRamTest(unittest.TestCase):
    def test_clip_process_starts_with_the_picture_pipeline_released(self):
        app = load()
        app._MODELS["pipe"] = object()
        app._CV["pipe"] = object()
        app._free_parent_ram()
        self.assertIsNone(app._MODELS["pipe"])
        self.assertIsNone(app._CV["pipe"])

    def test_clip_process_also_releases_the_speech_voice(self):
        # The probe makes an image and Arabic speech before the clip; on an 8 GB Studio the resident Piper voice pushed the clip into
        # out-of-memory (LFM2.5 video probe 2026-11-05: image+speech PASS, `job` submit 502 for minutes). The voice reloads lazily.
        app = load()
        app._MODELS["voice"] = object()
        app._free_parent_ram()
        self.assertIsNone(app._MODELS["voice"])


class VideoMemoryPolicy(unittest.TestCase):
    def test_cgroup_limit_overrides_large_host_meminfo(self):
        app = load()
        gib = 1024 ** 3
        contents = {
            "/proc/meminfo": "MemAvailable: 32000000 kB\\n",
            "/sys/fs/cgroup/memory.max": str(8 * gib),
            "/sys/fs/cgroup/memory.current": str(7 * gib),
        }
        self.assertAlmostEqual(app._mem_available_gb(contents.__getitem__), 1.0, places=3)

    def test_8_gib_studio_uses_one_in_process_pipeline_after_releasing_picture_worker(self):
        import os
        app = load()
        calls = []
        app._free_parent_ram = lambda: calls.append("release-picture-worker-and-parent-heap")
        app._mem_available_gb = lambda: 6.5
        app.cv_generate_long = lambda *a, **k: calls.append(("generate-in-process", a[2])) or b"MP4"
        app._trim_heap = lambda: calls.append("trim-heap")
        app._CV["pipe"] = object()
        with __import__("unittest.mock").mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("NOVA_VIDEO_SUBPROCESS", None)
            self.assertEqual(app._make_video("a girl dancing", 6), b"MP4")
        self.assertEqual(calls, ["release-picture-worker-and-parent-heap", ("generate-in-process", 6), "trim-heap"])
        self.assertIsNone(app._CV["pipe"])

    def test_video_weights_are_prefetched_without_loading_the_pipeline(self):
        app = load()
        reads = []
        app._VIDEO_WEIGHT_STATE.update({"loading": False, "ready": False, "error": ""})
        def find(root, env_names=()):
            reads.append("find")
            return None if reads.count("find") == 1 else ("base", "adapter")
        app.cv_find_weights = find
        app.cv_fetch_weights = lambda root: reads.append(("download-assets-only", str(root)))
        app._warm_video_weights()
        self.assertEqual(reads[1][0], "download-assets-only")
        self.assertTrue(app._VIDEO_WEIGHT_STATE["ready"])
        self.assertFalse(app._VIDEO_WEIGHT_STATE["loading"])
        self.assertEqual(app._VIDEO_WEIGHT_STATE["error"], "")


class VideoPassesInFreshProcesses(unittest.TestCase):
    def test_each_pass_gets_its_own_process_only_when_memory_headroom_is_high(self):
        app = load()
        events = []
        app._stop_image_worker = lambda: events.append("stop-picture-worker")
        app._trim_heap = lambda: None
        app._mem_available_gb = lambda: 12.0
        app._run_pass = lambda prompt, secs, seed, d, i: events.append(("pass", i, secs)) or b"MP4"
        import types, sys
        mq = types.ModuleType("media_quality")
        mq.check_mp4 = lambda *a, **k: None
        sys.modules["media_quality"] = mq
        app.cv_concat_mp4 = lambda clips, target: events.append(("join", len(clips), target)) or b"JOINED"
        self.assertEqual(app._make_video("a girl dancing", 10), b"JOINED")
        self.assertEqual(events, ["stop-picture-worker", ("pass", 0, 4.0), ("pass", 1, 4.0), ("pass", 2, 2.0), ("join", 3, 10)])

    def test_picture_worker_round_trip(self):
        app = load()
        import threading as _t
        class Conn:
            def __init__(self): self.q = []
            def send(self, x): self.q.append({"png": b"PNG"} if not x.get("warm") else {"ok": True})
            def poll(self, t): return True
            def recv(self): return self.q.pop(0)
            def close(self): pass
        class Proc:
            exitcode = None
            def is_alive(self): return True
            def kill(self): pass
            def join(self, t=None): pass
        app._IMG["proc"], app._IMG["conn"] = Proc(), Conn()
        self.assertEqual(app._image_call({"prompt": "x", "size": 512, "seed": 0}), {"png": b"PNG"})
        app._stop_image_worker()
        self.assertIsNone(app._IMG["proc"])


if __name__ == "__main__":
    unittest.main()
