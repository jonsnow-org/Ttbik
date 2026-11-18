import json
import os
import unittest
from pathlib import Path
from unittest import mock

import sham_tldm_serve as S


class Sham2TldmServe(unittest.TestCase):
    def setUp(self):
        os.environ.pop("SHAM_TLDM", None)
        os.environ.pop("SHAM_TLDM_REPO", None)
        os.environ.pop("SHAM_TLDM_CKPT", None)
        S._LOADED.clear()
        S._PENDING.clear()

    def test_off_by_default_and_owner_flag(self):
        self.assertFalse(S.enabled())
        self.assertFalse(S.requested(False))
        self.assertTrue(S.requested(True))
        os.environ["SHAM_TLDM"] = "1"
        self.assertTrue(S.enabled())
        self.assertTrue(S.requested(False))

    def test_missing_head_is_a_clear_error_with_no_sham1_fallback(self):
        msg = S.missing_message()
        self.assertIn("novaai2026/sham2-tldm-head", msg)
        self.assertIn("شام 1", msg)
        self.assertIn("تحويل صامت", msg)
        payload = json.loads(S.error_json(msg))
        self.assertEqual(payload["type"], "error")
        self.assertEqual(payload["fallback"], "none")
        self.assertTrue(payload["tldm"])

    def test_respond_without_a_head_does_not_call_sham1(self):
        os.environ["SHAM_TLDM_CKPT"] = "/tmp/no-such-sham2-head.pt"
        with mock.patch.object(S, "download_head", return_value=None):
            out = json.loads(S.respond(body=None, tok=None, session="s", message="مرحبا"))
        self.assertEqual(out["type"], "error")
        self.assertEqual(out["fallback"], "none")
        self.assertIn("شام 1", out["text"])

    def test_repo_override(self):
        os.environ["SHAM_TLDM_REPO"] = "Jonjithup/sham2-tldm-head"
        self.assertEqual(S.repo_id(), "Jonjithup/sham2-tldm-head")
        self.assertIn("Jonjithup/sham2-tldm-head", S.missing_message())

    def test_local_ckpt_is_preferred_when_the_file_exists(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "head_and_adapters.pt"
            path.write_bytes(b"x")
            os.environ["SHAM_TLDM_CKPT"] = str(path)
            self.assertEqual(S._find_local_head(), path)

    def test_sensitive_command_pauses_for_allow_deny_on_model_computer(self):
        class R:
            def __init__(self, needs=False, out="", ok=True, refused=""):
                self.needs_confirmation = needs
                self.out = out
                self.ok = ok
                self.refused = refused

        runs = []

        class Backend:
            def run(self, cmd, confirm=False):
                runs.append((cmd, confirm))
                if cmd == "rm -rf /tmp/x" and not confirm:
                    return R(needs=True, ok=False, refused="policy: destructive command")
                return R(out="ok", ok=True)

        blocks = ["$ ls", "$ rm -rf /tmp/x", "تم"]

        class Chat:
            max_steps = 5
            def backend_factory(self, session):
                return Backend()
            def writer(self, task, hist):
                return blocks[min(len(hist), len(blocks) - 1)]

        with mock.patch.object(S, "load_chat", return_value=(Chat(), "")):
            first = json.loads(S.respond(None, None, "tldm-sham_v2-7", "افعل"))
        self.assertEqual(first["type"], "confirm")
        self.assertEqual(first["command"], "rm -rf /tmp/x")
        self.assertEqual(first["session"], "tldm-sham_v2-7")
        self.assertEqual(first["computer"], "model_computer")
        self.assertNotIn("sandbox", json.dumps(first).lower())
        self.assertEqual(runs, [("ls", False), ("rm -rf /tmp/x", False)])

        with mock.patch.object(S, "load_chat", return_value=(Chat(), "")):
            stale = json.loads(S.respond(None, None, "tldm-sham_v2-7", "افعل", confirm_cmd="wrong", confirm_ok=True))
        self.assertEqual(stale["type"], "error")
        self.assertIn("موافقة", stale["text"])

        runs.clear()
        with mock.patch.object(S, "load_chat", return_value=(Chat(), "")):
            allowed = json.loads(S.respond(None, None, "tldm-sham_v2-7", "افعل", confirm_cmd="rm -rf /tmp/x", confirm_ok=True))
        self.assertEqual(allowed["type"], "text")
        self.assertEqual(allowed["computer"], "model_computer")
        self.assertEqual(runs, [("rm -rf /tmp/x", True)])
        self.assertIn("تم", allowed["text"])

    def test_deny_does_not_run_the_command_and_continues(self):
        class R:
            def __init__(self, needs=False, out="", ok=True, refused=""):
                self.needs_confirmation = needs
                self.out = out
                self.ok = ok
                self.refused = refused

        runs = []

        class Backend:
            def run(self, cmd, confirm=False):
                runs.append((cmd, confirm))
                if cmd == "dangerous" and not confirm:
                    return R(needs=True, ok=False, refused="policy: sensitive")
                return R(out="ok", ok=True)

        class Chat:
            max_steps = 5
            def backend_factory(self, session):
                return Backend()
            def writer(self, task, hist):
                if not hist:
                    return "$ dangerous"
                return "أُلغي الأمر"

        with mock.patch.object(S, "load_chat", return_value=(Chat(), "")):
            first = json.loads(S.respond(None, None, "s1", "task"))
        self.assertEqual(first["type"], "confirm")
        runs.clear()
        with mock.patch.object(S, "load_chat", return_value=(Chat(), "")):
            denied = json.loads(S.respond(None, None, "s1", "task", confirm_cmd="dangerous", confirm_ok=False))
        self.assertEqual(denied["type"], "text")
        self.assertEqual(runs, [])
        self.assertIn("أُلغي", denied["text"])


if __name__ == "__main__":
    unittest.main()
