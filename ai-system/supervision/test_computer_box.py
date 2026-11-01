"""Tests for the model's free persistent computer (computer_box.py). Commands really run here, as the unprivileged session users when the test machine is root."""
import importlib.util
import json
import os
import tempfile
import time
import unittest
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "modelscope-media" / "computer_box.py"
spec = importlib.util.spec_from_file_location("computer_box", PATH)
cb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cb)


class Box(unittest.TestCase):
    def setUp(self):
        self.old_root = cb.ROOT
        self.tmp = Path(tempfile.mkdtemp())
        os.chmod(self.tmp, 0o755)                     # the session users must be able to walk down to their own home
        cb.ROOT = self.tmp / "computer"
        cb.STATE["egress"] = "test: not touched"        # never touch the test machine's firewall

    def tearDown(self):
        cb.ROOT = self.old_root

    def run_box(self, **job):
        return json.loads(cb.api_box_do(json.dumps(job)))


class Paths(Box):
    def test_a_session_cannot_leave_its_home(self):
        for bad in ("../../etc/passwd", "/../x/../../etc", "a/../../b"):
            with self.assertRaises(ValueError, msg=bad):
                cb.safe_path("u:m", bad)
        self.assertEqual(cb.safe_path("u:m", "/notes.txt"), cb.session_home("u:m") / "notes.txt")

    def test_a_link_pointing_outside_is_refused(self):
        cb.ensure_home("u:m")
        link = cb.session_home("u:m") / "escape"
        os.symlink("/etc", link)
        with self.assertRaises(ValueError):
            cb.safe_path("u:m", "escape/passwd")

    def test_each_session_has_its_own_folder_and_user(self):
        self.assertNotEqual(cb.session_home("a"), cb.session_home("b"))
        self.assertNotEqual(cb.session_uid("a"), cb.session_uid("b"))
        self.assertEqual(cb.session_uid("a"), cb.session_uid("a"))
        self.assertTrue(cb.UID_BASE <= cb.session_uid("anything") < cb.UID_BASE + cb.UID_SPAN)

    def test_output_is_cut_in_the_middle_with_a_hint(self):
        out = cb.clip("x" * 50000, 1000)
        self.assertLess(len(out), 1200)
        self.assertIn("cut", out)


class Running(Box):
    def test_a_command_runs_in_the_home_and_files_stay(self):
        self.assertTrue(self.run_box(session="u:m", action="write", path="hello.txt", content="hi there")["ok"])
        out = self.run_box(session="u:m", action="run", command="cat hello.txt && pwd")
        self.assertEqual(out["exit_code"], 0)
        self.assertIn("hi there", out["output"])
        self.assertIn(str(cb.session_home("u:m")), out["output"])

    def test_the_studio_environment_never_reaches_a_command(self):
        os.environ["STUDIO_SECRET_FOR_TEST"] = "do-not-leak"
        try:
            out = self.run_box(session="u:m", action="run", command="env")
        finally:
            os.environ.pop("STUDIO_SECRET_FOR_TEST", None)
        self.assertNotIn("do-not-leak", out["output"])
        self.assertIn("HOME=" + str(cb.session_home("u:m")), out["output"])

    @unittest.skipUnless(cb.is_root(), "needs root to switch users")
    def test_commands_are_not_root_and_cannot_read_another_sessions_files(self):
        self.run_box(session="alice:m", action="write", path="secret.txt", content="alice only")
        who = self.run_box(session="bob:m", action="run", command="id -u")
        self.assertEqual(int(who["output"].strip()), cb.session_uid("bob:m"))
        steal = self.run_box(session="bob:m", action="run", command=f"cat {cb.session_home('alice:m')}/secret.txt")
        self.assertNotEqual(steal["exit_code"], 0)
        self.assertNotIn("alice only", steal["output"])

    def test_a_command_that_runs_too_long_is_stopped(self):
        started = time.time()
        out = self.run_box(session="u:m", action="run", command="sleep 30", timeout=1)
        self.assertTrue(out.get("timed_out"))
        self.assertIn("computer_job", out["hint"])
        self.assertLess(time.time() - started, 15)

    def test_the_disk_quota_stops_new_work(self):
        old = cb.QUOTA_BYTES
        cb.QUOTA_BYTES = 10
        try:
            self.run_box(session="u:m", action="write", path="a.txt", content="x" * 100)
            out = self.run_box(session="u:m", action="run", command="echo hi")
        finally:
            cb.QUOTA_BYTES = old
        self.assertFalse(out["ok"])
        self.assertIn("full", out["error"])

    def test_listing_and_reading(self):
        self.run_box(session="u:m", action="write", path="src/app.py", content="print(1)")
        listing = self.run_box(session="u:m", action="read", path=".")
        self.assertIn("d src", listing["entries"])
        self.assertNotIn(".jobs", " ".join(listing["entries"]))
        self.assertEqual(self.run_box(session="u:m", action="read", path="src/app.py")["text"], "print(1)")
        self.assertFalse(self.run_box(session="u:m", action="read", path="../../etc/passwd")["ok"])


class Jobs(Box):
    def test_a_job_outlives_the_call_and_can_be_read_and_stopped(self):
        started = self.run_box(session="u:m", action="job_start", command="for i in 1 2 3; do echo tick$i; sleep 0.3; done; sleep 30")
        self.assertTrue(started["ok"])
        job_id = started["id"]
        time.sleep(1.6)
        log = self.run_box(session="u:m", action="job_log", id=job_id)
        self.assertTrue(log["running"])
        self.assertIn("tick3", log["output"])
        stopped = self.run_box(session="u:m", action="job_stop", id=job_id)
        self.assertFalse(stopped["running"])
        self.assertEqual([j["id"] for j in self.run_box(session="u:m", action="job_list")["jobs"]], [job_id])

    def test_another_session_cannot_see_the_job(self):
        job_id = self.run_box(session="a:m", action="job_start", command="sleep 5")["id"]
        self.assertFalse(self.run_box(session="b:m", action="job_log", id=job_id)["ok"])
        self.run_box(session="a:m", action="job_stop", id=job_id)

    def test_too_many_jobs_are_refused(self):
        ids = []
        try:
            for _ in range(cb.MAX_JOBS):
                ids.append(self.run_box(session="u:m", action="job_start", command="sleep 20")["id"])
            self.assertFalse(self.run_box(session="u:m", action="job_start", command="sleep 20")["ok"])
        finally:
            for job_id in ids:
                self.run_box(session="u:m", action="job_stop", id=job_id)

    def test_memory_is_measured_per_process_group(self):
        self.assertGreater(cb.group_rss(os.getpgid(os.getpid())), 1024 * 1024)


class Api(Box):
    def test_bad_requests_are_answered_without_running_anything(self):
        self.assertIn("bad request", cb.api_box_do("nope"))
        self.assertIn("no session", cb.api_box_do("{}"))
        self.assertIn("unknown action", cb.api_box_do(json.dumps({"session": "s", "action": "format"})))

    def test_status_says_what_is_there_and_what_is_blocked(self):
        status = self.run_box(session="u:m", action="status")
        self.assertTrue(status["ok"])
        self.assertIn("python3", status["tools"])
        self.assertIn("egress", status)
        self.assertEqual(status["limits"]["command_seconds"], cb.MAX_TIMEOUT)


if __name__ == "__main__":
    unittest.main()
