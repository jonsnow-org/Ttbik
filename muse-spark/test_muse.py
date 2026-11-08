"""Offline tests for the Muse Spark Open bridge:  python -m unittest muse-spark/test_muse.py  (needs only `requests`)."""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import muse_agent as M
import telegram_bot as T


class AgentTests(unittest.TestCase):
    def test_paths_refused(self):
        for bad in ("athar/web/x.ts", "cloudflare/w.js", "deploy/oracle/a.sh", ".github/workflows/x.yml", "../etc/passwd", "/etc/passwd", "a//b", "CLAUDE.md",
                    "config/.env", "keys/server.pem", "src/api_token.ts", "muse-spark/muse_agent.py", "C:/x"):
            self.assertIsNotNone(M.path_problem(bad), bad)
        for good in ("src/login/page.tsx", "docs/notes.md", "app.js", "muse-spark/README.md"):
            self.assertIsNone(M.path_problem(good), good)

    def test_validate_changes(self):
        ok, refused = M.validate_changes([{"path": "a.txt", "content": "x"}, {"path": "athar/x", "content": "y"}, {"path": "big.txt", "content": "z" * (M.MAX_FILE_BYTES + 1)}])
        self.assertEqual([c["path"] for c in ok], ["a.txt"])
        self.assertEqual(len(refused), 2)
        many = [{"path": f"f{i}.txt", "content": "x"} for i in range(M.MAX_FILES + 3)]
        ok, refused = M.validate_changes(many)
        self.assertEqual(len(ok), M.MAX_FILES)
        self.assertEqual(len(refused), 3)

    def test_default_branch_is_never_written(self):
        for target in ("main", "master", "trunk"):
            with self.assertRaises(RuntimeError):
                M.refuse_default_branch(target, "trunk")
        M.refuse_default_branch("muse/issue-5-20261108-120000", "main")
        self.assertTrue(M.branch_name(5, 0).startswith("muse/issue-5-1970"))

    def test_trust_and_mode(self):
        self.assertTrue(M.is_trusted({"author_association": "OWNER", "labels": []}))
        self.assertTrue(M.is_trusted({"author_association": "NONE", "labels": [{"name": "from-telegram"}]}))
        self.assertFalse(M.is_trusted({"author_association": "NONE", "labels": []}))
        self.assertFalse(M.is_trusted({"author_association": "CONTRIBUTOR", "labels": [{"name": "bug"}]}))
        self.assertTrue(M.wants_full({"labels": [{"name": "muse-full"}]}))
        self.assertFalse(M.wants_full({"labels": [{"name": "muse-build"}]}))

    def test_cache_key_changes_with_content_and_mode_only(self):
        a = {"number": 3, "title": "t", "body": "b", "labels": []}
        k = M.content_key(a, False)
        self.assertEqual(k, M.content_key(dict(a), False))
        self.assertNotEqual(k, M.content_key(a, True))
        self.assertNotEqual(k, M.content_key({**a, "body": "b2"}, False))
        self.assertEqual(M.content_key({**a, "labels": [{"name": "muse-full"}]}, True), M.content_key(a, True))     # the full label itself is not content

    def test_parse_reply(self):
        d = M.parse_reply('```json\n{"comment": "hi", "changes": [{"path": "a", "content": "b"}, {"path": 1}]}\n```')
        self.assertEqual(d["comment"], "hi")
        self.assertEqual(len(d["changes"]), 1)
        self.assertEqual(M.parse_reply("just words")["comment"], "just words")
        self.assertEqual(M.parse_reply('blah {"comment": "x"} blah')["comment"], "x")


class FlowTests(unittest.TestCase):
    def test_full_mode_goes_through_a_branch_and_a_pull_request_never_main(self):
        import subprocess
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            remote, work = os.path.join(td, "remote.git"), os.path.join(td, "work")
            subprocess.run(["git", "init", "-q", "--bare", "-b", "main", remote], check=True)
            subprocess.run(["git", "clone", "-q", remote, work], check=True, capture_output=True)
            run = lambda *a: subprocess.run(["git", "-C", work, *a], check=True, capture_output=True, text=True).stdout.strip()
            run("config", "user.email", "t@t")
            run("config", "user.name", "t")
            open(os.path.join(work, "README.md"), "w").write("x")
            run("add", "."); run("commit", "-qm", "init"); run("push", "-q", "origin", "HEAD:main")
            main_before = run("rev-parse", "origin/main")
            cwd = os.getcwd()
            os.chdir(work)
            try:
                with mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r", "GITHUB_TOKEN": "x"}), mock.patch.object(M, "gh", return_value={"html_url": "https://github.com/o/r/pull/9"}) as g:
                    url = M.open_pull_request(5, [{"path": "src/login.js", "content": "ok"}], "login page", "body", "main")
                self.assertEqual(url, "https://github.com/o/r/pull/9")
                self.assertEqual(g.call_args.kwargs["json"]["base"], "main")
                self.assertTrue(g.call_args.kwargs["json"]["head"].startswith("muse/issue-5-"))
                branches = run("ls-remote", "--heads", "origin").splitlines()
                self.assertTrue(any("refs/heads/muse/issue-5-" in b for b in branches))
                self.assertEqual(run("rev-parse", "origin/main"), main_before)                      # main did not move
                self.assertEqual(subprocess.run(["git", "-C", remote, "rev-parse", "main"], capture_output=True, text=True).stdout.strip(), main_before)
                with self.assertRaises(RuntimeError):
                    M.open_pull_request(6, [{"path": "a.txt", "content": "x"}], "t", "b", "muse/issue-6-" + M.branch_name(6).split("-", 2)[2])   # default == the new branch name: refused
            finally:
                os.chdir(cwd)


class TelegramTests(unittest.TestCase):
    def test_commands(self):
        self.assertEqual(T.parse_command("/build صفحة login"), ("build", "صفحة login"))
        self.assertEqual(T.parse_command("/fix الملف app.js"), ("fix", "الملف app.js"))
        self.assertEqual(T.parse_command("/full قم بإعادة هيكلة المشروع"), ("full", "قم بإعادة هيكلة المشروع"))
        self.assertEqual(T.parse_command("/full@MyBot do it"), ("full", "do it"))
        self.assertEqual(T.parse_command("hello there"), ("plain", "hello there"))
        self.assertEqual(T.parse_command("/start")[0], "help")

    def test_issue_fields(self):
        f = T.issue_fields("full", "refactor everything", 42, 7)
        self.assertEqual(f["title"], "Telegram: [refactor everything]")
        self.assertIn("muse-full", f["labels"])
        self.assertIn("from-telegram", f["labels"])
        n = T.issue_fields("build", "login page", 42, 8)
        self.assertNotIn("muse-full", n["labels"])
        self.assertIsNone(T.issue_fields("help", "", 42, 9))
        self.assertIsNone(T.issue_fields("build", "   ", 42, 9))
        self.assertEqual(T.chat_of(f["body"]), "42")
        long = T.issue_fields("plain", "x" * 300, 1, 1)
        self.assertLess(len(long["title"]), 110)

    def test_split_and_clean(self):
        parts = T.split_message("a" * 9000)
        self.assertTrue(all(len(p) <= 3900 for p in parts))
        self.assertEqual("".join(parts), "a" * 9000)
        self.assertEqual(T.clean_reply("<!-- muse-reply -->\nhello\n\n<sub>Muse · model</sub>"), "hello")

    def test_only_the_owner_is_served(self):
        env = {"TELEGRAM_CHAT_ID": "42", "GITHUB_TOKEN": "x", "GITHUB_REPOSITORY": "o/r", "TELEGRAM_BOT_TOKEN": "t"}
        with mock.patch.dict(os.environ, env), mock.patch.object(T, "gh") as g:
            self.assertEqual(T.handle_text("/full hack", 999, 1), "")           # a stranger: no issue, no answer
            g.assert_not_called()
            g.side_effect = [{"items": []}, {"number": 12}]
            out = T.handle_text("/full قم بإعادة هيكلة المشروع", 42, 2)
            self.assertIn("#12", out)
            create = g.call_args_list[-1]
            self.assertEqual(create.args[:2], ("POST", "/repos/o/r/issues"))
            self.assertIn("muse-full", create.kwargs["json"]["labels"])
            g.side_effect = [{"items": [{"body": "<!-- tg-update:2 -->"}]}]
            self.assertEqual(T.handle_text("/build again", 42, 2), "")           # the same update is never opened twice


if __name__ == "__main__":
    unittest.main()
