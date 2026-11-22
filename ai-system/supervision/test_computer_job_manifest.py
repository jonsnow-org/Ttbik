"""Review note #1198 §4.6: a job survives a Studio restart as a truthful record (finished / interrupted), not as "no such job"."""
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "modelscope-media"))
import computer_box as box  # noqa: E402


class JobManifest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_root = box.ROOT
        box.ROOT = pathlib.Path(self.tmp.name)

    def tearDown(self):
        box.ROOT = self.old_root
        self.tmp.cleanup()

    def _plant(self, job_id, saved, text="out"):
        jobs = box.session_home("s1") / ".jobs"
        jobs.mkdir(parents=True, exist_ok=True)
        (jobs / f"{job_id}.json").write_text(json.dumps(saved))
        (jobs / f"{job_id}.log").write_text(text)

    def test_finished_job_is_returned_with_its_exit_code(self):
        self._plant("aaaa1111", {"command": "make", "name": "", "started": 10.0, "exit_code": 0, "ended": 15.0}, "built")
        box._JOBS.clear()
        r = box.job_log("s1", "aaaa1111")
        self.assertTrue(r["ok"] and r["exit_code"] == 0 and r["running"] is False and "built" in r["output"])

    def test_unfinished_job_is_reported_interrupted(self):
        self._plant("bbbb2222", {"command": "sleep 999", "name": "", "started": 10.0, "exit_code": None, "ended": None}, "half")
        box._JOBS.clear()
        r = box.job_log("s1", "bbbb2222")
        self.assertTrue(r["ok"] and r["interrupted"] is True and r["exit_code"] is None)
        self.assertIn("half", r["output"])
        listed = box.job_list("s1")["jobs"]
        self.assertTrue(any(j["id"] == "bbbb2222" and j.get("interrupted") for j in listed))

    def test_unknown_job_is_still_unknown(self):
        box._JOBS.clear()
        self.assertFalse(box.job_log("s1", "cccc3333")["ok"])


if __name__ == "__main__":
    unittest.main()
