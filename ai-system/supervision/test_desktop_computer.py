"""Offline tests for the optional graphical desktop in a ModelScope Studio."""
from __future__ import annotations

import base64
import importlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MEDIA_DIR = Path(__file__).resolve().parents[1] / "modelscope-media"
if str(MEDIA_DIR) not in sys.path:
    sys.path.insert(0, str(MEDIA_DIR))

desktop = importlib.import_module("desktop_computer")
box = desktop.box


class Desktop(unittest.TestCase):
    def setUp(self):
        self.old_root = box.ROOT
        self.old_mem = box._mem_available_mb
        self.old_limit = box.MAX_GLOBAL_JOBS
        self.tmp = Path(tempfile.mkdtemp())
        self.tmp.chmod(0o755)
        box.ROOT = self.tmp / "computer"
        box.MAX_GLOBAL_JOBS = 1
        box._mem_available_mb = lambda: 8192
        box._JOBS.clear()
        box._ACTIVE_COMMANDS.clear()
        box._ACTIVE_DESKTOPS.clear()
        box.STATE["egress"] = "test: not touched"

        desktop._PHASE = "stopped"
        desktop._ERROR = ""
        desktop._SESSION_HASH = ""
        desktop._SESSION_RAW = ""
        desktop._DISPLAY = ""
        desktop._AUTH_FILE = ""
        desktop._LAST_USED = 0.0
        desktop._PROCESSES = []
        desktop._ENV = {}
        desktop._UID = None
        desktop._INSTALL_THREAD = None
        desktop._CANCEL_INSTALL = False

    def tearDown(self):
        if desktop._SESSION_RAW:
            desktop._stop(desktop._SESSION_RAW)
        box.ROOT = self.old_root
        box._mem_available_mb = self.old_mem
        box.MAX_GLOBAL_JOBS = self.old_limit
        box._JOBS.clear()
        box._ACTIVE_COMMANDS.clear()
        box._ACTIVE_DESKTOPS.clear()

    def call(self, **body):
        return json.loads(desktop.api_desktop_do(json.dumps(body)))

    def test_session_and_input_validators(self):
        self.assertEqual(desktop.session_hash("user-a:model-x"), desktop.session_hash("user-a:model-x"))
        self.assertNotIn("user-a", desktop.session_hash("user-a:model-x"))
        self.assertTrue(desktop.valid_key("alt+Tab"))
        self.assertTrue(desktop.valid_key("Return"))
        self.assertFalse(desktop.valid_key("Return; touch /tmp/pwned"))
        self.assertEqual(desktop.clamp_point(-20, 9000), (0, desktop.HEIGHT - 1))
        self.assertEqual(desktop.clamp_point(400, 300), (400, 300))
        with self.assertRaises(ValueError):
            desktop.clamp_point("x", 2)

    def test_unknown_or_unauthenticated_desktop_actions_do_not_start_processes(self):
        missing = self.call(action="status")
        self.assertFalse(missing["ok"])
        unknown = self.call(action="run-shell", session="user-a:model-x")
        self.assertFalse(unknown["ok"])
        self.assertIn("unknown desktop action", unknown["error"])

        # The production Studio client uses the same b64: envelope as box_do.
        wire = base64.b64encode(json.dumps({
            "action": "run-shell", "session": "user-a:model-x",
        }).encode("utf-8")).decode("ascii")
        encoded = json.loads(desktop.api_desktop_do("b64:" + wire))
        self.assertFalse(encoded["ok"])
        self.assertIn("unknown desktop action", encoded["error"])
        key = self.call(action="key", session="user-a:model-x", key="Return")
        self.assertFalse(key["ok"])
        self.assertIn("not running", key["error"])

    def test_another_users_session_is_reported_busy_not_exposed(self):
        desktop._SESSION_HASH = desktop.session_hash("alice:model-x")
        desktop._SESSION_RAW = "alice:model-x"
        desktop._PHASE = "running"
        status = desktop._desktop_status("bob:model-x")
        self.assertEqual(status["phase"], "busy")
        self.assertFalse(status["can_start"])
        self.assertNotIn("display", status)

    def test_start_is_refused_without_the_required_memory(self):
        box._mem_available_mb = lambda: 2400
        result = self.call(action="start", session="user-a:model-x")
        self.assertFalse(result["ok"])
        self.assertIn("requires 3072 MB", result["error"])
        self.assertEqual(desktop._PHASE, "stopped")
        self.assertFalse(box._ACTIVE_DESKTOPS)

    def test_stop_during_install_cancels_start_without_leaking_the_slot(self):
        def stop_while_installing():
            stopped = desktop._stop("user-a:model-x")
            self.assertEqual(stopped["phase"], "stopped")

        with patch.object(desktop, "_install_packages", side_effect=stop_while_installing):
            desktop._start_async("user-a:model-x")
            worker = desktop._INSTALL_THREAD
            self.assertIsNotNone(worker)
            worker.join(timeout=5)
        self.assertFalse(worker.is_alive())
        self.assertEqual(desktop._PHASE, "stopped")
        self.assertFalse(box._ACTIVE_DESKTOPS)
        self.assertEqual(desktop._PROCESSES, [])


if __name__ == "__main__":
    unittest.main()
