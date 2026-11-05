"""Offline tests for the optional graphical desktop in a ModelScope Studio."""
from __future__ import annotations

import base64
import importlib
import json
import sys
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
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

    def test_apps_inventory_reports_jupyter_from_the_persistent_optional_apps_folder(self):
        old_root = box.ROOT
        try:
            box.ROOT = self.tmp / "computer"
            wrapper = box.ROOT.parent / "computer-apps" / "bin" / "jupyter"
            wrapper.parent.mkdir(parents=True, exist_ok=True)
            wrapper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            result = desktop.app_inventory()
            jupyter = next(item for item in result["apps"] if item["id"] == "jupyter")
            self.assertTrue(jupyter["available"])
        finally:
            box.ROOT = old_root

    def test_launch_jupyter_returns_a_private_local_preview_url(self):
        old_env, old_uid, old_processes = desktop._ENV, desktop._UID, desktop._PROCESSES
        try:
            box.ROOT = self.tmp / "computer"
            wrapper = box.ROOT.parent / "computer-apps" / "bin" / "jupyter"
            wrapper.parent.mkdir(parents=True, exist_ok=True)
            wrapper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            session = "alice:nova"
            desktop._ENV = {**box.clean_env(session), "DESKTOP_UID": "100123"}
            desktop._UID = 100123
            desktop._PROCESSES = []
            captured = {}
            proc = SimpleNamespace(pid=12345)
            def spawn(command, env, label):
                captured["command"] = command
                captured["env"] = env
                captured["label"] = label
                return proc
            with patch.object(desktop, "_spawn", side_effect=spawn):
                result = desktop._input_action(session, "launch", {"app": "jupyter"})
            self.assertTrue(result["ok"], result)
            self.assertRegex(result["url"], r"^http://127\\.0\\.0\\.1:\\d+/lab\\?token=")
            self.assertEqual(captured["command"][1], "--no-browser")
            self.assertNotIn("lab", captured["command"])
            self.assertIn("--ip=127.0.0.1", captured["command"])
            port_arg = next(item for item in captured["command"] if item.startswith("--port="))
            self.assertEqual(int(port_arg.split("=", 1)[1]), result["port"])
            self.assertTrue(any(item.startswith("--ServerApp.token=") for item in captured["command"]))
            self.assertEqual(captured["env"]["HOME"], str(box.session_home(session)))
        finally:
            desktop._ENV, desktop._UID, desktop._PROCESSES = old_env, old_uid, old_processes

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

    def test_xauthority_uses_private_local_tmp_and_breaks_stale_xauth_locks(self):
        captured = {}

        def create_authority(command, **kwargs):
            captured["command"] = command
            captured["kwargs"] = kwargs
            auth = Path(command[command.index("-f") + 1])
            auth.write_bytes(b"private-cookie-record")
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        with patch.object(box, "session_uid", return_value=123456), \
             patch.object(box, "is_root", return_value=False), \
             patch.object(desktop.subprocess, "run", side_effect=create_authority):
            auth, runtime = desktop._write_xauthority("alice:model-x", 91)

        runtime_path = Path(runtime)
        self.assertEqual(auth, runtime_path / "Xauthority")
        self.assertEqual(runtime_path.parent, Path("/tmp"))
        self.assertTrue(runtime_path.name.startswith("sham-desktop-xauth-"))
        self.assertEqual(runtime_path.stat().st_mode & 0o777, 0o700)
        self.assertEqual(auth.stat().st_mode & 0o777, 0o600)
        self.assertIn("-b", captured["command"])
        self.assertEqual(captured["kwargs"]["timeout"], 30)
        self.assertEqual(captured["kwargs"]["env"]["HOME"], runtime)
        self.assertEqual(captured["kwargs"]["env"]["TMPDIR"], runtime)
        desktop._remove_xauthority(auth)
        self.assertFalse(runtime_path.exists())

    def test_xauthority_timeout_is_actionable_and_cleans_its_private_directory(self):
        created = []
        real_mkdtemp = tempfile.mkdtemp

        def make_tempdir(**kwargs):
            path = real_mkdtemp(**kwargs)
            created.append(Path(path))
            return path

        with patch.object(box, "session_uid", return_value=123456), \
             patch.object(box, "is_root", return_value=False), \
             patch.object(desktop.tempfile, "mkdtemp", side_effect=make_tempdir), \
             patch.object(desktop.subprocess, "run", side_effect=subprocess.TimeoutExpired("xauth", 30)):
            with self.assertRaisesRegex(RuntimeError, "timed out after 30 seconds.*local /tmp"):
                desktop._write_xauthority("alice:model-x", 91)

        self.assertEqual(len(created), 1)
        self.assertFalse(created[0].exists())

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


@unittest.skipUnless(__import__("shutil").which("Xvfb") and __import__("shutil").which("xdotool"), "needs Xvfb and xdotool")
class RealScreen(unittest.TestCase):
    """A real X server: frame hashing / scaling (live view) and the new pointer actions land where they were sent."""
    @classmethod
    def setUpClass(cls):
        import os, time
        subprocess.run(["rm", "-f", "/tmp/.X77-lock"])
        cls.proc = subprocess.Popen(["Xvfb", ":77", "-screen", "0", f"{desktop.WIDTH}x{desktop.HEIGHT}x24", "-nolisten", "tcp"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)
        cls.saved = (desktop._DISPLAY, desktop._ENV, desktop._UID, desktop._AUTH_FILE)
        desktop._DISPLAY = ":77"; desktop._AUTH_FILE = ""; desktop._UID = os.getuid()
        desktop._ENV = {"DISPLAY": ":77", "PATH": os.environ.get("PATH", "/usr/bin:/bin")}

    @classmethod
    def tearDownClass(cls):
        desktop._DISPLAY, desktop._ENV, desktop._UID, desktop._AUTH_FILE = cls.saved
        cls.proc.kill(); cls.proc.wait()

    def where(self):
        out = subprocess.run(["xdotool", "getmouselocation", "--shell"], env={"DISPLAY": ":77", "PATH": "/usr/bin:/bin"}, capture_output=True, text=True).stdout
        vals = dict(line.split("=", 1) for line in out.split())
        return int(vals["X"]), int(vals["Y"])

    def test_unchanged_screen_sends_no_picture_and_scale_keeps_real_coordinates(self):
        first = desktop._screenshot(50, 0.5)
        self.assertTrue(first["screenshot_b64"])
        self.assertEqual((first["width"], first["height"]), (desktop.WIDTH, desktop.HEIGHT))
        self.assertEqual(first["frame_width"], desktop.WIDTH // 2)
        again = desktop._screenshot(50, 0.5, first["hash"])
        self.assertTrue(again.get("unchanged"))
        self.assertNotIn("screenshot_b64", again)

    def test_pointer_actions_land_exactly(self):
        subprocess.run(["xdotool", "mousemove", "3", "4"], env={"DISPLAY": ":77", "PATH": "/usr/bin:/bin"})
        if self.where() != (3, 4):
            self.skipTest("this X server ignores synthetic pointer moves (some sandboxes); the Studio smoke checks it live")
        desktop._input_action("s", "click", {"x": 321, "y": 123})
        self.assertEqual(self.where(), (321, 123))
        desktop._input_action("s", "drag", {"x": 10, "y": 20, "x2": 700, "y2": 500})
        self.assertEqual(self.where(), (700, 500))
        desktop._input_action("s", "dblclick", {"x": 5, "y": 6})
        self.assertEqual(self.where(), (5, 6))
        desktop._input_action("s", "scroll", {"direction": "left", "amount": 1, "x": 40, "y": 41})
        self.assertEqual(self.where(), (40, 41))
