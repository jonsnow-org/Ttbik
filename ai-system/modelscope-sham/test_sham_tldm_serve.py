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


if __name__ == "__main__":
    unittest.main()
