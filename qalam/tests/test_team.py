import json
import threading

import pytest
import torch

from qalam import executors, team, tools
from qalam import orchestrator as O
from qalam.audit import AuditLog, EmergencyStop
from qalam.config import tiny_config
from qalam.model import Qalam

CFG = tiny_config()
SP = CFG.special_id
enc = lambda s: list(s.encode())  # noqa: E731
dec = lambda ids: bytes(i for i in ids if i < 256).decode("utf-8", "replace")  # noqa: E731


def call(name, **args):
    return [SP("TOOL_BEGIN"), tools.tool_id(CFG, name)] + enc(json.dumps(args)) + [SP("TOOL_END")]


def script(plan):
    """A scripted 'model' per node id: the nth generation of that node emits plan[n]. Used to test the BRIDGE (loop, tools, limits), not the model's intelligence."""
    state, lock = {}, threading.Lock()

    def make(node_id):
        def generate(stream, n, allowed, stops):
            with lock:
                i = state.get(node_id, 0)
                state[node_id] = i + 1
            step = plan[node_id][min(i, len(plan[node_id]) - 1)]
            bad = [t for t in step if t not in set(allowed)]
            assert not bad, f"{node_id} step {i} uses a token the node may not produce: {bad[:3]}"
            return step
        return generate
    return make


@pytest.fixture()
def rt(tmp_path):
    return executors.Runtime(tmp_path / "ws", audit=AuditLog(tmp_path / "a.jsonl"), stop=EmergencyStop(tmp_path / "STOP"))


def worker_for(model, rt, plan, **kw):
    make = script(plan)
    inner = {}

    def w(node, ctx):
        inner.setdefault(node.id, team.make_worker(model, rt, enc, dec, generate=make(node.id), **kw))
        return inner[node.id](node, ctx)
    return w


def N(id, prompt, tools_, deps=(), **kw):
    return O.Node(id, prompt, tuple(deps), frozenset(tools_), **kw)


def test_a_node_runs_a_real_agent_loop_with_real_tools(rt):
    m = Qalam(CFG)
    plan = {"a": [call("file_write", path="notes/a.txt", content="hello"), call("file_read", path="notes/a.txt"), enc("I wrote and read the file: hello")]}
    out = O.Orchestrator().run([N("a", "write a note", {"file_write", "file_read"})], worker_for(m, rt, plan))
    assert out["a"].status == "done" and "hello" in out["a"].output
    assert (rt.ws.root / "notes" / "a.txt").read_text() == "hello"
    assert [e["name"] for e in rt.audit.entries() if e["kind"] == "tool"] == ["file_write"]            # the write is on the record


def test_a_node_cannot_call_tools_it_was_not_given(rt):
    m = Qalam(CFG)
    plan = {"a": [call("computer_run", command="echo hi"), enc("done")]}
    # (1) the model cannot even EMIT that tool's token: the scripted step is rejected by the allowed-token check
    with pytest.raises(AssertionError, match="may not produce"):
        worker_for(m, rt, plan)(N("a", "x", {"file_read"}), O.Context(N("a", "x", {"file_read"}), {}, O.Blackboard(), threading.Event(), 1e12))
    # (2) and if a model somehow did, the loop and the executor refuse it
    ctx = O.Context(N("a", "x", {"file_read"}), {}, O.Blackboard(), threading.Event(), 1e12)
    steps_seen = []
    orig = executors.run_tool
    executors.run_tool = lambda *a, **k: steps_seen.append(a[1]) or orig(*a, **k)
    try:
        calls = iter([call("computer_run", command="echo hi"), enc("gave up")])
        w2 = team.make_worker(m, rt, enc, dec, generate=lambda s, n, allowed, stops: next(calls))
        assert w2(N("a", "x", {"file_read"}), ctx) == "gave up"
    finally:
        executors.run_tool = orig
    assert "computer_run" not in steps_seen


def test_dependents_receive_the_outputs_and_independent_agents_run_together(rt):
    m = Qalam(CFG)
    seen = {}
    barrier = threading.Barrier(2, timeout=3)

    def gen_for(node):
        def g(stream, n, allowed, stops):
            text = dec(stream)
            seen[node] = text
            if node in ("left", "right"):
                barrier.wait()                                                         # both must be running at once
                return enc(f"{node}-done")
            return enc("merged")
        return g
    inner = {}

    def w(node, ctx):
        inner.setdefault(node.id, team.make_worker(m, rt, enc, dec, generate=gen_for(node.id)))
        return inner[node.id](node, ctx)
    out = O.Orchestrator(workers=2).run([N("left", "L", set()), N("right", "R", set()), N("join", "merge", set(), ["left", "right"])], w)
    assert {o.status for o in out.values()} == {"done"} and out["join"].output == "merged"
    assert "left-done" in seen["join"] and "right-done" in seen["join"]               # the dependants' outputs were put into the prompt


def test_approval_and_confirmation_gate_risky_calls(rt):
    m = Qalam(CFG)
    asked = []
    plan = {"a": [call("send_email", to="a@b.com", subject="s", body="b"), enc("could not send")]}

    def deny(kind, body):
        asked.append(body)
        return False
    out = O.Orchestrator().run([N("a", "mail", {"send_email"})], worker_for(m, rt, plan, approve=deny))
    assert out["a"].status == "done" and asked and "send_email" in asked[0]                  # a person was asked, and said no
    assert not any(e["kind"] == "tool" and e["name"] == "send_email" for e in rt.audit.entries())
    plan2 = {"a": [call("computer_run", command="rm -rf stuff"), enc("stopped")]}
    out = O.Orchestrator().run([N("a", "clean", {"computer_run"})], worker_for(m, rt, plan2, approve=lambda k, b: True))
    assert "stopped" in out["a"].output and not any(e["kind"] == "tool" and e["name"] == "computer_run" for e in rt.audit.entries())   # destructive without a typed confirmation: refused


def test_delegation_is_narrower_and_depth_limited(rt):
    m = Qalam(CFG)
    inner_calls = iter([call("file_write", path="sub.txt", content="from child"), enc("child finished")])
    parent_tools = frozenset({"file_write", "file_read", "delegate"})
    rt.delegate = team.make_delegate(m, rt, enc, dec, parent_tools, depth=0, generate=lambda s, n, allowed, stops: next(inner_calls))
    parent = iter([call("delegate", task="write sub.txt", tools=["file_write"], budget=4), enc("parent: child said it finished")])
    w = team.make_worker(m, rt, enc, dec, generate=lambda s, n, allowed, stops: next(parent), approve=lambda k, b: True)     # `delegate` is a write-level tool: a person approved it
    out = O.Orchestrator().run([N("p", "orchestrate", parent_tools)], lambda n, c: w(n, c))
    assert out["p"].status == "done" and (rt.ws.root / "sub.txt").read_text() == "from child"
    # a child asking for a tool its parent does not have is refused before it starts
    with pytest.raises(O.OrchestrationError, match="parent lacks"):
        rt.delegate("x", ["computer_run"], 4)
    deep = team.make_delegate(m, rt, enc, dec, parent_tools, depth=3, generate=lambda *a: enc("x"))
    with pytest.raises(O.OrchestrationError, match="depth"):
        deep("x", ["file_read"], 4)


def test_the_emergency_stop_reaches_a_running_agent(rt):
    m = Qalam(CFG)
    rt.stop.engage("test")
    out = O.Orchestrator(stop=rt.stop).run([N("a", "x", {"file_read"})], team.make_worker(m, rt, enc, dec, generate=lambda *a: enc("hi")))
    assert out["a"].status in ("cancelled", "failed")


def test_it_runs_end_to_end_with_the_real_untrained_model(rt):
    """No intelligence is claimed: an untrained model emits noise. What this shows is that the real model, its token masks, the loop, the executors and the scheduler fit together."""
    torch.manual_seed(0)
    m = Qalam(CFG)
    nodes = [N("a", "hello", {"file_read"}), N("b", "world", {"file_write"}, ["a"])]
    res = team.run_team(m, rt, enc, dec, nodes, workers=2, max_steps=3, max_new=6)
    assert set(res) == {"a", "b"} and all(r.status in ("done", "failed", "skipped") for r in res.values())
    res2 = team.run_team(m, rt, enc, dec, nodes, workers=2, max_steps=3, max_new=6)
    assert {k: (v.status, v.output) for k, v in res.items()} == {k: (v.status, v.output) for k, v in res2.items()}      # deterministic at temperature 0
    allowed = set(team.agent_tokens(CFG, frozenset({"file_read"})))
    assert tools.tool_id(CFG, "file_read") in allowed and tools.tool_id(CFG, "computer_run") not in allowed
