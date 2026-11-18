import json
import os
import tempfile
import unittest
from pathlib import Path

import sham_tldm_experience as E


class ExperienceLog(unittest.TestCase):
    def test_redact_strips_pii_and_secrets(self):
        raw = "email me at ada@example.com token=sk_live_abcdefgh password=hunter2 10.1.2.3 +1 202 555 0173"
        out = E.redact(raw)
        self.assertNotIn("ada@example.com", out)
        self.assertNotIn("sk_live_abcdefgh", out)
        self.assertNotIn("hunter2", out)
        self.assertNotIn("10.1.2.3", out)
        self.assertIn("[email]", out)

    def test_jsonl_has_no_user_ids_and_records_verified_outcomes(self):
        with tempfile.TemporaryDirectory() as folder:
            dest = Path(folder) / "sessions.jsonl"
            os.environ["SHAM_TLDM_SESSION_PAIRS"] = str(dest)
            os.environ["SHAM_TLDM_EVOLUTION_ROOT"] = str(Path(folder) / "evo")
            rec = E.log_episode(
                "count lines in /home/omar/app.log, user ada@example.com",
                "there are 12 lines",
                [("wc -l /home/omar/app.log", "12 /home/omar/app.log", True)],
                True,
                1.25,
                verified=True,
                session="tldm-sham_v2-42",
            )
            self.assertTrue(rec["verified"] and rec["success"])
            self.assertNotIn("ada@example.com", rec["task"])
            line = dest.read_text(encoding="utf-8")
            self.assertNotIn("ada@example.com", line)
            self.assertNotIn("tldm-sham_v2-42", line)
            self.assertIn('"schema":"tldm.session_experience.v1"', line)
            # Official ingest API (hashed user only).
            evo = Path(folder) / "evo" / "sham2-tldm" / "experience"
            if evo.is_dir():
                files = list(evo.glob("*.jsonl"))
                self.assertTrue(files, evo)
                body = files[0].read_text(encoding="utf-8")
                self.assertNotIn("ada@example.com", body)
                self.assertNotIn("tldm-sham_v2-42", body)
                row = json.loads(body.splitlines()[0])
                self.assertTrue(str(row.get("user") or "").startswith("u_"))
                self.assertEqual(row.get("verdict"), True)


if __name__ == "__main__":
    unittest.main()
