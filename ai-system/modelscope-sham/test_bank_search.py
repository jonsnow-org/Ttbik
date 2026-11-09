"""The Studio's read-only `bank_search`: the central knowledge bank (sham_bank.py) opened from a folder, searched, and reported in status(); never takes the Studio down."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as sham_app  # noqa: E402
import sham_bank  # noqa: E402  (ai-system/colab/sham_small, on PYTHONPATH)

DOCS = [
    ("crawl-a", "عاصمة فرنسا هي باريس وتقع على نهر السين، وهي أكبر مدينة في البلاد وفيها متاحف كثيرة وجسور قديمة. " * 4),
    ("crawl-b", "The capital of Japan is Tokyo, a very large city with many millions of people and busy trains. " * 4),
    ("crawl-b", "Python is a programming language created by Guido van Rossum in 1991 and used for readable code. " * 4),
]


class BankSearchTests(unittest.TestCase):
    def setUp(self):
        self.old = dict(sham_app._BANK)
        self.td = tempfile.TemporaryDirectory()
        enc = Path(__file__).resolve().parents[1] / "colab" / "sham_small" / "data" / "knowledge_encoder.json"
        sham_bank.build(DOCS, Path(self.td.name) / "bank", encoder_json=enc if enc.exists() else None, log=lambda *_: None)
        bank = sham_bank.Bank(Path(self.td.name) / "bank")
        sham_app._BANK.update(bank=bank, sha=bank.manifest["sha"], error="")
        self.patch = patch.object(sham_app, "_bank_enabled", lambda: True)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        sham_app._BANK.clear()
        sham_app._BANK.update(self.old)
        self.td.cleanup()

    def test_search_returns_passages_with_their_source(self):
        out = json.loads(sham_app.bank_search("ما هي عاصمة فرنسا؟", 2))
        self.assertTrue(out["ok"])
        self.assertIn("باريس", out["results"][0]["text"])
        self.assertEqual(out["results"][0]["source"], "crawl-a")
        out = json.loads(sham_app.bank_search("who created the Python language", 1))
        self.assertIn("Guido", out["results"][0]["text"])

    def test_empty_query_and_k_are_handled(self):
        self.assertFalse(json.loads(sham_app.bank_search("   ", 3))["ok"])
        self.assertTrue(json.loads(sham_app.bank_search("capital of Japan", 99))["ok"])      # k is clamped

    def test_not_loaded_is_a_clean_error_and_status_reports_the_bank(self):
        st = json.loads(sham_app.status())
        self.assertEqual(st["bank"]["passages"], len(sham_app._BANK["bank"]))
        sham_app._BANK.update(bank=None, error="boom")
        out = json.loads(sham_app.bank_search("anything", 3))
        self.assertFalse(out["ok"])
        self.assertIn("boom", out["error"])
        self.assertEqual(json.loads(sham_app.status())["bank"]["passages"], 0)

    def test_refresh_never_raises_when_the_repo_is_unreachable(self):
        sham_app._BANK.update(bank=None, sha="", error="")
        with patch.dict("os.environ", {"SHAM_BANK": "1"}):
            sham_app._bank_refresh()                      # no modelscope / no network here: must end quietly with an error note
        self.assertIsNone(sham_app._BANK["bank"])


if __name__ == "__main__":
    unittest.main()
