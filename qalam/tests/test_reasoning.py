import threading
import time

import pytest
import torch

from qalam import orchestrator as O
from qalam import reasoning as R
from qalam import skills, tools
from qalam.audit import AuditLog, EmergencyStop
from qalam.config import tiny_config
from qalam.model import Qalam


class Scripted:
    """A policy whose answers are a function of (prompt, sample number): deterministic, so the SEARCH PROCESS is what is being tested."""

    def __init__(self, fn):
        self.fn, self.calls, self.lock = fn, [], threading.Lock()

    def propose(self, prompt, n=1, start=0):
        with self.lock:
            self.calls.append((prompt[:40], start, n))
        return [self.fn(prompt, start + i) for i in range(n)]


def correct(task, text):
    return text == "42"


def test_easy_task_stops_at_the_cheapest_level():
    p = Scripted(lambda pr, i: "ANSWER: 42")
    r = R.Thinker(p, verify=correct).solve("6*7")
    assert r.answer == "42" and r.verified and r.mode == "direct" and r.calls == 1


def test_consensus_beats_a_wrong_first_try_and_reports_confidence():
    wrong = {0: "ANSWER: 1", 1: "ANSWER: 2", 5: "ANSWER: 3"}
    p = Scripted(lambda pr, i: wrong.get(i, "ANSWER: 42"))
    r = R.Thinker(p, verify=correct).solve("6*7", samples=5)
    assert r.verified and r.answer == "42" and r.mode == "consensus"
    # without a verifier the vote is all there is: it is reported as NOT verified, with its agreement rate
    r2 = R.Thinker(Scripted(lambda pr, i: "ANSWER: 42" if i % 4 else "ANSWER: 7")).solve("6*7", samples=8, modes=("consensus",))
    assert r2.answer == "42" and not r2.verified and 0.6 <= r2.confidence <= 1.0
    r3 = R.Thinker(Scripted(lambda pr, i: f"ANSWER: {i}")).solve("q", samples=6, modes=("consensus",))
    assert not r3.verified and r3.confidence < 0.5                                          # everybody disagrees: low confidence, not a fake answer


def plan_policy(plan_ok_after_replan=False):
    def fn(prompt, i):
        if prompt.startswith("PLAN:"):
            if "PREVIOUS PLAN FAILED" in prompt or not plan_ok_after_replan:
                return "1. add the numbers\n2. multiply the sum by two\n3. report"
            return "1. impossible step"
        if "STEP 2" in prompt:
            return "doubled=84" if "FEEDBACK" in prompt else "oops"                          # a step that is wrong until the model reflects on its rejection
        if prompt.startswith("TASK:") and "STEPS DONE" in prompt:
            return "ANSWER: 42"
        if "STEP" in prompt:
            return "done"
        return "ANSWER: 0"                                                                       # a plain attempt is always wrong
    return fn


def test_plan_solve_reflects_on_a_failed_step_and_retries():
    step_ok = lambda task, step, out: out != "oops"  # noqa: E731
    r = R.Thinker(Scripted(plan_policy()), verify=correct, step_check=step_ok).solve("(a+b)*2", samples=2)
    assert r.verified and r.answer == "42" and r.mode == "plan_solve"
    kinds = [(e["kind"], e.get("ok")) for e in r.trace.events]
    assert ("step", False) in kinds and ("reflect", False) in kinds and ("step", True) in kinds     # it failed a step, looked at why, and fixed it
    pair = r.trace.to_pair()
    assert pair and pair[1].endswith("ANSWER: 42") and "oops" not in pair[1]                      # a training trace keeps the good path, not the mistakes
    assert "[plan]" in pair[1] and "[step]" in pair[1]


def test_replan_after_an_unsolvable_plan():
    def fn(prompt, i):
        if prompt.startswith("PLAN:"):
            return "1. fix the thing" if "FAILED" in prompt else "1. impossible"
        if "STEP 1: impossible" in prompt:
            return "cannot"
        if "STEPS DONE" in prompt:
            return "ANSWER: 42"
        return "ok" if "fix the thing" in prompt else "ANSWER: 0"
    bad = lambda task, step, out: out != "cannot"  # noqa: E731
    r = R.Thinker(Scripted(fn), verify=correct, step_check=bad).solve("t", samples=2, retries=1, replans=2)
    assert r.verified and r.mode == "plan_solve" and sum(e["kind"] == "plan" for e in r.trace.events) == 2


def test_beam_search_recovers_from_a_tempting_dead_end():
    def fn(prompt, i):
        state = prompt.split("THOUGHTS SO FAR:\n")[-1].split("\nNEXT THOUGHT:")[0]
        if "good" not in state and "dead" not in state:
            return ["dead end: looks easy", "good: factor it", "weird"][i % 3]
        if "good" in state:
            return ["ANSWER: 42", "meh"][i % 2]
        return "stuck"
    score = lambda task, s: (1.0 if "ANSWER: 42" in s else 0.8 if "good" in s else 0.1 if "dead" in s else 0.0)  # noqa: E731
    r = R.Thinker(Scripted(fn), verify=correct, scorer=score).solve("q", beam=3, modes=("search",))
    assert r.verified and r.answer == "42" and r.mode == "search"


def test_reflection_is_accepted_only_when_it_is_verified():
    p = Scripted(lambda pr, i: "ANSWER: 42" if "CRITIQUE" in pr else "ANSWER: 41")
    crit = lambda task, ans: "off by one"  # noqa: E731
    r = R.Thinker(p, verify=correct, critic=crit).solve("q", modes=("direct", "reflect"))
    assert r.verified and r.mode == "reflect" and r.answer == "42"
    stubborn = Scripted(lambda pr, i: "ANSWER: 41")
    r2 = R.Thinker(stubborn, verify=correct, critic=crit).solve("q", modes=("direct", "reflect"))
    assert not r2.verified and r2.answer == "41"                                                # a revision that does not verify is never presented as fixed


def test_budget_is_a_hard_cap_and_exhaustion_is_reported():
    p = Scripted(lambda pr, i: "ANSWER: 0")
    r = R.Thinker(p, verify=correct).solve("q", R.Budget(calls=3), samples=10)
    assert r.calls == 3 and not r.verified and r.exhausted and sum(n for _, _, n in p.calls) == 3
    r2 = R.Thinker(p, verify=correct).solve("q", R.Budget(calls=100, seconds=0.0))
    assert r2.calls == 0 and not r2.verified


def test_parallel_samples_equal_sequential_ones():
    fn = lambda pr, i: f"ANSWER: {i % 3}"  # noqa: E731
    a = R.Thinker(Scripted(fn)).solve("q", samples=9, modes=("consensus",))
    b = R.Thinker(Scripted(fn), threads=4).solve("q", samples=9, modes=("consensus",))
    assert (a.answer, a.confidence) == (b.answer, b.confidence)


def test_samples_run_concurrently():
    barrier = threading.Barrier(3, timeout=3)

    class P:
        def propose(self, prompt, n=1, start=0):
            barrier.wait()                                                                     # only passes if three samples are in flight at once
            return ["ANSWER: 42"]
    r = R.Thinker(P(), verify=correct, threads=3).solve("q", samples=3, modes=("consensus",))
    assert r.verified


# ------------------------------------------------------------------ the real model as a policy
def test_model_sampling_is_greedy_at_zero_and_reproducible_with_a_seed():
    torch.manual_seed(0)
    cfg = tiny_config()
    m = Qalam(cfg)
    prefix = torch.randint(0, 200, (1, 8))
    greedy, _ = m.generate_speculative(prefix, 10)
    assert torch.equal(m.generate(prefix, 10), greedy)                                        # temperature 0 is exactly greedy decoding
    a, b = m.generate(prefix, 12, temperature=1.0, seed=1), m.generate(prefix, 12, temperature=1.0, seed=1)
    c = m.generate(prefix, 12, temperature=1.0, seed=2)
    assert torch.equal(a, b) and not torch.equal(a, c)                                         # reproducible, and different seeds give different thoughts
    assert all(int(t) in set(cfg.text_and_end_ids()) for t in a[0])
    stop = int(a[0, 3])
    assert m.generate(prefix, 12, temperature=1.0, seed=1, stop_id=stop).shape[1] <= 4


def test_model_policy_gives_diverse_but_reproducible_candidates():
    torch.manual_seed(0)
    m = Qalam(tiny_config())
    pol = R.ModelPolicy(m, lambda s: [b for b in s.encode()][:30], lambda ids: "".join(chr(33 + t % 90) for t in ids), temperature=1.0, max_new=12)
    x, y = pol.propose("hello", 4), pol.propose("hello", 4)
    assert x == y and len(set(x)) > 1


# ------------------------------------------------------------------ agents and threads
def N(id, deps=(), tools_=(), **kw):
    return O.Node(id, f"do {id}", tuple(deps), frozenset(tools_), **kw)


def test_independent_agents_really_run_in_parallel():
    barrier = threading.Barrier(3, timeout=3)

    def worker(n, ctx):
        barrier.wait()
        return n.id
    out = O.Orchestrator(workers=3).run([N("a"), N("b"), N("c")], worker)
    assert {o.status for o in out.values()} == {"done"}


def test_dependencies_order_and_inputs():
    order, lock = [], threading.Lock()

    def worker(n, ctx):
        with lock:
            order.append(n.id)
        return "+".join(sorted(ctx.inputs.values())) or n.id
    out = O.Orchestrator().run([N("a"), N("b"), N("c", ["a", "b"]), N("d", ["c"])], worker)
    assert order.index("c") > max(order.index("a"), order.index("b")) and order[-1] == "d"
    assert out["c"].output == "a+b" and out["d"].output == "a+b"


def test_failures_are_contained_and_dependants_are_skipped_with_a_reason():
    tries = {"flaky": 0}

    def worker(n, ctx):
        if n.id == "bad":
            raise RuntimeError("boom")
        if n.id == "flaky":
            tries["flaky"] += 1
            if tries["flaky"] < 2:
                raise RuntimeError("once")
        return n.id
    out = O.Orchestrator().run([N("bad", retries=1), N("flaky", retries=1), N("after_bad", ["bad"]), N("fine"), N("after_flaky", ["flaky"])], worker)
    assert out["bad"].status == "failed" and out["bad"].attempts == 2 and "boom" in out["bad"].error
    assert out["after_bad"].status == "skipped" and "bad" in out["after_bad"].error            # never run on missing input
    assert out["flaky"].status == "done" and out["flaky"].attempts == 2 and out["after_flaky"].status == "done" and out["fine"].status == "done"


def test_a_child_can_never_have_more_power_than_its_parent():
    o = O.Orchestrator(max_depth=2, max_nodes=4)
    parent = frozenset({"file_read", "fin_stats"})
    o.check_graph([N("ok", tools_={"file_read"})], parent)
    with pytest.raises(O.OrchestrationError, match="parent lacks"):
        o.check_graph([N("greedy", tools_={"file_read", "computer_run"})], parent)
    with pytest.raises(O.OrchestrationError, match="unknown tool"):
        o.check_graph([N("x", tools_={"made_up_tool"})])
    with pytest.raises(O.OrchestrationError, match="depth"):
        o.check_graph([N("deep", depth=3)])
    with pytest.raises(O.OrchestrationError, match="cycle"):
        o.check_graph([N("a", ["b"]), N("b", ["a"])])
    with pytest.raises(O.OrchestrationError, match="duplicate"):
        o.check_graph([N("a"), N("a")])
    with pytest.raises(O.OrchestrationError, match="1 to 4"):
        o.check_graph([N(str(i)) for i in range(5)])
    with pytest.raises(O.OrchestrationError, match="unknown dependency"):
        o.check_graph([N("a", ["zzz"])])
    n = N("child")
    o.check_graph([n], parent, parent_depth=1)
    assert n.depth == 2                                                                         # depth grows with every delegation


def test_emergency_stop_cancels_running_and_pending_agents(tmp_path):
    stop = EmergencyStop(tmp_path / "STOP")
    started = threading.Event()

    def worker(n, ctx):
        started.set()
        for _ in range(400):
            ctx.check()
            time.sleep(0.01)
        return "finished"
    o = O.Orchestrator(workers=2, stop=stop, audit=AuditLog(tmp_path / "a.jsonl"))
    threading.Thread(target=lambda: (started.wait(2), stop.engage("test")), daemon=True).start()
    out = o.run([N("a"), N("b", ["a"])], worker)
    assert out["a"].status == "cancelled" and out["b"].status in ("cancelled", "skipped")
    assert any(e["kind"] == "node_start" for e in o.audit.entries())


def test_a_node_has_a_deadline():
    def worker(n, ctx):
        time.sleep(0.15)
        ctx.check()
        return "late"
    out = O.Orchestrator().run([N("slow", seconds=0.05, retries=0)], worker)
    assert out["slow"].status == "failed" and "deadline" in out["slow"].error


def test_blackboard_has_no_lost_updates():
    b = O.Blackboard()
    b.put("n", 0)

    def inc():
        for _ in range(50):
            while True:
                ver, val = b.get("n")
                try:
                    b.put("n", val + 1, expect_version=ver)
                    break
                except O.OrchestrationError:
                    continue
    ts = [threading.Thread(target=inc) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert b.get("n")[1] == 200
    with pytest.raises(O.OrchestrationError, match="changed by another"):
        b.put("n", 1, expect_version=1)


def test_batched_tool_calls_parallel_reads_serial_writes_in_order():
    log, lock = [], threading.Lock()
    barrier = threading.Barrier(3, timeout=3)

    def runner(name, args):
        with lock:
            log.append(("start", name))
        if name == "fin_stats":
            barrier.wait()                                                                      # three reads must be in flight together
        with lock:
            log.append(("end", name))
        return True, name
    calls = [("fin_stats", {"path": "a"}), ("fin_stats", {"path": "b"}), ("fin_stats", {"path": "c"}), ("file_write", {"path": "x", "content": "1"}), ("file_read", {"path": "x"})]
    res = O.run_batch(calls, runner)
    assert [r[1] for r in res] == ["fin_stats"] * 3 + ["file_write", "file_read"]               # results in call order
    names = [n for k, n in log if k == "start"]
    assert names.index("file_write") == 3 and names.index("file_read") == 4                      # the write waited for the reads and the read waited for the write


# ------------------------------------------------------------------ skills learn which of them to trust
def test_skill_ranking_follows_real_outcomes(tmp_path):
    lib = skills.SkillLibrary(tmp_path / "sk")
    good = "def total(xs):\n    return sum(xs)\n"
    t = "from skill import total\n\ndef test_t():\n    assert total([1, 2]) == 3\n"
    assert lib.propose("sum_numbers_a", good, t, "sum a list of numbers")[0] and lib.propose("sum_numbers_b", good, t, "sum a list of numbers")[0]
    for _ in range(6):
        lib.record("sum_numbers_a", False)
        lib.record("sum_numbers_b", True)
    assert lib.search("sum numbers")[0][0] == "sum_numbers_b"
    assert lib.stats("sum_numbers_a")["needs_rework"] and not lib.stats("sum_numbers_b")["needs_rework"]
    assert lib.stats("sum_numbers_b")["success_rate"] > 0.8
