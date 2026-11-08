"""Offline tests for the AI Agent bridge:  python -m unittest ai-agent/test_ai.py  (needs only `requests`)."""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import ai_agent as M
import telegram_bot as T


class AgentTests(unittest.TestCase):
    def test_paths_refused(self):
        for bad in ("athar/web/x.ts", "cloudflare/w.js", "deploy/oracle/a.sh", ".github/workflows/x.yml", "../etc/passwd", "/etc/passwd", "a//b", "CLAUDE.md",
                    "config/.env", "keys/server.pem", "src/api_token.ts", "ai-agent/ai_agent.py", "C:/x"):
            self.assertIsNotNone(M.path_problem(bad), bad)
        for good in ("src/login/page.tsx", "docs/notes.md", "app.js", "ai-agent/README.md"):
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
        M.refuse_default_branch("ai/issue-5-20261108-120000", "main")
        self.assertTrue(M.branch_name(5, 0).startswith("ai/issue-5-1970"))

    def test_trust_and_mode(self):
        self.assertTrue(M.is_trusted({"author_association": "OWNER", "labels": []}))
        self.assertTrue(M.is_trusted({"author_association": "NONE", "labels": [{"name": "from-telegram"}]}))
        self.assertFalse(M.is_trusted({"author_association": "NONE", "labels": []}))
        self.assertFalse(M.is_trusted({"author_association": "CONTRIBUTOR", "labels": [{"name": "bug"}]}))
        self.assertTrue(M.wants_full({"labels": [{"name": "ai-full"}]}))
        self.assertFalse(M.wants_full({"labels": [{"name": "ai-build"}]}))

    def test_cache_key_changes_with_content_and_mode_only(self):
        a = {"number": 3, "title": "t", "body": "b", "labels": []}
        k = M.content_key(a, False)
        self.assertEqual(k, M.content_key(dict(a), False))
        self.assertNotEqual(k, M.content_key(a, True))
        self.assertNotEqual(k, M.content_key({**a, "body": "b2"}, False))
        self.assertEqual(M.content_key({**a, "labels": [{"name": "ai-full"}]}, True), M.content_key(a, True))     # the full label itself is not content

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
                self.assertTrue(g.call_args.kwargs["json"]["head"].startswith("ai/issue-5-"))
                branches = run("ls-remote", "--heads", "origin").splitlines()
                self.assertTrue(any("refs/heads/ai/issue-5-" in b for b in branches))
                self.assertEqual(run("rev-parse", "origin/main"), main_before)                      # main did not move
                self.assertEqual(subprocess.run(["git", "-C", remote, "rev-parse", "main"], capture_output=True, text=True).stdout.strip(), main_before)
                with self.assertRaises(RuntimeError):
                    M.open_pull_request(6, [{"path": "a.txt", "content": "x"}], "t", "b", "ai/issue-6-" + M.branch_name(6).split("-", 2)[2])   # default == the new branch name: refused
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
        self.assertIn("ai-full", f["labels"])
        self.assertIn("from-telegram", f["labels"])
        n = T.issue_fields("build", "login page", 42, 8)
        self.assertNotIn("ai-full", n["labels"])
        self.assertIsNone(T.issue_fields("help", "", 42, 9))
        self.assertIsNone(T.issue_fields("build", "   ", 42, 9))
        self.assertEqual(T.chat_of(f["body"]), "42")
        long = T.issue_fields("plain", "x" * 300, 1, 1)
        self.assertLess(len(long["title"]), 110)

    def test_split_and_clean(self):
        parts = T.split_message("a" * 9000)
        self.assertTrue(all(len(p) <= 3900 for p in parts))
        self.assertEqual("".join(parts), "a" * 9000)
        self.assertEqual(T.clean_reply("<!-- ai-reply -->\nhello\n\n<sub>AI · model</sub>"), "hello")

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
            self.assertIn("ai-full", create.kwargs["json"]["labels"])
            g.side_effect = [{"items": [{"body": "<!-- tg-update:2 -->"}]}]
            self.assertEqual(T.handle_text("/build again", 42, 2), "")           # the same update is never opened twice

class FakeResp:
    def __init__(self, code, body=None):
        self.status_code = code
        self._b = body or {}
        self.text = "x"

    def json(self):
        return self._b


class ModelCallTests(unittest.TestCase):
    def setUp(self):
        os.environ["OPENROUTER_API_KEY"] = "sk-or-test"

    def test_model_list(self):
        self.assertEqual(M.model_list(""), ["openrouter/free"])
        self.assertEqual(M.model_list("a:free, b:free ,"), ["a:free", "b:free"])

    def test_falls_through_gone_rate_limited_and_empty_models(self):
        seq = {"gone:free": FakeResp(404), "busy:free": FakeResp(429), "empty:free": FakeResp(200, {"choices": [{"message": {"content": "  "}}]}),
               "ok:free": FakeResp(200, {"choices": [{"message": {"content": "answer"}}]})}
        calls = []

        def fake_post(url, headers=None, json=None, timeout=None):
            calls.append((url, json["model"], headers["Authorization"]))
            return seq[json["model"]]
        orig = M.requests.post
        M.requests.post = fake_post
        try:
            self.assertEqual(M.call_model([{"role": "user", "content": "hi"}], "gone:free,busy:free,empty:free,ok:free"), "answer")
        finally:
            M.requests.post = orig
        self.assertEqual([c[1] for c in calls], ["gone:free", "busy:free", "empty:free", "ok:free"])
        self.assertTrue(all(c[0] == "https://openrouter.ai/api/v1/chat/completions" and c[2] == "Bearer sk-or-test" for c in calls))

    def test_bad_key_stops_at_once_and_all_failing_says_so(self):
        orig = M.requests.post
        M.requests.post = lambda *a, **k: FakeResp(401)
        try:
            with self.assertRaises(RuntimeError) as e:
                M.call_model([], "a:free,b:free")
            self.assertIn("refused the key", str(e.exception))
            M.requests.post = lambda *a, **k: FakeResp(429)
            with self.assertRaises(RuntimeError) as e:
                M.call_model([], "a:free,b:free")
            self.assertIn("no model answered", str(e.exception))
        finally:
            M.requests.post = orig
        del os.environ["OPENROUTER_API_KEY"]
        with self.assertRaises(RuntimeError):
            M.call_model([], "a:free")


class Providers(unittest.TestCase):
    def setUp(self):
        self.env = dict(os.environ)
        os.environ["OPENROUTER_API_KEY"] = "sk-or-test"
        os.environ["GROQ_API_KEY"] = "gsk_test"
        self.calls = []
        self.orig = M.requests.post

    def tearDown(self):
        M.requests.post = self.orig
        os.environ.clear()
        os.environ.update(self.env)

    def test_groq_models_go_to_groq_with_its_own_key_and_fall_back_to_openrouter(self):
        class R:
            def __init__(self, code, text=""):
                self.status_code, self._t, self.headers = code, text, {}

            def json(self):
                return {"choices": [{"message": {"content": self._t}}]}

        def fake(url, headers=None, json=None, timeout=0):
            self.calls.append((url, headers["Authorization"], json["model"]))
            return R(429) if "groq.com" in url else R(200, "ok from openrouter")
        M.requests.post = fake
        orig_sleep, M.time.sleep = M.time.sleep, lambda s: None
        try:
            self.assertEqual(M.call_model([], "groq/llama-3.3-70b-versatile,x/y:free"), "ok from openrouter")
        finally:
            M.time.sleep = orig_sleep
        self.assertEqual(self.calls[0], ("https://api.groq.com/openai/v1/chat/completions", "Bearer gsk_test", "llama-3.3-70b-versatile"))
        self.assertEqual(self.calls[1], self.calls[0])                              # Groq's 429 gets one retry
        self.assertEqual(self.calls[2][1:], ("Bearer sk-or-test", "x/y:free"))

    def test_groq_auto_asks_groq_for_its_live_models_and_picks_chat_ones(self):
        class G:
            status_code = 200

            def json(self):
                return {"data": [{"id": "whisper-large-v3"}, {"id": "llama-3.1-8b-instant"}, {"id": "openai/gpt-oss-120b"}, {"id": "meta-llama/llama-guard-4-12b"},
                                 {"id": "llama-3.3-70b-versatile"}, {"id": "qwen/qwen3-32b", "active": False}]}
        orig = M.requests.get
        M.requests.get = lambda *a, **k: G()
        try:
            self.assertEqual(M.model_list("groq/auto,x:free"), ["groq/openai/gpt-oss-120b", "groq/llama-3.3-70b-versatile", "groq/llama-3.1-8b-instant", "x:free"])
            del os.environ["GROQ_API_KEY"]
            self.assertEqual(M.model_list("groq/auto,x:free"), ["x:free"])             # no key: nothing from Groq
        finally:
            M.requests.get = orig

    def test_groq_429_waits_once_and_retries(self):
        slept = []
        orig_sleep, M.time.sleep = M.time.sleep, lambda s: slept.append(s)

        class R:
            def __init__(self, code, text=""):
                self.status_code, self._t, self.headers = code, text, {"retry-after": "7"}

            def json(self):
                return {"choices": [{"message": {"content": self._t}}]}
        seq = [R(429), R(200, "second try")]
        M.requests.post = lambda *a, **k: seq.pop(0)
        try:
            self.assertEqual(M.call_model([], "groq/a"), "second try")
        finally:
            M.time.sleep = orig_sleep
        self.assertEqual(slept, [7.0])

    def test_a_missing_key_skips_that_provider_and_no_key_at_all_says_so(self):
        del os.environ["GROQ_API_KEY"]
        M.requests.post = lambda *a, **k: type("R", (), {"status_code": 200, "json": lambda self: {"choices": [{"message": {"content": "hi"}}]}})()
        self.assertEqual(M.call_model([], "groq/a,b:free"), "hi")           # Groq skipped (no key), OpenRouter answers
        del os.environ["OPENROUTER_API_KEY"]
        with self.assertRaises(RuntimeError) as e:
            M.call_model([], "groq/a,b:free")
        self.assertIn("no key for any model", str(e.exception))


class ChatMode(unittest.TestCase):
    def test_a_telegram_message_is_a_conversation_not_an_engineering_issue(self):
        issue = {"number": 5, "title": "Telegram: [كيف حالك]", "labels": [{"name": "from-telegram"}], "body": "كيف حالك\n\n<!-- tg-chat:42 -->\n<!-- tg-update:7 -->"}
        self.assertTrue(M.is_chat(issue, False))
        msgs = M.build_messages(issue, [], False, "repo context that must not be sent")
        self.assertIn("free i", msgs[0]["content"])
        self.assertEqual(msgs[1]["content"], "كيف حالك")                       # markers and repo context are not in the question
        self.assertFalse(M.is_chat(issue, True))                               # /full keeps the engineering mode
        self.assertFalse(M.is_chat({**issue, "labels": [{"name": "from-telegram"}, {"name": "build"}]}, False))   # /build and /fix too
        self.assertFalse(M.is_chat({**issue, "labels": []}, False))

    def test_a_trusted_person_gets_the_agent_from_github_too(self):
        member = {"number": 1, "title": "t", "labels": [], "author_association": "MEMBER", "body": "x"}
        stranger = {**member, "author_association": "NONE"}
        self.assertTrue(M.uses_agent(member, False))
        self.assertFalse(M.uses_agent(stranger, False))                       # not trusted: never runs at all (is_trusted gate)
        self.assertTrue(M.uses_agent({**stranger, "labels": [{"name": "from-telegram"}]}, False))
        os.environ["AI_AGENT_LOOP"] = "0"
        try:
            self.assertFalse(M.uses_agent(member, False))
        finally:
            del os.environ["AI_AGENT_LOOP"]

    def test_the_same_message_is_answered_once(self):
        answer = {"body": M.MARK + "\nhi\n\n<sub>AI Agent · m · mode: normal (comments only)</sub>"}
        self.assertTrue(M.already_answered([answer], "normal (comments only)"))
        self.assertFalse(M.already_answered([answer], "agent"))                # another mode: it runs
        self.assertFalse(M.already_answered([answer, {"body": "/ai more"}], "normal (comments only)"))   # a newer human comment: it runs
        self.assertFalse(M.already_answered([], "agent"))


if __name__ == "__main__":
    unittest.main()
