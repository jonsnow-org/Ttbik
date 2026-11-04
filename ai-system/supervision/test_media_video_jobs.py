"""The media Studio's background video jobs (modelscope-media/app.py): a clip runs in a thread and `job` is asked back-to-back (each call short)."""
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
                self.gate.wait(5)
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

    def test_wait_is_capped(self):
        start = json.loads(self.app.api_video_start(json.dumps({"prompt": "x", "seconds": 6})))
        t0 = time.time()
        threading.Timer(0.5, self.gate.set).start()
        self.app.api_job(json.dumps({"job": start["job"], "wait": 999}))
        self.assertLess(time.time() - t0, 21)

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


class VideoInProcessOnSmallStudio(unittest.TestCase):
    def test_low_ram_runs_the_clip_in_process_after_freeing_the_picture_pipeline(self):
        import os
        app = load()
        calls = []
        app._mem_available_gb = lambda: 6.5
        app.cv_generate_long = lambda *a, **k: calls.append((app._MODELS["pipe"], a[2])) or b"MP4"
        app._MODELS["pipe"] = object()
        os.environ.pop("NOVA_VIDEO_SUBPROCESS", None)
        self.assertEqual(app._make_video("a girl dancing", 6), b"MP4")
        self.assertEqual(calls, [(None, 6)])


if __name__ == "__main__":
    unittest.main()
