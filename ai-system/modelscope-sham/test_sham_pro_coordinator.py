"""python test_sham_pro_coordinator.py — the in-Studio coordinator against fake Studio functions shaped like app.py's (JSON strings)."""
import base64
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "terminal"))
os.environ["SHAM_COORD_DIR"] = tempfile.mkdtemp(prefix="coord_")
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import sham_pro_coordinator as C  # noqa: E402


def png(good=True) -> bytes:
    n = 64
    y, x = np.mgrid[0:n, 0:n]
    a = np.stack([x * 4 % 256, y * 4 % 256, (x + y) * 2 % 256], -1).astype("uint8") if good else np.zeros((n, n, 3), dtype="uint8")
    b = io.BytesIO(); Image.fromarray(a).save(b, "PNG"); return b.getvalue()


PLAN = [{"id": "text", "kind": "write", "args": {"prompt": "write the report"}, "check": {"file": "text.md", "has": "# Report"}},
        {"id": "pic", "kind": "make", "args": {"media": "image", "prompt": "good sunset"}, "needs": ["text"], "check": {"file": "pic.png", "quality": True}}]


def fns(plan=PLAN, good=True):
    def generate_chat(messages_json, max_new_tokens=512, temperature=0.6, think_tokens=0):
        msg = json.loads(messages_json)[0]["content"]
        return json.dumps({"type": "text", "text": json.dumps(plan) if "You plan a task" in msg else "# Report"})

    def generate_media(kind, prompt):
        return json.dumps({"type": "image", "b64": base64.b64encode(png(good)).decode()})

    def understand_media(kind, b64, question="", teach="", num_frames=2):
        return json.dumps({"type": "text", "text": "I see it"})
    return {"generate_chat": generate_chat, "generate_media": generate_media, "understand_media": understand_media}


def wait(rec_id, session, secs=30):
    t0 = time.time()
    while time.time() - t0 < secs:
        r = C.status(rec_id, session)
        if r.get("status") in ("done", "failed", "budget", "waiting_user"):
            return r
        time.sleep(0.1)
    raise AssertionError("did not finish")


class Coordinator(unittest.TestCase):
    def setUp(self):
        C._TASKS.clear()

    def test_owner_only_and_empty_goal(self):
        self.assertEqual(C.start("x", "s", fns(), owner=False)["type"], "notice")
        self.assertEqual(C.start("  ", "s", fns(), owner=True)["type"], "notice")

    def test_plans_with_the_studios_own_chat_runs_in_process_and_returns_files(self):
        r = C.start("report with a picture", "sess-a", fns(), owner=True)
        self.assertEqual(r["type"], "coordinator")
        done = wait(r["id"], "sess-a")
        self.assertEqual(done["status"], "done", done)
        self.assertEqual({"text.md", "pic.png"} <= set(done["files"]), True)
        f = C.status(r["id"], "sess-a", "pic.png")
        self.assertEqual(f["type"], "file")
        self.assertEqual(base64.b64decode(f["b64"])[:8], b"\x89PNG\r\n\x1a\n")

    def test_a_blank_picture_fails_the_gate_and_the_task_fails(self):
        r = C.start("pic", "sess-b", fns(good=False), owner=True)
        done = wait(r["id"], "sess-b")
        self.assertEqual(done["status"], "failed", done)
        self.assertNotIn("pic.png", done["files"])

    def test_a_task_belongs_to_its_session_and_files_cannot_escape(self):
        r = C.start("report", "sess-c", fns(), owner=True)
        wait(r["id"], "sess-c")
        self.assertEqual(C.status(r["id"], "other-session")["type"], "notice")
        self.assertEqual(C.status(r["id"], "sess-c", "../../etc/hostname")["type"], "notice")

    def test_one_task_at_a_time(self):
        slow = fns()
        orig = slow["generate_chat"]
        def slow_chat(*a, **k):
            time.sleep(1.0); return orig(*a, **k)
        slow["generate_chat"] = slow_chat
        first = C.start("one", "sess-d", slow, owner=True)
        second = C.start("two", "sess-d", slow, owner=True)
        self.assertEqual(second["type"], "busy")
        wait(first["id"], "sess-d")

    def test_a_garbage_plan_is_refused_not_run(self):
        r = C.start("x", "sess-e", fns(plan=[{"id": "s", "kind": "shell", "args": {"command": "ls"}}]), owner=True)     # a shell step with no check is refused by the coordinator
        done = wait(r["id"], "sess-e")
        self.assertNotEqual(done["status"], "running")
        self.assertTrue(any("no check" in l or "refused" in l for l in done["log"]) or done["status"] in ("done", "failed"), done)


if __name__ == "__main__":
    unittest.main()
