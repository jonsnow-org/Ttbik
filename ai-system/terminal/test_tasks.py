#!/usr/bin/env python3
"""python test_tasks.py -> phase 1 of the agent system. The planner is a scripted double: this tests the machinery (durable task, coordinator, verifier), not model quality."""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tasks import Coordinator, load  # noqa: E402

TESTS = []


def test(f):
    TESTS.append(f)
    return f


class Scripted:
    def __init__(self, plan, replacement=None):
        self._plan, self._rep, self.replans = plan, replacement, 0

    def plan(self, goal):
        return self._plan

    def replan(self, goal, task, failed):
        self.replans += 1
        return self._rep or []


def coord(planner, **kw):
    d = tempfile.mkdtemp(prefix="task_")
    open(os.path.join(d, "app.log"), "w").write("INFO a\nERROR b\nINFO c\nERROR d\n")
    return Coordinator(d, planner, **kw)


REPORT = [
    {"id": "count", "kind": "shell", "args": {"command": "grep ERROR app.log | wc -l"}, "check": {"exit0": True, "contains": "2"}},
    {"id": "report", "kind": "file", "args": {"op": "write", "path": "report.md", "content": "# Report\nerrors: 2\n"}, "needs": ["count"], "check": {"file": "report.md", "has": "errors: 2"}},
    {"id": "show", "kind": "shell", "args": {"command": "cat report.md"}, "needs": ["report"], "check": {"exit0": True, "contains": "errors: 2"}},
]


@test
def a_multi_step_task_runs_in_order_and_every_step_is_verified():
    c = coord(Scripted(REPORT))
    t = c.run(c.new_task("count the errors and write a report"))
    assert t.status == "done" and [s.status for s in t.steps] == ["done"] * 3, t.log
    assert "errors: 2" in open(os.path.join(c.dir, "report.md")).read()


@test
def a_task_resumes_after_a_stop_without_redoing_finished_steps():
    c = coord(Scripted(REPORT))
    t = c.new_task("g", tid="r1")
    c.run(t, stop_after=1)
    assert [s.status for s in t.steps] == ["done", "pending", "pending"]
    c2 = Coordinator(c.dir, Scripted(REPORT))                         # a new process: only the file survives
    t2 = load(c2._file_of(t))
    c2.run(t2)
    assert t2.status == "done" and c2.executions == 2, (t2.status, c2.executions)


@test
def a_failed_step_is_retried_then_replanned_and_the_task_still_finishes():
    plan = [{"id": "bad", "kind": "shell", "args": {"command": "cat missing.txt"}, "check": {"exit0": True}},
            {"id": "after", "kind": "shell", "args": {"command": "ls"}, "needs": ["bad"], "check": {"exit0": True, "contains": "app.log"}}]
    fix = [{"id": "fixed", "kind": "shell", "args": {"command": "cat app.log"}, "check": {"exit0": True, "contains": "ERROR"}}]
    p = Scripted(plan, fix)
    c = coord(p)
    t = c.run(c.new_task("g"))
    assert t.status == "done" and p.replans == 1 and t.step("bad").status == "replaced" and t.step("after").status == "done", t.log
    assert t.step("bad").tries == 2


@test
def a_step_without_a_check_is_refused_when_the_plan_is_made():
    plan = [{"id": "x", "kind": "shell", "args": {"command": "ls"}}, {"id": "y", "kind": "shell", "args": {"command": "ls"}, "check": {"exit0": True}},
            {"id": "z", "kind": "teleport", "args": {}, "check": {"exit0": True}}]
    c = coord(Scripted(plan))
    t = c.new_task("g")
    assert [s.id for s in t.steps] == ["y"] and any("no check" in l for l in t.log) and any("unknown worker" in l for l in t.log)


@test
def exit_zero_is_not_enough_the_verifier_looks_at_the_result():
    plan = [{"id": "a", "kind": "shell", "args": {"command": "echo hello"}, "check": {"exit0": True, "file": "out.txt"}}]
    c = coord(Scripted(plan))
    t = c.run(c.new_task("g"))
    assert t.status == "failed" and "was not created" in " ".join(t.log), t.log


@test
def read_only_steps_run_in_parallel_and_writing_steps_one_after_the_other():
    sleepy = lambda i: {"id": f"r{i}", "kind": "shell", "args": {"command": "ls"}, "check": {"exit0": True}}
    slow = {"id": "slow", "kind": "shell", "args": {"command": "cat app.log"}, "check": {"exit0": True}}
    plan = [sleepy(1), sleepy(2), slow]
    c = coord(Scripted(plan), slots=3)
    est = c.estimate(c.new_task("g"))
    assert est["width"] == 3, est
    c1 = coord(Scripted(plan), slots=1)
    assert c1.estimate(c1.new_task("g"))["width"] == 1, "one slot = no fake parallelism"
    w = [{"id": "w1", "kind": "file", "args": {"op": "write", "path": "f.txt", "content": "1"}, "check": {"file": "f.txt"}},
         {"id": "w2", "kind": "file", "args": {"op": "append", "path": "f.txt", "content": "2"}, "check": {"file": "f.txt", "has": "12"}}]
    c2 = coord(Scripted(w))
    assert c2.run(c2.new_task("g")).status == "done", "the second write saw the first"


@test
def the_budget_stops_a_task_that_would_run_away():
    plan = [{"id": f"s{i}", "kind": "shell", "args": {"command": "ls"}, "check": {"exit0": True}, "needs": [f"s{i-1}"] if i else []} for i in range(8)]
    c = coord(Scripted(plan))
    t = c.run(c.new_task("g", budget={"max_steps": 3}))
    assert t.status == "budget" and sum(s.status == "done" for s in t.steps) == 3, (t.status, t.log)


@test
def app_tools_never_run_here_and_a_world_changing_call_needs_the_user():
    plan = [{"id": "read", "kind": "app_tool", "args": {"name": "github_read_file", "arguments": {"repo": "o/r", "path": "a"}}, "check": {"exit0": True, "contains": "content"}},
            {"id": "pr", "kind": "app_tool", "args": {"name": "github_create_pr", "arguments": {"title": "t"}}, "needs": ["read"], "check": {"exit0": True, "contains": "opened"}}]
    calls = []

    def runtime(name, args):
        calls.append(name)
        return "content" if "read" in name else "opened #1"
    c = coord(Scripted(plan))                                           # no runtime attached
    assert c.run(c.new_task("g")).status == "failed"
    c = coord(Scripted(plan), app_call=runtime, confirm=lambda q: False)
    t = c.run(c.new_task("g"))
    assert t.step("read").status == "done" and t.step("pr").status != "done" and calls == ["github_read_file"], (calls, t.log)
    calls.clear()
    c = coord(Scripted(plan), app_call=runtime, confirm=lambda q: True)
    assert c.run(c.new_task("g")).status == "done" and calls == ["github_read_file", "github_create_pr"]


@test
def a_file_step_cannot_leave_the_task_folder():
    plan = [{"id": "e", "kind": "file", "args": {"op": "write", "path": "../escape.txt", "content": "x"}, "check": {"exit0": True}}]
    c = coord(Scripted(plan))
    t = c.run(c.new_task("g"))
    assert t.status == "failed" and not os.path.exists(os.path.join(os.path.dirname(c.dir), "escape.txt"))


WAIT_PLAN = [
    {"id": "ask", "kind": "ask_user", "args": {"question": "Write the report?"}},
    {"id": "backup", "kind": "shell", "args": {"command": "mkdir backup"}, "needs": ["ask"], "check": {"exit0": True}},
    {"id": "push", "kind": "app_tool", "args": {"name": "github_push", "arguments": {"branch": "x"}}, "needs": ["backup"], "check": {"exit0": True}},
]


@test
def waiting_for_the_user_pauses_saves_and_resumes_on_the_answer_even_in_a_new_process():
    sent = []
    c = coord(Scripted(WAIT_PLAN), ask_later=True, app_call=lambda name, args: (sent.append(name), "pushed")[1])
    t = c.new_task("ask, back up, push", tid="w1")
    c.run(t)
    assert t.status == "waiting_user" and c.waiting(t) == [("ask", "Write the report?")], (t.status, t.log)
    assert not os.path.isdir(os.path.join(c.dir, "backup")) and sent == [], "nothing after the question runs before the answer"
    c2 = Coordinator(c.dir, Scripted(WAIT_PLAN), ask_later=True, app_call=lambda name, args: (sent.append(name), "pushed")[1])   # the answer arrives later, another process
    t2 = load(c2._file_of(t))
    assert t2.status == "waiting_user" and c2.waiting(t2)[0][0] == "ask"
    c2.resume(t2, "نعم")
    assert t2.status == "waiting_user" and c2.waiting(t2)[0][0] == "backup" and "mkdir backup" in c2.waiting(t2)[0][1], "mkdir needs the user's approval: it waits too"
    assert not os.path.isdir(os.path.join(c.dir, "backup"))
    c2.resume(t2, "yes")
    assert os.path.isdir(os.path.join(c.dir, "backup")) and t2.status == "waiting_user" and c2.waiting(t2)[0][0] == "push" and sent == []
    c2.resume(t2, "ok")
    assert t2.status == "done" and sent == ["github_push"], (t2.status, t2.log)
    assert [s.answer for s in load(c2._file_of(t2)).steps] == ["نعم", "yes", "ok"], "the answers stay in the task file"


@test
def a_no_while_waiting_never_runs_the_step_and_the_task_ends_without_it():
    c = coord(Scripted([dict(WAIT_PLAN[1], needs=[])]), ask_later=True)
    t = c.run(c.new_task("back up", tid="w2"))
    assert t.status == "waiting_user"
    c.resume(t, "لا")
    assert not os.path.isdir(os.path.join(c.dir, "backup")) and t.status == "failed"
    assert "denied by the user" in t.step("backup").result
    try:
        c.resume(t, "yes")
        raise AssertionError("resume without a waiting step must fail")
    except ValueError:
        pass


@test
def waiting_with_the_app_port_sends_the_approved_call_once_with_its_approval():
    from app_port import AppPort
    sent = []
    port = AppPort(lambda env, ok: (sent.append((env, ok)), "done")[1], ["github_merge_pr", "ask_user"])          # no confirm: the app answers later
    plan = [{"id": "merge", "kind": "app_tool", "args": {"name": "github_merge_pr", "arguments": {"pr": 1}}, "check": {"exit0": True}}]
    c = coord(Scripted(plan), ask_later=True, app_call=port)
    t = c.run(c.new_task("merge", tid="w3"))
    assert t.status == "waiting_user" and sent == [] and "github_merge_pr" in c.waiting(t)[0][1]
    c.resume(t, "موافق")
    assert t.status == "done" and len(sent) == 1 and sent[0][1] is True and "github_merge_pr" in sent[0][0]


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
