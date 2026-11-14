"""Tests for the model's free persistent computer (computer_box.py). Commands really run here, as the unprivileged session users when the test machine is root."""
import importlib.util
import json
import os
import subprocess
from unittest.mock import patch
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
        cb._ACTIVE_DESKTOPS.clear()
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
            cb._ACTIVE_DESKTOPS.clear()

    def test_graphical_desktop_coexists_with_the_model_terminal_but_not_a_second_gui(self):
        old_limit = cb.MAX_GLOBAL_JOBS
        old_mem_probe = cb._mem_available_mb
        cb.MAX_GLOBAL_JOBS = 1
        cb._JOBS.clear()
        cb._ACTIVE_COMMANDS.clear()
        cb._ACTIVE_DESKTOPS.clear()
        cb._mem_available_mb = lambda: 8192
        try:
            first = cb.reserve_desktop("owner:model-x", min_available_mb=3072)
            self.assertTrue(first.get("ok"), first)
            self.assertEqual(first.get("reserved"), True)

            # The selected model must still run shell commands while the owner
            # is viewing the graphical desktop; both use the same session home.
            command = cb.run_command("owner:model-x", "printf 'model-terminal-ok'")
            self.assertTrue(command.get("ok"), command)
            self.assertEqual(command.get("exit_code"), 0)
            self.assertEqual(command.get("output"), "model-terminal-ok")

            # Another user's terminal is NOT blocked by someone else's desktop: each user has a private session and runs at the same time.
            other_user_command = cb.run_command("other:model-x", "echo other-user-ok")
            self.assertTrue(other_user_command.get("ok"), other_user_command)
            self.assertEqual(other_user_command.get("output").strip(), "other-user-ok")

            # The number of desktops at the same time is a limit, not "one": at the limit a new user is refused, below it a second user gets their own desktop.
            old_max = cb.MAX_DESKTOPS
            try:
                cb.MAX_DESKTOPS = 1
                second = cb.reserve_desktop("other:model-x", min_available_mb=3072)
                self.assertFalse(second.get("ok"))
                self.assertIn("desktop slots", second.get("error", ""))
                cb.MAX_DESKTOPS = 2
                second = cb.reserve_desktop("other:model-x", min_available_mb=3072)
                self.assertTrue(second.get("ok"), second)
                cb.release_desktop("other:model-x")
            finally:
                cb.MAX_DESKTOPS = old_max

            # One real background task is also admitted while the GUI exists.
            job = cb.job_start("owner:model-x", "echo background-ok", "background")
            self.assertTrue(job.get("ok"), job)
            log = cb.job_log("owner:model-x", job["id"])
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline and "background-ok" not in log.get("output", ""):
                time.sleep(0.05)
                log = cb.job_log("owner:model-x", job["id"])
            self.assertTrue(log.get("ok"), log)
            self.assertIn("background-ok", log.get("output", ""))
            if log.get("running"):
                cb.job_stop("owner:model-x", job["id"])
                log = cb.job_log("owner:model-x", job["id"])
            self.assertFalse(log.get("running"), log)

            cb.release_desktop("owner:model-x")
            self.assertFalse(cb._ACTIVE_DESKTOPS)
            cb._mem_available_mb = lambda: 2048
            too_low = cb.reserve_desktop("owner:model-x", min_available_mb=3072)
            self.assertFalse(too_low.get("ok"))
            self.assertIn("requires 3072 MB", too_low.get("error", ""))
            cb._mem_available_mb = lambda: None
            unknown = cb.reserve_desktop("owner:model-x", min_available_mb=3072)
            self.assertFalse(unknown.get("ok"))
            self.assertIn("could not report available memory", unknown.get("error", ""))
        finally:
            cb.MAX_GLOBAL_JOBS = old_limit
            cb._mem_available_mb = old_mem_probe
            cb._JOBS.clear()
            cb._ACTIVE_COMMANDS.clear()
            cb._ACTIVE_DESKTOPS.clear()


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

    def test_the_disk_size_is_cached_not_walked_before_every_call(self):
        # measured 2026-11-14: walking a cloned repository on the slow persistent mount took 25-30 s per call; the size is measured once and reused
        calls = []
        real = cb._walk_size
        cb._walk_size = lambda path, cap_files=200000, deadline=None: (calls.append(str(path)), real(path, cap_files, deadline))[1]
        try:
            for _ in range(4):
                self.assertTrue(self.run_box(session="q:m", action="run", command="true")["ok"])
            self.run_box(session="q:m", action="write", path="a.txt", content="x")
            self.run_box(session="q:m", action="status")
        finally:
            cb._walk_size = real
        self.assertEqual(len(calls), 1, calls)

    def test_a_walk_that_runs_out_of_time_is_finished_in_the_background(self):
        old_walk, old_budget = cb._walk_size, cb.QUOTA_BUDGET
        answers = [(7, False), (100, True)]
        cb._walk_size = lambda path, cap_files=200000, deadline=None: answers.pop(0)
        try:
            home = self.tmp / "h"
            home.mkdir()
            self.assertEqual(cb.session_size(home), 7)                         # the lower bound answers at once
            for _ in range(40):
                with cb._LOCK:
                    size = cb._QUOTA[str(home)]["size"]
                if size == 100:
                    break
                time.sleep(0.05)
            self.assertEqual(size, 100)                                        # the background walk replaced it with the real size
        finally:
            cb._walk_size, cb.QUOTA_BUDGET = old_walk, old_budget

    def test_the_home_is_repaired_once_not_walked_before_every_call(self):
        # measured 2026-11-14: ensure_home walked the whole session folder on the slow mount before every call (8-13 s each)
        old_root, old_fix, old_recheck = cb.is_root, cb._fix_owner, cb.HOME_RECHECK
        calls = []
        cb.is_root = lambda: True
        cb._fix_owner = lambda home, uid, deadline=None: (calls.append(str(home)), True)[1]
        try:
            for _ in range(4):
                self.assertTrue(cb.ensure_home("own:m").exists())
            self.assertEqual(len(calls), 1, calls)
            cb.HOME_RECHECK = 0                                                 # after the recheck time it is walked again
            cb.ensure_home("own:m")
            self.assertEqual(len(calls), 2, calls)
        finally:
            cb.is_root, cb._fix_owner, cb.HOME_RECHECK = old_root, old_fix, old_recheck

    def test_a_home_walk_that_runs_out_of_time_is_finished_in_the_background(self):
        old_root, old_fix = cb.is_root, cb._fix_owner
        seen = []
        cb.is_root = lambda: True
        cb._fix_owner = lambda home, uid, deadline=None: (seen.append(deadline is None), deadline is None)[1]
        try:
            cb.ensure_home("slow:m")
            for _ in range(40):
                if len(seen) >= 2:
                    break
                time.sleep(0.05)
        finally:
            cb.is_root, cb._fix_owner = old_root, old_fix
        self.assertEqual(seen, [False, True])                                  # first with a deadline (unfinished), then the full walk in a thread

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

    def test_a_command_still_running_after_the_foreground_wait_becomes_a_job(self):
        # live probe 2026-11-14: an answer that takes longer than ~20 s is lost at the Studio gateway, so the call must answer early and keep the work alive
        old = cb.FG_SECONDS
        cb.FG_SECONDS = 1
        try:
            started = time.time()
            out = self.run_box(session="promo:m", action="run", command="echo first; sleep 3; echo last", timeout=30)
            self.assertLess(time.time() - started, 2.8)
            self.assertTrue(out["ok"] and out["running"], out)
            self.assertIn("first", out["output"])
            self.assertIn("computer_job", out["hint"])
            job_id = out["id"]
            self.assertEqual(out["job"], job_id)
            for _ in range(40):
                log = self.run_box(session="promo:m", action="job_log", id=job_id)
                if not log["running"]:
                    break
                time.sleep(0.25)
            self.assertFalse(log["running"], log)
            self.assertEqual(log["exit_code"], 0)
            self.assertIn("first", log["output"])
            self.assertIn("last", log["output"])
            self.assertIn(job_id, [j["id"] for j in self.run_box(session="promo:m", action="job_list")["jobs"]])
        finally:
            cb.FG_SECONDS = old

    def test_a_promoted_command_is_stopped_at_its_own_timeout_and_can_be_stopped_by_hand(self):
        old = cb.FG_SECONDS
        cb.FG_SECONDS = 1
        try:
            out = self.run_box(session="promo:m", action="run", command="sleep 30", timeout=3)
            self.assertTrue(out["running"], out)
            for _ in range(40):
                log = self.run_box(session="promo:m", action="job_log", id=out["id"])
                if not log["running"]:
                    break
                time.sleep(0.25)
            self.assertFalse(log["running"], log)
            self.assertIn("stopped after 3 s", log["output"])
            other = self.run_box(session="promo:m", action="run", command="sleep 30", timeout=60)
            self.assertTrue(other["running"], other)
            stopped = self.run_box(session="promo:m", action="job_stop", id=other["id"])
            self.assertFalse(stopped["running"])
        finally:
            cb.FG_SECONDS = old

    def test_a_slow_search_keeps_running_as_a_job_and_returns_what_it_has(self):
        old_fg, old_cmd = cb.FG_SECONDS, cb.search_command
        cb.FG_SECONDS = 1
        cb.search_command = lambda pattern, path=".", glob="": "echo first-hit; sleep 3; echo last-hit"
        try:
            out = self.run_box(session="promo:s", action="search", pattern="x")
            self.assertTrue(out["ok"] and out["running"], out)
            self.assertIn("first-hit", out["matches"])
            for _ in range(40):
                log = self.run_box(session="promo:s", action="job_log", id=out["id"])
                if not log["running"]:
                    break
                time.sleep(0.25)
            self.assertIn("last-hit", log["output"])
        finally:
            cb.FG_SECONDS, cb.search_command = old_fg, old_cmd

    def test_search_reads_files_with_many_threads_to_hide_the_mount_latency(self):
        self.assertIn("rg -j 32 ", cb.search_command("foo"))

    def test_a_quick_command_answers_in_the_call_as_before(self):
        old = cb.FG_SECONDS
        cb.FG_SECONDS = 1
        try:
            out = self.run_box(session="promo:m", action="run", command="echo quick", timeout=30)
        finally:
            cb.FG_SECONDS = old
        self.assertTrue(out["ok"])
        self.assertNotIn("running", out)
        self.assertEqual(out["exit_code"], 0)
        self.assertIn("quick", out["output"])

    def test_another_session_cannot_see_the_job(self):
        job_id = self.run_box(session="a:m", action="job_start", command="sleep 5")["id"]
        self.assertFalse(self.run_box(session="b:m", action="job_log", id=job_id)["ok"])
        self.run_box(session="a:m", action="job_stop", id=job_id)

    def test_too_many_jobs_are_refused(self):
        old_limit = cb.MAX_GLOBAL_JOBS
        old_mem_probe = cb._mem_available_mb
        cb.MAX_GLOBAL_JOBS = cb.MAX_JOBS
        cb._mem_available_mb = lambda: 8192
        ids = []
        try:
            for _ in range(cb.MAX_JOBS):
                result = self.run_box(session="u:m", action="job_start", command="sleep 20")
                self.assertTrue(result.get("ok"), result)
                ids.append(result["id"])
            self.assertFalse(self.run_box(session="u:m", action="job_start", command="sleep 20")["ok"])
        finally:
            for job_id in ids:
                self.run_box(session="u:m", action="job_stop", id=job_id)
            cb.MAX_GLOBAL_JOBS = old_limit
            cb._mem_available_mb = old_mem_probe

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

class AptSources(unittest.TestCase):
    def test_x86_ubuntu_mirror_is_replaced_but_other_repositories_are_untouched(self):
        source = (
            "Types: deb\n"
            "URIs: http://mirrors.aliyun.com/ubuntu\n"
            "Suites: jammy jammy-updates jammy-backports\n"
            "Components: main universe\n"
            "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n"
            "deb https://packages.example.test/ubuntu stable main\n"
        )
        rewritten = cb.rewrite_ubuntu_apt_sources_text(source, "x86_64")
        self.assertIn("URIs: https://archive.ubuntu.com/ubuntu", rewritten)
        self.assertIn("deb https://packages.example.test/ubuntu stable main", rewritten)
        self.assertNotIn("mirrors.aliyun.com/ubuntu", rewritten)
        self.assertIn("Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg", rewritten)

    def test_arm64_uses_the_official_ubuntu_ports_archive(self):
        source = "deb http://mirrors.aliyun.com/ubuntu-ports jammy main\n"
        rewritten = cb.rewrite_ubuntu_apt_sources_text(source, "aarch64")
        self.assertEqual(rewritten, "deb https://ports.ubuntu.com/ubuntu-ports jammy main\n")

    def test_source_editor_changes_only_standard_non_symlink_ubuntu_files_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            parts = root / "sources.list.d"
            parts.mkdir()
            main = root / "sources.list"
            main.write_text("deb http://mirrors.aliyun.com/ubuntu jammy main\n", encoding="utf-8")
            deb822 = parts / "ubuntu.sources"
            deb822.write_text("URIs: http://mirrors.aliyun.com/ubuntu\nSuites: jammy-backports\n", encoding="utf-8")
            third_party = parts / "third-party.list"
            third_party.write_text("deb https://packages.example.test stable main\n", encoding="utf-8")
            external = root / "external.list"
            external.write_text("deb http://mirrors.aliyun.com/ubuntu jammy main\n", encoding="utf-8")
            link = parts / "linked.list"
            link.symlink_to(external)

            changed = cb.prepare_ubuntu_apt_sources(root, "x86_64")
            self.assertEqual(set(changed["changed"]), {str(main), str(deb822)})
            self.assertIn("archive.ubuntu.com", main.read_text(encoding="utf-8"))
            self.assertIn("archive.ubuntu.com", deb822.read_text(encoding="utf-8"))
            self.assertIn("packages.example.test", third_party.read_text(encoding="utf-8"))
            self.assertIn("mirrors.aliyun.com", external.read_text(encoding="utf-8"))
            again = cb.prepare_ubuntu_apt_sources(root, "x86_64")
            self.assertEqual(again["changed"], [])


class EgressRules(unittest.TestCase):
    def setUp(self):
        self.old_state = cb.STATE.get("egress", "not checked")
        cb.STATE["egress"] = "not checked"

    def tearDown(self):
        cb.STATE["egress"] = self.old_state

    def test_private_network_rules_are_scoped_to_computer_uids_for_ipv4_and_ipv6(self):
        calls = []

        def fake_run(args, **kwargs):
            calls.append(args)
            if "-C" in args:
                return subprocess.CompletedProcess(args, 1, "", "rule absent")
            return subprocess.CompletedProcess(args, 0, "", "")

        with patch.object(cb, "is_root", return_value=True), \
             patch.object(cb.shutil, "which", side_effect=lambda name: "/usr/sbin/" + name), \
             patch.object(cb.subprocess, "run", side_effect=fake_run):
            result = cb.install_egress_rules()

        self.assertIn("IPv4/IPv6", result)
        adds = [args for args in calls if "-A" in args]
        self.assertEqual(len(adds), 9)
        self.assertTrue(all("--uid-owner" in args for args in adds))
        self.assertTrue(all(f"{cb.UID_BASE}-{cb.UID_BASE + cb.UID_SPAN}" in args for args in adds))
        self.assertTrue(any("100.100.100.200" in args for args in adds))
        self.assertTrue(any("169.254.0.0/16" in args for args in adds))
        self.assertTrue(any("fc00::/7" in args for args in adds))
        self.assertTrue(all(args[args.index("-j") + 1] == "REJECT" for args in adds))

    def test_host_rejection_is_reported_as_partial_not_as_success(self):
        def fake_run(args, **kwargs):
            code = 1 if "-C" in args else 1
            return subprocess.CompletedProcess(args, code, "", "operation not permitted")

        with patch.object(cb, "is_root", return_value=True), \
             patch.object(cb.shutil, "which", side_effect=lambda name: "/usr/sbin/" + name), \
             patch.object(cb.subprocess, "run", side_effect=fake_run):
            result = cb.install_egress_rules()

        self.assertTrue(result.startswith("partly blocked"))
        self.assertIn("refused by the host", result)




class DevTools(unittest.TestCase):
    def test_tiers_skip_when_disk_is_short_and_unknown_packages_are_not_fatal(self):
        import subprocess as sp
        calls: list[list[str]] = []
        old_apt, old_free, old_root = cb.apt_install, cb._free_gb, cb.is_root
        try:
            cb.is_root = lambda: True
            cb._free_gb = lambda: 10.0

            def fake_apt(packages, timeout=0):
                calls.append(list(packages))
                bad = len(packages) > 1 or packages[0] == "no-such-package"
                return sp.CompletedProcess(["apt"], 100 if (len(packages) > 1 or packages == ["no-such-package"]) else 0, "", "")
            cb.apt_install = fake_apt
            cb.DEV_TIERS[:] = [("core", ["gcc", "no-such-package"])]
            result = cb.ensure_dev_tools()
            self.assertIn("1 installed", result)
            self.assertIn("no-such-package: not installable", result)
            cb._free_gb = lambda: 0.5
            cb.DEV_TIERS[:] = [("core", ["gcc"])]
            self.assertIn("only 0.5 GB of disk left", cb.ensure_dev_tools())
        finally:
            cb.apt_install, cb._free_gb, cb.is_root = old_apt, old_free, old_root


class PatchAndTests(Box):
    """2026-11-04: computer_patch applies a unified diff all-or-nothing; computer_test detects the runner and runs it as a job."""

    def test_patch_applies_in_git_and_without_git_and_refuses_a_misfit(self):
        s = "user-p:model-x"
        self.assertTrue(self.run_box(session=s, action="write", path="g/a.py", content="def f():\n    return 1\n")["ok"])
        self.assertEqual(self.run_box(session=s, action="run", command="cd g && git init -q && git add . && git -c user.email=a@b -c user.name=a commit -qm i && echo ok")["exit_code"], 0)
        diff = "--- a/a.py\n+++ b/a.py\n@@ -1,2 +1,2 @@\n def f():\n-    return 1\n+    return 2\n"
        r = self.run_box(session=s, action="patch", diff=diff, cwd="g")
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["files"], ["a.py"])
        self.assertIn("return 2", self.run_box(session=s, action="read", path="g/a.py")["text"])
        again = self.run_box(session=s, action="patch", diff=diff, cwd="g")      # no longer fits: nothing changes
        self.assertFalse(again["ok"])
        self.assertIn("return 2", self.run_box(session=s, action="read", path="g/a.py")["text"])
        self.assertTrue(self.run_box(session=s, action="write", path="p/b.txt", content="x\n")["ok"])
        self.assertTrue(self.run_box(session=s, action="patch", diff="--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-x\n+y\n", cwd="p")["ok"])
        self.assertEqual(self.run_box(session=s, action="read", path="p/b.txt")["text"].strip(), "y")

    @unittest.skipUnless(__import__("shutil").which("make"), "make is not installed here")
    def test_tests_run_as_a_job_with_an_exit_marker(self):
        old = cb._mem_available_mb
        self.addCleanup(setattr, cb, "_mem_available_mb", old)
        cb._mem_available_mb = lambda: 8192
        s = "user-t:model-x"
        self.run_box(session=s, action="write", path="m/Makefile", content="test:\n\t@echo all-good\n")
        r = self.run_box(session=s, action="test", cwd="m")
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["command"], "make test")
        for _ in range(50):
            log = self.run_box(session=s, action="job_log", id=r["id"])
            if not log.get("running"):
                break
            time.sleep(0.1)
        self.assertIn("all-good", log["output"])
        self.assertIn("TESTS_EXIT=0", log["output"])
        none = self.run_box(session=s, action="test", cwd=".")
        self.assertFalse(none["ok"])

    def test_tools_inventory_and_persistent_apt_cache(self):
        t = self.run_box(session="user-q:model-x", action="tools")
        self.assertTrue(t["ok"])
        self.assertIn("rg", t["tools"])
        opts = cb.apt_cache_options()
        self.assertTrue(any(o.startswith("-oDir::Cache::Archives=") for o in opts))


class Batch(Box):
    """2026-11-04: several actions in ONE gateway round trip; order kept, first failure stops, a budget keeps the call inside the gateway's cut."""

    def test_steps_run_in_order_and_stop_at_the_first_error(self):
        s = "user-b:model-x"
        r = self.run_box(session=s, action="batch", steps=[{"action": "write", "path": "q/a.txt", "content": "hi"}, {"action": "read", "path": "q/a.txt"},
                                                          {"action": "run", "command": "exit 3"}, {"action": "nope"}, {"action": "run", "command": "echo NEVER_RAN"}])
        self.assertTrue(r["ok"], r)
        acts = [x["action"] for x in r["results"]]
        self.assertEqual(acts, ["write", "read", "run"])          # the non-zero exit stopped the batch
        self.assertEqual(r["results"][1]["text"], "hi")
        self.assertNotIn("NEVER_RAN", json.dumps(r["results"]))

    def test_no_nested_batch_and_budget_skips_the_rest(self):
        s = "user-b2:model-x"
        nested = self.run_box(session=s, action="batch", steps=[{"action": "batch", "steps": []}])
        self.assertFalse(nested["results"][0]["ok"])
        old = cb.BATCH_BUDGET_S
        self.addCleanup(setattr, cb, "BATCH_BUDGET_S", old)
        cb.BATCH_BUDGET_S = 0
        r = self.run_box(session=s, action="batch", steps=[{"action": "run", "command": "sleep 0.2"}, {"action": "run", "command": "echo late"}])
        self.assertTrue(r["results"][-1].get("skipped"), r)

    def test_a_tip_failure_never_blanks_a_good_answer(self):
        s = "user-b3:model-x"
        with patch.object(cb, "welcome", side_effect=RuntimeError("boom")):
            self.assertTrue(self.run_box(session=s, action="run", command="echo ok")["ok"])

if __name__ == "__main__":
    unittest.main()


class LiveActivity(Box):
    """The live screen's feed: what the session is doing, with a running command's output while it runs; never another session's."""
    def test_feed_records_actions_and_their_results(self):
        self.run_box(session="u1:coder", action="write", path="a.txt", content="hi")
        self.run_box(session="u1:coder", action="run", command="echo LIVE_OK")
        feed = self.run_box(session="u1:coder", action="activity", since=0)
        acts = [(e["action"], e["state"]) for e in feed["activity"]]
        self.assertIn(("write", "done"), acts)
        self.assertIn(("run", "done"), acts)
        run = [e for e in feed["activity"] if e["action"] == "run"][-1]
        self.assertIn("LIVE_OK", run["output"])
        self.assertEqual(run["detail"], "echo LIVE_OK")
        later = self.run_box(session="u1:coder", action="activity", since=feed["seq"])
        self.assertEqual(later["activity"], [])

    def test_feed_is_per_session(self):
        self.run_box(session="u1:coder", action="run", command="echo SECRET_A")
        other = self.run_box(session="u2:coder", action="activity", since=0)
        self.assertFalse(any("SECRET_A" in json.dumps(e) for e in other["activity"]))

    def test_running_command_output_is_visible_before_it_ends(self):
        import threading
        done = {}
        t = threading.Thread(target=lambda: done.update(r=self.run_box(session="u3:coder", action="run", command="echo FIRST_LINE; sleep 3; echo SECOND", timeout=20)))
        t.start()
        seen = ""
        deadline = time.time() + 2.5
        while time.time() < deadline and "FIRST_LINE" not in seen:
            time.sleep(0.2)
            feed = self.run_box(session="u3:coder", action="activity", since=0)
            seen = " ".join(e.get("output", "") for e in feed["activity"] if e["state"] == "start")
        self.assertIn("FIRST_LINE", seen)
        t.join(10)
        self.assertIn("SECOND", done["r"]["output"])

    def test_typed_text_is_never_in_the_feed(self):
        self.assertEqual(cb._act_detail("type", {"text": "hunter2"}), "")
