#!/usr/bin/env python3
"""python test_app_port.py -> phase 3 of the agent system (docs/experiments/TLDM_AGENT_SYSTEM.md §5): app_tool and ask_user through Sham's <tool_call> envelope.
Exit test of the phase: no token enters (plan, task file, terminal, app call); a push / PR without the user's yes is refused and never reaches the app; GitHub read, then a PR after the yes.
The web app is a scripted double: this tests the port and the coordinator, not a model and not GitHub."""
import json
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from app_port import AppPort, NEEDS_OK, _EMBEDDED_FALLBACK, envelope, needs_ok, redact  # noqa: E402
from sham_toolcall import CLOSE_TAG, OPEN_TAG  # noqa: E402
from tasks import Coordinator  # noqa: E402

REPO = os.path.realpath(os.path.join(HERE, "..", ".."))
TOKEN = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"          # a fake token, built at run time
TESTS = []


def test(f):
    TESTS.append(f)
    return f


class FakeApp:
    """The web app's side: reads the envelope, runs nothing real, answers like shamRunTool would."""

    def __init__(self, answers=None):
        self.got, self.answers = [], list(answers or [])

    def __call__(self, env, approved):
        assert env.startswith(OPEN_TAG) and env.endswith(CLOSE_TAG), env
        call = json.loads(env[len(OPEN_TAG):-len(CLOSE_TAG)])
        self.got.append((call["name"], call["arguments"], approved))
        name = call["name"]
        if name == "github_read_file":
            return "README content: errors: 2\nleaked by a careless file: " + TOKEN
        if name == "github_create_pr":
            return "pull request #12 opened" if approved else "APPROVAL_REQUIRED"
        if name == "ask_user":
            return self.answers.pop(0) if self.answers else ""
        return "ok"


class Scripted:
    def __init__(self, plan):
        self._plan = plan

    def plan(self, goal):
        return self._plan

    def replan(self, goal, task, failed):
        return []


TOOLS = ["github_read_file", "github_create_pr", "github_merge_pr", "sandbox_push", "http_request", "connector_api", "mcp_call", "ask_user", "computer_run"]

PLAN = [
    {"id": "read", "kind": "app_tool", "args": {"name": "github_read_file", "arguments": {"repo": "o/r", "path": "README.md"}}, "check": {"exit0": True, "contains": "errors: 2"}},
    {"id": "report", "kind": "file", "args": {"op": "write", "path": "report.md", "content": "# Report\nerrors: 2\n"}, "needs": ["read"], "check": {"file": "report.md", "has": "errors: 2"}},
    {"id": "pr", "kind": "app_tool", "args": {"name": "github_create_pr", "arguments": {"repo": "o/r", "title": "report", "files": ["report.md"]}}, "needs": ["report"],
     "check": {"exit0": True, "contains": "opened"}},
]


def coord(plan, port, **kw):
    return Coordinator(tempfile.mkdtemp(prefix="task_"), Scripted(plan), app_call=port, **kw)


@test
def the_port_writes_shams_own_envelope():
    env = envelope("github_read_file", {"repo": "o/r", "path": "ملف.md"})
    assert env == '<tool_call>{"name": "github_read_file", "arguments": {"repo": "o/r", "path": "ملف.md"}}</tool_call>', env
    assert (OPEN_TAG, CLOSE_TAG) == ("<tool_call>", "</tool_call>")


@test
def the_yes_rule_is_the_web_apps_own_rule():
    ts = open(os.path.join(REPO, "src", "lib", "shamExec.ts"), encoding="utf-8").read()
    m = re.search(r"export const SHAM_NEEDS_OK = new Set\(\[([^\]]*)\]\)", ts)
    assert m, "SHAM_NEEDS_OK not found in src/lib/shamExec.ts"
    assert set(re.findall(r'"([^"]+)"', m.group(1))) == set(NEEDS_OK), "app_port.NEEDS_OK must equal the web app's SHAM_NEEDS_OK"
    assert '"http_request"' in ts and '"connector_api"' in ts and "GET|HEAD" in ts
    assert not needs_ok("http_request", {"url": "u"}) and not needs_ok("http_request", {"method": "head"}) and needs_ok("http_request", {"method": "POST"})
    assert not needs_ok("connector_api", {"method": "GET"}) and needs_ok("connector_api", {"method": "DELETE"})
    assert needs_ok("github_create_pr", {}) and not needs_ok("github_read_file", {}) and not needs_ok("send_file", {}), "send_file only sends to the chat: the app does not ask"


@test
def the_embedded_list_matches_shams_code():
    sys.path.insert(0, os.path.join(REPO, "ai-system", "colab", "sham_small"))
    try:
        import sham_embedded_tools
    except Exception as e:                                       # the computer module may not import on this host; the fallback is then what runs
        print("  (sham_embedded_tools did not import here:", repr(e)[:80], ")")
        return
    assert frozenset(sham_embedded_tools.EMBEDDED) == _EMBEDDED_FALLBACK, sorted(frozenset(sham_embedded_tools.EMBEDDED) ^ _EMBEDDED_FALLBACK)


@test
def exit_test_github_read_then_a_pr_only_after_the_users_yes():
    app = FakeApp()
    port = AppPort(app, TOOLS, confirm=lambda q: False)
    c = coord(PLAN, port)
    t = c.run(c.new_task("read, report, PR"))
    assert t.step("read").status == "done" and t.step("report").status == "done" and t.step("pr").status != "done" and t.status != "done", t.log
    assert [n for n, _, _ in app.got] == ["github_read_file"], "a PR without the user's yes never reaches the app"
    assert "needs the user's confirmation" in t.step("pr").result
    app2 = FakeApp()
    asked = []
    port2 = AppPort(app2, TOOLS, confirm=lambda q: asked.append(q) or True)
    c2 = coord(PLAN, port2)
    t2 = c2.run(c2.new_task("read, report, PR"))
    assert t2.status == "done", t2.log
    assert [(n, a) for n, _, a in app2.got] == [("github_read_file", False), ("github_create_pr", True)], app2.got
    assert asked and asked[0].startswith("github_create_pr"), asked


@test
def exit_test_no_token_enters_plan_task_file_terminal_or_app():
    app = FakeApp()
    port = AppPort(app, TOOLS, confirm=lambda q: True)
    plan = [
        {"id": "push", "kind": "app_tool", "args": {"name": "sandbox_push", "arguments": {"repo": "o/r", "token": TOKEN}}, "check": {"exit0": True}},
        {"id": "sh", "kind": "shell", "args": {"command": f"echo {TOKEN} > t.txt"}, "check": {"exit0": True}},
        {"id": "hdr", "kind": "app_tool", "args": {"name": "http_request", "arguments": {"url": "https://x", "headers": {"Authorization": "Bearer " + TOKEN[4:]}}}, "check": {"exit0": True}},
        {"id": "ok", "kind": "app_tool", "args": {"name": "sandbox_push", "arguments": {"repo": "o/r", "token": "{{secret:gh}}"}}, "check": {"exit0": True, "contains": "ok"}},
    ]
    c = coord(plan, port)
    t = c.new_task("push")
    assert [s.id for s in t.steps] == ["ok"], t.log
    c.run(t)
    task_file = open(os.path.join(c.dir, f".task_{t.id}.json"), encoding="utf-8").read()
    assert TOKEN not in task_file and TOKEN[4:] not in task_file and not os.path.exists(os.path.join(c.term.dir, "t.txt"))
    assert app.got == [("sandbox_push", {"repo": "o/r", "token": "{{secret:gh}}"}, True)], "only the placeholder reaches the app; the app fills the secret on its side"
    try:                                                         # the port refuses on its own too (a caller that is not the coordinator)
        port("github_create_pr", {"title": "t", "api_key": "abcdefghijklmnopqrstuvwxyz123456"})
        raise AssertionError("a credential argument must be refused")
    except PermissionError as e:
        assert "credential" in str(e) and "abcdefghij" not in str(e)
    assert len(app.got) == 1


@test
def a_token_in_an_app_result_is_redacted_before_it_reaches_the_task():
    app = FakeApp()
    c = coord(PLAN[:1], AppPort(app, TOOLS))
    t = c.run(c.new_task("read"))
    assert t.step("read").status == "done" and TOKEN not in t.step("read").result and "[redacted]" in t.step("read").result
    assert TOKEN not in open(os.path.join(c.dir, f".task_{t.id}.json"), encoding="utf-8").read()
    assert redact("x " + TOKEN + " y") == "x [redacted] y"


@test
def embedded_and_unknown_tools_do_not_go_through_the_app():
    app = FakeApp()
    port = AppPort(app, TOOLS)
    plan = [{"id": "e", "kind": "app_tool", "args": {"name": "computer_run", "arguments": {"command": "ls"}}, "check": {"exit0": True}},
            {"id": "u", "kind": "app_tool", "args": {"name": "github_delete_everything", "arguments": {}}, "check": {"exit0": True}}]
    for step, why in zip(plan, ("own computer tool", "not a tool the app loaded")):      # one task each: a failed step stops its task
        c = coord([step], port)
        t = c.run(c.new_task("x"))
        assert t.step(step["id"]).status != "done" and why in t.step(step["id"]).result, (t.step(step["id"]).result, t.log)
    assert app.got == [] and "computer_run" not in port.tools


@test
def ask_user_goes_through_the_apps_own_ask_user_tool():
    plan = [{"id": "q", "kind": "ask_user", "args": {"question": "أفتح طلب الدمج؟"}}]
    app = FakeApp(answers=["نعم، افتحه"])
    c = coord(plan, AppPort(app, TOOLS))
    t = c.run(c.new_task("ask"))
    assert t.step("q").status == "done" and app.got == [("ask_user", {"question": "أفتح طلب الدمج؟"}, False)], (app.got, t.log)
    app2 = FakeApp(answers=["لا", "لا", "لا"])
    c2 = coord(plan, AppPort(app2, TOOLS))
    t2 = c2.run(c2.new_task("ask"))
    assert t2.step("q").status != "done", "a no is a no"
    c3 = coord(plan, AppPort(FakeApp(), [n for n in TOOLS if n != "ask_user"]), confirm=lambda q: True)
    assert c3.run(c3.new_task("ask")).step("q").status == "done", "without the app's ask_user, the coordinator's confirm() is used as before"


if __name__ == "__main__":
    bad = 0
    for f in TESTS:
        try:
            f()
            print("PASS", f.__name__)
        except Exception as e:
            import traceback
            traceback.print_exc()
            print("FAIL", f.__name__, repr(e))
            bad += 1
    print(f"{len(TESTS) - bad}/{len(TESTS)} passed")
    sys.exit(1 if bad else 0)
