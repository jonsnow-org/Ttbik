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
        desktop._NETWORK_MODE = "not checked"
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

    def test_desktop_uses_uid_firewall_when_the_studio_has_it(self):
        with patch.object(box, "install_egress_rules", return_value="private ranges and metadata blocked"):
            mode, error = desktop._network_isolation(123456, "alice:model-x")
        self.assertEqual(mode, "host-firewall")
        self.assertEqual(error, "")

    def test_desktop_falls_back_to_an_unprivileged_network_namespace(self):
        completed = SimpleNamespace(returncode=0, stdout="", stderr="")
        with patch.object(box, "install_egress_rules", return_value="not available (no iptables or not root)"), \
             patch.object(desktop.shutil, "which", return_value="/usr/bin/unshare"), \
             patch.object(box, "is_root", return_value=False), \
             patch.object(desktop.subprocess, "run", return_value=completed) as probe:
            mode, error = desktop._network_isolation(123456, "alice:model-x")
        self.assertEqual(mode, "network-namespace")
        self.assertEqual(error, "")
        command = probe.call_args.args[0]
        self.assertEqual(command[:6], [
            "/usr/bin/unshare", "--user", "--map-root-user", "--net", "--", "/bin/sh"
        ])
        self.assertIn("/proc/self/ns/net", command[-1])
        self.assertEqual(probe.call_args.kwargs["timeout"], 12)

    def test_desktop_refuses_start_if_no_firewall_or_network_namespace_is_available(self):
        failed = SimpleNamespace(returncode=1, stdout="", stderr="unshare failed: Operation not permitted")
        with patch.object(box, "install_egress_rules", return_value="not available (no iptables or not root)"), \
             patch.object(desktop.shutil, "which", return_value="/usr/bin/unshare"), \
             patch.object(box, "is_root", return_value=False), \
             patch.object(desktop.subprocess, "run", return_value=failed):
            mode, error = desktop._network_isolation(123456, "alice:model-x")
        self.assertEqual(mode, "")
        self.assertIn("Operation not permitted", error)

    def test_network_namespace_wraps_every_gui_process_and_disables_network_browser(self):
        with patch.object(desktop.shutil, "which", return_value="/usr/bin/unshare"):
            wrapped = desktop._command_with_network_isolation(["xterm", "-title", "Model Computer"], {
                "DESKTOP_NETWORK_MODE": "network-namespace"
            })
        self.assertEqual(wrapped[:5], ["/usr/bin/unshare", "--user", "--map-root-user", "--net", "--"])
        self.assertEqual(wrapped[5:], ["xterm", "-title", "Model Computer"])
        desktop._SESSION_HASH = desktop.session_hash("alice:model-x")
        desktop._SESSION_RAW = "alice:model-x"
        desktop._PHASE = "running"
        desktop._DISPLAY = ":91"
        desktop._ENV = {"DESKTOP_NETWORK_MODE": "network-namespace"}
        result = self.call(action="launch", session="alice:model-x", app="browser")
        self.assertFalse(result["ok"])
        self.assertIn("internet browsing is disabled", result["error"])

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
