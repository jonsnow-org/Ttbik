import json
import os
import tempfile
import unittest
from pathlib import Path

import sham_tldm_experience as E

DENYLIST = Path(__file__).resolve().parent.parent / "tldm" / "evolution" / "owner_denylist.txt"


class ExperienceLog(unittest.TestCase):
    def test_redact_strips_pii_and_secrets(self):
        raw = "email me at ada@example.com token=sk_live_abcdefgh password=hunter2 10.1.2.3 +1 202 555 0173"
        out = E.redact(raw)
        self.assertNotIn("ada@example.com", out)
        self.assertNotIn("sk_live_abcdefgh", out)
        self.assertNotIn("hunter2", out)
        self.assertNotIn("10.1.2.3", out)
        self.assertIn("[email]", out)

    def test_jsonl_has_no_user_ids_and_records_outcomes(self):
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
                display_name="Omar",
            )
            self.assertTrue(rec["verified"] and rec["success"])
            self.assertNotIn("ada@example.com", rec["task"])
            line = dest.read_text(encoding="utf-8")
            self.assertNotIn("ada@example.com", line)
            self.assertNotIn("tldm-sham_v2-42", line)
            self.assertIn('"schema":"tldm.session_experience.v1"', line)
            evo = Path(folder) / "evo" / "sham2-tldm" / "experience"
            self.assertTrue(evo.is_dir(), evo)
            files = list(evo.glob("*.jsonl"))
            self.assertTrue(files, evo)
            body = files[0].read_text(encoding="utf-8")
            self.assertNotIn("ada@example.com", body)
            self.assertNotIn("tldm-sham_v2-42", body)
            self.assertNotIn("Omar", body)
            row = json.loads(body.splitlines()[0])
            self.assertTrue(str(row.get("user") or "").startswith("u_"))
            # A clean exit without a verifier is stored, not learned.
            self.assertIsNone(row.get("verdict"))
            self.assertEqual(row.get("adapter"), "base")

    def test_record_command_uses_verifier_verdict_and_scrubs_the_display_name(self):
        with tempfile.TemporaryDirectory() as folder:
            os.environ["SHAM_TLDM_EVOLUTION_ROOT"] = str(Path(folder) / "evo")
            st = E.record_command(
                "tldm-sham_v2-9",
                "count the lines of /home/Omar/app.log",
                "wc -l /home/Omar/app.log",
                0,
                stdout="12 /home/Omar/app.log",
                stderr="",
                verdict=True,
                latency_s=0.2,
                adapter="count",
                display_name="Omar",
            )
            self.assertEqual(st, "added")
            files = list((Path(folder) / "evo" / "sham2-tldm" / "experience").glob("*.jsonl"))
            row = json.loads(files[0].read_text(encoding="utf-8").splitlines()[0])
            self.assertEqual(row["verdict"], True)
            self.assertEqual(row["adapter"], "count")
            self.assertNotIn("Omar", row["intent"])
            self.assertNotIn("Omar", row["command"])

    def test_training_denylist_file_does_not_change_work_time_gate(self):
        self.assertTrue(DENYLIST.is_file())
        import sys
        sys.path.insert(0, str(DENYLIST.parent))
        import experience as EX
        from approvals import gate
        prev = os.environ.get("SHAM_TLDM_DENYLIST")
        os.environ["SHAM_TLDM_DENYLIST"] = str(DENYLIST)
        try:
            EX.owner_denylist.cache_clear() if hasattr(EX.owner_denylist, "cache_clear") else None
            # Re-read by calling deny_reason (owner_denylist is not lru-cached).
            self.assertEqual(EX.deny_reason("rm -rf /tmp/x"), "owner deny list")
            self.assertEqual(EX.deny_reason("wc -l app.log"), "")
            # Work-time policy is independent: read-only search still runs.
            self.assertEqual(gate("curl https://example.com", "/tmp/ws")[0], "run")
        finally:
            if prev is None:
                os.environ.pop("SHAM_TLDM_DENYLIST", None)
            else:
                os.environ["SHAM_TLDM_DENYLIST"] = prev

    def test_hints_are_optional_and_never_required_to_run(self):
        with tempfile.TemporaryDirectory() as folder:
            os.environ["SHAM_TLDM_EVOLUTION_ROOT"] = str(Path(folder) / "evo")
            h = E.evo_hints("count the lines of app.log")
            self.assertIsInstance(h, dict)
            self.assertIn("recipe", h)
            self.assertIn("banned", h)


if __name__ == "__main__":
    unittest.main()
