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


class Capacity(Box):
    def test_only_one_execution_can_run_across_the_whole_studio(self):
        old_limit = cb.MAX_GLOBAL_JOBS
        old_mem_probe = cb._mem_available_mb
        cb.MAX_GLOBAL_JOBS = 1
        cb._JOBS.clear()
        cb._ACTIVE_COMMANDS.clear()
        cb._mem_available_mb = lambda: 8192
        try:
            first = cb.job_start("user-a:model-x", "sleep 20", "first")
            self.assertTrue(first.get("ok"), first)
            second = cb.job_start("user-b:model-x", "echo should-not-run", "second")
            self.assertFalse(second.get("ok"))
            self.assertIn("Studio is busy", second.get("error", ""))
            blocked = cb.run_command("user-c:model-x", "echo should-not-run")
            self.assertFalse(blocked.get("ok"))
            self.assertIn("Studio is busy", blocked.get("error", ""))
            stopped = cb.job_stop("user-a:model-x", first["id"])
            self.assertTrue(stopped.get("ok"), stopped)
        finally:
            cb.MAX_GLOBAL_JOBS = old_limit
            cb._mem_available_mb = old_mem_probe
            cb._JOBS.clear()
            cb._ACTIVE_COMMANDS.clear()


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

    def test_each_session_has_its_own_folder_and_persistently_unique_user(self):
        self.assertNotEqual(cb.session_home("a"), cb.session_home("b"))
        first = cb.session_uid("a")
        second = cb.session_uid("b")
        self.assertNotEqual(first, second)
        self.assertEqual(cb.session_uid("a"), first)
        self.assertTrue(cb.UID_BASE <= first < cb.UID_BASE + cb.UID_SPAN)
        saved = json.loads((cb.ROOT / ".session-uids.json").read_text(encoding="utf-8"))
        self.assertNotIn("a", saved)                       # raw session/user identifiers are never stored
        self.assertEqual(saved[cb.digest("a")], first)

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


class Shortcuts(Box):
    def test_only_public_github_addresses_are_accepted(self):
        self.assertEqual(cb.parse_repo_url("https://github.com/jonsnow-org/Ttbik"), ("jonsnow-org", "Ttbik"))
        self.assertEqual(cb.parse_repo_url("https://github.com/a/b.git"), ("a", "b"))
        for bad in ("https://evil.com/a/b", "http://github.com/a/b", "https://github.com/a", "https://github.com/../x", "https://github.com/a/b; rm -rf /", "git@github.com:a/b.git"):
            self.assertIsNone(cb.parse_repo_url(bad), bad)
        self.assertFalse(self.run_box(session="u:m", action="repo", url="https://evil.com/a/b")["ok"])
        self.assertFalse(self.run_box(session="u:m", action="repo", url="https://github.com/a/b", ref="x; rm -rf /")["ok"])

    def test_search_finds_lines_with_file_and_number(self):
        self.run_box(session="u:m", action="write", path="src/a.ts", content="const alpha = 1;\nconst needle = 2;\n")
        self.run_box(session="u:m", action="write", path="src/b.py", content="needle = 3\n")
        found = self.run_box(session="u:m", action="search", pattern="needle", path="src")
        self.assertTrue(found["ok"])
        self.assertIn("a.ts", found["matches"])
        self.assertIn("2", found["matches"])
        only_ts = self.run_box(session="u:m", action="search", pattern="needle", path="src", glob="*.ts")
        self.assertNotIn("b.py", only_ts["matches"])
        self.assertIn("no matches", self.run_box(session="u:m", action="search", pattern="zzzzz", path="src")["matches"])
        self.assertFalse(self.run_box(session="u:m", action="search", pattern="x", path="../../etc")["ok"])

    def test_the_grep_fallback_honours_the_file_filter_when_ripgrep_is_not_installed(self):
        import shutil, subprocess
        work = self.tmp / "g"
        (work / "src").mkdir(parents=True)
        (work / "src" / "a.ts").write_text("const needle = 2;\n")
        (work / "src" / "b.py").write_text("needle = 3\n")
        bindir = self.tmp / "bin"
        bindir.mkdir()
        for tool in ("grep", "head", "bash"):
            os.symlink(shutil.which(tool), bindir / tool)                      # a PATH without rg: only the fallback can answer
        out = subprocess.run(["/bin/bash", "-c", cb.search_command("needle", "src", "*.ts")], cwd=work, env={"PATH": str(bindir)}, capture_output=True, text=True).stdout
        self.assertIn("a.ts", out)
        self.assertNotIn("b.py", out)

    def test_a_pattern_cannot_inject_a_command(self):
        marker = self.tmp / "pwned"
        self.run_box(session="u:m", action="write", path="a.txt", content="hello")
        self.run_box(session="u:m", action="search", pattern=f"x'; touch {marker}; echo '", path=".")
        self.assertFalse(marker.exists())

    def test_the_playbook_arrives_once_per_session_and_is_a_file(self):
        first = self.run_box(session="u:m", action="run", command="echo hi")
        self.assertIn("computer_repo", first["tips"])
        second = self.run_box(session="u:m", action="run", command="echo again")
        self.assertNotIn("tips", second)
        self.assertIn("NOTES.md", self.run_box(session="u:m", action="read", path="README.md")["text"])
        self.assertTrue(self.run_box(session="u:m", action="read", path="NOTES.md")["ok"])
        self.assertIn("tips", self.run_box(session="other:m", action="run", command="echo hi"))        # a new session is welcomed too

    def test_the_summary_command_describes_a_checkout(self):
        import subprocess
        repo = self.tmp / "r"
        repo.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
        (repo / "a.py").write_text("print(1)\n")
        (repo / "b.ts").write_text("export {}\n")
        subprocess.run(["git", "add", "."], cwd=repo, check=True)
        subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "first"], cwd=repo, check=True)
        out = subprocess.run(["bash", "-c", cb.repo_summary_command(str(repo))], capture_output=True, text=True).stdout
        self.assertIn("files: 2", out)
        self.assertIn("first", out)
        self.assertIn("py(1)", out)
        self.assertIn("a.py", out)

    def test_a_real_public_repository_is_fetched_in_one_call_when_github_is_reachable(self):
        import subprocess
        reach = subprocess.run(["git", "ls-remote", "https://github.com/octocat/Hello-World.git", "HEAD"], capture_output=True, text=True, timeout=40)
        if reach.returncode != 0:
            self.skipTest("GitHub is not reachable from this machine")
        out = self.run_box(session="u:m", action="repo", url="https://github.com/octocat/Hello-World")
        self.assertTrue(out["ok"], out)
        self.assertIn("README", out["summary"])
        found = self.run_box(session="u:m", action="search", pattern="Hello", path="repos/octocat-Hello-World")
        self.assertIn("README", found["matches"])


class Writing(Box):
    def test_edit_sends_only_the_changed_text_and_checks_uniqueness(self):
        self.run_box(session="u:m", action="write", path="a.py", content="x = 1\ny = 2\nz = 3\n")
        done = self.run_box(session="u:m", action="edit", path="a.py", old="y = 2", new="y = 20")
        self.assertTrue(done["ok"])
        self.assertEqual(done["first_line"], 2)
        self.assertEqual(self.run_box(session="u:m", action="read", path="a.py")["text"], "x = 1\ny = 20\nz = 3\n")
        self.run_box(session="u:m", action="write", path="d.txt", content="a\na\n")
        twice = self.run_box(session="u:m", action="edit", path="d.txt", old="a", new="b")
        self.assertFalse(twice["ok"])
        self.assertIn("2 times", twice["error"])
        self.assertTrue(self.run_box(session="u:m", action="edit", path="d.txt", old="a", new="b", replace_all=True)["ok"])
        self.assertFalse(self.run_box(session="u:m", action="edit", path="a.py", old="nope", new="x")["ok"])

    def test_several_edits_apply_together_or_not_at_all(self):
        self.run_box(session="u:m", action="write", path="m.txt", content="one\ntwo\nthree\n")
        bad = self.run_box(session="u:m", action="edit", path="m.txt", edits=[{"old": "one", "new": "1"}, {"old": "missing", "new": "x"}])
        self.assertFalse(bad["ok"])
        self.assertEqual(self.run_box(session="u:m", action="read", path="m.txt")["text"], "one\ntwo\nthree\n")     # the first edit was not kept
        good = self.run_box(session="u:m", action="edit", path="m.txt", edits=[{"old": "one", "new": "1"}, {"old": "three", "new": "3"}])
        self.assertEqual(good["edits"], 2)
        self.assertEqual(self.run_box(session="u:m", action="read", path="m.txt")["text"], "1\ntwo\n3\n")

    def test_an_edit_cannot_reach_outside_the_home(self):
        self.assertFalse(self.run_box(session="u:m", action="edit", path="../../etc/hostname", old="a", new="b")["ok"])
        cb.ensure_home("u:m")
        os.symlink("/etc/hostname", cb.session_home("u:m") / "link.txt")
        self.assertFalse(self.run_box(session="u:m", action="edit", path="link.txt", old="a", new="b")["ok"])

    def make_checkout(self, session="u:m", repo="acme/widgets"):
        import subprocess
        cb.ensure_home(session)
        folder = cb.session_home(session) / "repos" / repo.replace("/", "-")
        folder.mkdir(parents=True)
        run = lambda *a: subprocess.run(a, cwd=folder, check=True, capture_output=True)
        run("git", "init", "-q")
        run("git", "remote", "add", "origin", f"https://github.com/{repo}.git")
        (folder / "keep.py").write_text("print('keep')\n")
        (folder / "gone.py").write_text("print('gone')\n")
        run("git", "add", ".")
        run("git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base")
        if cb.is_root():
            subprocess.run(["chown", "-R", f"{cb.session_uid(session)}:{cb.session_uid(session)}", str(cb.session_home(session))], check=True)
        return folder

    def test_publish_collects_changed_added_and_deleted_files_and_reports_what_it_skips(self):
        folder = self.make_checkout()
        self.run_box(session="u:m", action="edit", path="repos/acme-widgets/keep.py", old="keep", new="kept")
        self.run_box(session="u:m", action="write", path="repos/acme-widgets/new/app.ts", content="export const a = 1;\n")
        self.run_box(session="u:m", action="run", command="cd repos/acme-widgets && rm gone.py && head -c 3000 /dev/urandom > blob.bin && ln -s /etc/hostname sneaky")
        got = self.run_box(session="u:m", action="changes", repo="acme/widgets")
        self.assertTrue(got["ok"], got)
        paths = {f["path"]: f["content"] for f in got["files"]}
        self.assertIn("kept", paths["keep.py"])
        self.assertIn("new/app.ts", paths)
        self.assertEqual(got["deleted"], ["gone.py"])
        why = {s["path"]: s["why"] for s in got["skipped"]}
        self.assertEqual(why["blob.bin"], "binary")
        self.assertIn("sneaky", why)                                  # a link is never followed, so no file outside the checkout can be published
        self.assertNotIn("sneaky", paths)
        self.assertEqual(len(got["base"]), 40)

    def test_publish_refuses_a_folder_that_is_not_that_repository(self):
        self.make_checkout()
        wrong = self.run_box(session="u:m", action="changes", repo="evil/other", dir="repos/acme-widgets")
        self.assertFalse(wrong["ok"])
        self.assertIn("not a checkout of evil/other", wrong["error"])
        self.assertFalse(self.run_box(session="u:m", action="changes", repo="acme/widgets", dir="../../etc")["ok"])
        self.assertFalse(self.run_box(session="u:m", action="changes", repo="not a repo")["ok"])

    def test_nothing_changed_is_reported_as_empty(self):
        self.make_checkout()
        got = self.run_box(session="u:m", action="changes", repo="acme/widgets")
        self.assertTrue(got["ok"])
        self.assertEqual((got["files"], got["deleted"]), ([], []))


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



class WireTests(unittest.TestCase):
    def test_b64_job_is_decoded_and_plain_still_works(self):
        import base64
        job = json.dumps({"action": "run", "command": "echo hello; echo world", "session": "t"})
        self.assertEqual(json.loads(cb.unwrap_body("b64:" + base64.b64encode(job.encode()).decode()))["command"], "echo hello; echo world")
        self.assertEqual(cb.unwrap_body(job), job)

if __name__ == "__main__":
    unittest.main()
