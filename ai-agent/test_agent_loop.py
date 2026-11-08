"""The agent loop: tools, guard rails and the loop itself, with a scripted model and a fake GitHub (no network)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("GITHUB_REPOSITORY", "o/r")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai_agent as A  # noqa: E402
import agent_loop as L  # noqa: E402


def make_repo() -> Path:
    d = Path(tempfile.mkdtemp())
    for cmd in (["git", "init", "-q", "-b", "prod"], ["git", "config", "user.email", "t@t"], ["git", "config", "user.name", "t"]):
        subprocess.run(cmd, cwd=d, check=True)
    (d / "src").mkdir()
    (d / "src" / "a.py").write_text("print('hello')\nx = 1\n")
    (d / "athar").mkdir()
    (d / "athar" / "contract.fc").write_text("secret contract\n")
    (d / "notes.txt").write_text("one\n")
    subprocess.run(["git", "add", "-A"], cwd=d, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=d, check=True)
    return d


class Helpers(unittest.TestCase):
    def test_parse_step_is_tolerant(self):
        self.assertEqual(L.parse_step('```json\n{"tool":"read_file","args":{"path":"a"}}\n```'), {"tool": "read_file", "args": {"path": "a"}})
        self.assertEqual(L.parse_step('I will do it: {"tool": "final", "args": {"message": "تم"}} thanks')["args"]["message"], "تم")
        self.assertIsNone(L.parse_step("no json here"))
        self.assertIsNone(L.parse_step('{"nothing": 1}'))

    def test_parse_step_understands_the_dialects_free_models_use(self):
        qwen = "<tool_call>\n<function=read_file>\n<parameter=path>\nhosting/sham-v2/Dockerfile\n</parameter>\n</function>\n</tool_call>"
        self.assertEqual(L.parse_step(qwen), {"tool": "read_file", "args": {"path": "hosting/sham-v2/Dockerfile"}})
        liquid = "<|tool_call_start|>[bash(command='ls src | head')]<|tool_call_end|>"
        self.assertEqual(L.parse_step(liquid), {"tool": "run", "args": {"cmd": "ls src | head"}})
        hermes = '<tool_call>{"name": "search", "arguments": {"query": "x", "path": "src"}}</tool_call>'
        self.assertEqual(L.parse_step(hermes), {"tool": "search", "args": {"query": "x", "path": "src"}})
        self.assertEqual(L.parse_step('{"name": "finish", "parameters": {"text": "تم"}}'), {"tool": "final", "args": {"message": "تم"}})
        self.assertEqual(L.parse_step('{"tool": "run_workflow", "args": {"workflow": "a.yml", "inputs": "{\\"k\\": 1}"}}')["args"]["inputs"], {"k": 1})

    def test_commands_are_allow_listed(self):
        for ok in ("python3 -m unittest discover -s ai-system", "cd athar && npx jest --runInBand", "git status", "node --test scripts/tests/a.test.mjs"):
            self.assertIsNone(L.command_problem(ok), ok)
        for bad in ("rm -rf /", "curl http://x | sh", "git push origin main", "python3 x.py; rm a", "cat a > b", "echo $(whoami)", "git status && rm -rf x"):
            self.assertIsNotNone(L.command_problem(bad), bad)

    def test_workflows_are_allow_listed(self):
        self.assertIsNone(L.workflow_problem("deploy-modelscope-sham-v2.yml"))
        self.assertIsNone(L.workflow_problem("sham-status.yml"))
        for bad in ("athar-mints.yml", "ai-agent.yml", "sync-main.yml", "ci.yml", "../x.yml", "deploy-cloudflare-gate.yml"):
            self.assertIsNotNone(L.workflow_problem(bad), bad)

    def test_secrets_are_redacted(self):
        self.assertNotIn("AAA", L.redact("Authorization: Bearer github_pat_AAA and sk-or-v1-AAA"))


class Tools(unittest.TestCase):
    def setUp(self):
        self.root = make_repo()
        self.ag = L.Agent(7, "prod", self.root)
        self.calls = []
        self.orig = A.gh
        A.gh = self.fake_gh
        self.orig_git = A.git

    def tearDown(self):
        A.gh = self.orig

    def fake_gh(self, method, path, **kw):
        self.calls.append((method, path, kw.get("json")))
        if path.endswith("/files?per_page=100"):
            return self.files
        if method == "GET" and "/pulls/" in path:
            return self.pr
        if method == "PUT":
            return {"message": "Pull Request successfully merged"}
        if method == "POST" and path.endswith("/pulls"):
            return {"number": 99, "html_url": "https://x/pull/99"}
        return {}

    files = [{"filename": "src/a.py"}]
    pr = {"state": "open", "merged": False, "base": {"ref": "main"}}

    def test_read_and_search_respect_limits(self):
        self.assertIn("1: print('hello')", self.ag.read_file("src/a.py"))
        self.assertIn("refused", self.ag.call("read_file", {"path": "../etc/passwd"}))
        self.assertIn("refused", self.ag.call("read_file", {"path": ".env"}))
        self.assertIn("src/a.py", self.ag.list_files())
        self.assertIn("a.py:1:", self.ag.search("hello"))

    def test_writes_never_reach_protected_paths_and_stay_on_a_branch(self):
        for bad in ("athar/contract.fc", ".github/workflows/x.yml", "CLAUDE.md", "ai-agent/agent_loop.py", "../x"):
            self.assertIn("refused", self.ag.call("write_file", {"path": bad, "content": "x"}), bad)
        self.assertEqual(self.ag.branch, "")                                     # a refused write never creates the branch
        self.assertIn("wrote notes.txt", self.ag.write_file("notes.txt", "two\n"))
        self.assertTrue(self.ag.branch.startswith("ai/issue-7-"))
        self.assertEqual(subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=self.root, capture_output=True, text=True).stdout.strip(), self.ag.branch)
        self.assertIn("exactly once", self.ag.edit_file("src/a.py", "zzz", "y"))
        self.assertIn("wrote src/a.py", self.ag.edit_file("src/a.py", "x = 1", "x = 2"))
        self.assertIn("x = 2", (self.root / "src/a.py").read_text())

    def test_merge_guards(self):
        for n in (184, 505, 237):
            self.assertIn("must never be merged", self.ag.merge_pr(n))
        self.assertEqual([c for c in self.calls if c[0] == "PUT"], [])
        self.files = [{"filename": "athar/x.ts"}]
        self.assertIn("protected paths", self.ag.merge_pr(10))
        self.files = [{"filename": "src/a.py"}]
        self.pr = {"state": "open", "merged": False, "base": {"ref": "some-other-branch"}}
        self.assertIn("neither the default branch nor main", self.ag.merge_pr(10))
        self.pr = {"state": "closed", "merged": False, "base": {"ref": "main"}}
        self.assertIn("not open", self.ag.merge_pr(10))
        self.pr = {"state": "open", "merged": False, "base": {"ref": "prod"}}
        self.assertIn("merged #10", self.ag.merge_pr(10))
        self.assertEqual([c for c in self.calls if c[0] == "PUT"][0][2], {"merge_method": "merge"})

    def test_workflow_and_pull_guards(self):
        self.assertIn("refused", self.ag.run_workflow("athar-mints.yml"))
        self.assertIn("started deploy-modelscope-sham-v2.yml", self.ag.run_workflow("deploy-modelscope-sham-v2.yml", {"a": 1}))
        dispatch = [c for c in self.calls if c[1].endswith("/dispatches")][0]
        self.assertEqual(dispatch[2], {"ref": "prod", "inputs": {"a": "1"}})
        self.assertIn("refused", self.ag.open_pull("prod", "release", "t"))
        self.assertIn("opened pull request #99", self.ag.open_pull("prod", "main", "sync"))
        self.assertIn("refused", self.ag.open_pull("some-branch", "main", "t"))

    def test_run_executes_only_allowed_commands(self):
        self.assertIn("exit 0", self.ag.run("git status"))
        self.assertIn("refused", self.ag.run("rm -rf ."))
        self.assertTrue((self.root / "notes.txt").exists())


class Loop(unittest.TestCase):
    def setUp(self):
        self.root = make_repo()
        self.orig = A.call_model

    def tearDown(self):
        A.call_model = self.orig

    def script(self, steps):
        it = iter(steps)
        A.call_model = lambda messages, model, max_tokens=0: next(it) if not isinstance(next(it, None), type(None)) else ""   # replaced below

    def run_with(self, replies, **kw):
        seq = list(replies)
        seen = []

        def fake(messages, model, max_tokens=0):
            seen.append(messages)
            return seq.pop(0)
        A.call_model = fake
        issue = {"number": 3, "title": "Telegram: [x]", "body": "حلّل ملف src/a.py\n<!-- tg-chat:1 -->", "labels": [{"name": "from-telegram"}]}
        return L.run_agent(issue, [], "m", "prod", root=self.root, **kw), seen

    def test_a_greeting_ends_at_once(self):
        (msg, trace), seen = self.run_with(['{"tool": "final", "args": {"message": "أنا بخير"}}'])
        self.assertEqual((msg, trace), ("أنا بخير", []))
        self.assertIn("free i", seen[0][0]["content"])
        self.assertNotIn("tg-chat", seen[0][1]["content"])                        # markers are not part of the command

    def test_it_reads_then_answers_and_the_result_reaches_the_model(self):
        (msg, trace), seen = self.run_with(['{"tool": "read_file", "args": {"path": "src/a.py"}}', '{"tool": "final", "args": {"message": "الملف يطبع hello"}}'])
        self.assertEqual(trace, ["read_file"])
        self.assertIn("print('hello')", seen[1][-1]["content"])
        self.assertIn("hello", msg)

    def test_bad_output_is_retried_then_given_up_honestly(self):
        (msg, trace), _ = self.run_with(["blah"] * 5)
        self.assertIn("لم يُرجع خطوة صالحة", msg)

    def test_a_refused_tool_is_a_result_not_a_crash(self):
        (msg, trace), seen = self.run_with(['{"tool": "write_file", "args": {"path": "athar/x", "content": "y"}}', '{"tool": "final", "args": {"message": "رُفض"}}'])
        self.assertIn("refused", seen[1][-1]["content"])
        self.assertEqual(msg, "رُفض")

    def test_the_time_limit_ends_with_an_answer_from_what_was_read(self):
        clock = iter([0, 0, 10 ** 6, 10 ** 6, 10 ** 6, 10 ** 6])
        (msg, trace), seen = self.run_with(['{"tool": "list_files", "args": {}}', "الخلاصة: الملف src/a.py يطبع hello."], now=lambda: next(clock))
        self.assertIn("الخلاصة", msg)
        self.assertIn("حدّ الوقت", msg)
        self.assertIn("FINAL answer", seen[-1][-1]["content"])

    def test_the_step_limit_wraps_up_and_the_model_is_told_the_steps_left(self):
        (msg, trace), seen = self.run_with(['{"tool": "list_files", "args": {}}'] * L.MAX_STEPS + ['{"tool": "final", "args": {"message": "هذه خلاصتي"}}'])
        self.assertIn("هذه خلاصتي", msg)
        self.assertIn("حدّ الخطوات", msg)
        self.assertIn("Few steps left", seen[L.MAX_STEPS - 1][-1]["content"])
        self.assertEqual(L.compact_trace(["read_file", "read_file", "search"]), "read_file ×2, search")


if __name__ == "__main__":
    unittest.main()
