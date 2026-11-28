import pytest
import torch
import torch.nn.functional as F

from qalam import Qalam, lora
from qalam.config import tiny_config
from qalam.memory import EpisodicMemory, generate_with_memory, memorize


@pytest.fixture()
def model() -> Qalam:
    torch.manual_seed(0)
    return Qalam(tiny_config()).double().eval()


def greedy(m, prefix, n):
    ids = prefix.clone()
    for _ in range(n):
        lg, _ = m(ids)
        ids = torch.cat([ids, lg[:, -1].argmax(-1, keepdim=True)], dim=1)
    return ids[0, prefix.shape[1]:].tolist()


# ------------------------------------------------------------------------------------------------------- adapters
def test_new_adapter_changes_nothing_and_only_adapters_train(model):
    ids = torch.randint(0, 200, (1, 12))
    before, _ = model(ids)
    h0 = lora.weights_hash(model)
    n = lora.attach(model, "a1", rank=4)
    lora.freeze_base(model)
    after, _ = model(ids)
    assert n > 0 and torch.allclose(before, after) and lora.weights_hash(model) == h0       # B starts at zero
    trainable = [p for p in model.parameters() if p.requires_grad]
    assert trainable and len(trainable) == len(lora.adapter_parameters(model, "a1"))
    assert not model.embed.weight.requires_grad and not model.blocks[0].moe.router.weight.requires_grad


def test_adapter_learns_and_discarding_it_restores_the_base_exactly(model):
    ids = torch.randint(0, 200, (4, 16))
    h0 = lora.weights_hash(model)
    base_logits, _ = model(ids)
    lora.attach(model, "cand", rank=4)
    lora.freeze_base(model)
    opt = torch.optim.Adam(lora.adapter_parameters(model, "cand"), lr=1e-2)
    model.train()
    first = last = None
    for i in range(40):
        opt.zero_grad()
        lg, _ = model(ids[:, :-1])
        loss = F.cross_entropy(lg.reshape(-1, lg.shape[-1]), ids[:, 1:].reshape(-1))
        loss.backward()
        opt.step()
        first = first or float(loss)
        last = float(loss)
    model.eval()
    assert last < first - 0.5 and lora.weights_hash(model) == h0                  # it learned, and the base weights never moved
    lora.detach(model, "cand")
    lora.unwrap(model)
    assert torch.allclose(model(ids)[0], base_logits) and lora.weights_hash(model) == h0          # rollback is exact
    assert all(not isinstance(m, lora.LoRALinear) for m in model.modules())


def test_merge_equals_the_adapter_output_and_banks_switch(model):
    ids = torch.randint(0, 200, (2, 10))
    lora.attach(model, "x", rank=4)
    lora.attach(model, "y", rank=4)
    for p in lora.adapter_parameters(model, "x") + lora.adapter_parameters(model, "y"):
        torch.nn.init.normal_(p, std=0.05)
    lora.set_active(model, {"x": 1.0})
    only_x = model(ids)[0]
    lora.set_active(model, {"x": 1.0, "y": 1.0})
    both = model(ids)[0]
    lora.set_active(model, {})
    none = model(ids)[0]
    assert not torch.allclose(only_x, both) and not torch.allclose(none, only_x)
    lora.set_active(model, {"x": 1.0})
    lora.merge(model, "x")
    lora.detach(model, "y")
    lora.unwrap(model)
    assert torch.allclose(model(ids)[0], only_x, atol=1e-9)                        # merged weights == the adapter's output


def test_adapter_state_round_trips(model):
    ids = torch.randint(0, 200, (1, 9))
    lora.attach(model, "s", rank=2)
    for p in lora.adapter_parameters(model, "s"):
        torch.nn.init.normal_(p, std=0.05)
    ref = model(ids)[0]
    state = lora.adapter_state(model, "s")
    lora.detach(model, "s")
    assert not torch.allclose(model(ids)[0], ref)
    lora.load_adapter_state(model, "s", state)
    assert torch.allclose(model(ids)[0], ref)


# ------------------------------------------------------------------------------------------------------- memory
def test_one_write_teaches_a_fact_and_forgetting_removes_it(model):
    torch.manual_seed(1)
    fact = torch.randint(0, 200, (1, 14))
    ask = fact[:, :9]
    want = fact[0, 9:].tolist()
    base = greedy(model, ask, len(want))
    assert base != want                                                          # the model does not know it
    mem = EpisodicMemory(model.cfg.width)
    assert memorize(model, mem, fact, tag="fact-1") == 13
    got, used = generate_with_memory(model, ask, mem, len(want))
    assert got == want and used == len(want)                                      # known after ONE write, no gradient step
    assert mem.forget("fact-1") == 13 and len(mem) == 0
    again, used = generate_with_memory(model, ask, mem, len(want))
    assert again == base and used == 0


def test_unrelated_context_is_left_to_the_model(model):
    torch.manual_seed(2)
    mem = EpisodicMemory(model.cfg.width)
    memorize(model, mem, torch.randint(0, 200, (1, 14)), tag="a")
    other = torch.randint(0, 200, (1, 9))
    got, used = generate_with_memory(model, other, mem, 6, tau=0.999)
    assert got == greedy(model, other, 6) and used == 0


def test_memory_capacity_save_load_and_validation(model, tmp_path):
    mem = EpisodicMemory(model.cfg.width, capacity=10)
    for i in range(3):
        memorize(model, mem, torch.randint(0, 200, (1, 8)), tag=f"t{i}")
    assert len(mem) == 10 and mem.tags[-1] == "t2"                                # oldest dropped first
    mem.save(tmp_path / "m.pt")
    m2 = EpisodicMemory.load(tmp_path / "m.pt")
    assert len(m2) == 10 and torch.equal(m2.values, mem.values) and m2.tags == mem.tags
    with pytest.raises(ValueError):
        mem.add(torch.zeros(2, 3), torch.zeros(2))


# ------------------------------------------------------------------------------------------------------- governance
from qalam import evolve, governance, star


def test_governance_free_gated_approval_and_forbidden():
    c = governance.classify
    assert c("memory_write", amount=10).allowed and not c("memory_write", amount=10).needs_approval
    assert not c("memory_write", amount=10**7).allowed
    assert c("adapter_train", amount=100).allowed and not c("adapter_train", amount=0).allowed
    assert c("package_install").allowed and not c("package_install").needs_approval                 # owner decision: it needs packages to grow
    # promotion / new tools / merging unprotected code: the GATE decides, no human click (owner decision 2026-11-23)
    for kind in ("adapter_promote", "weights_promote", "tool_register"):
        assert c(kind, gate_passed=True).allowed and not c(kind, gate_passed=True).needs_approval, kind
        assert not c(kind, gate_passed=False, approved=True).allowed, kind                           # approval can never replace the gate
    assert c("code_merge", "workspace/app.py", gate_passed=True).allowed and not c("code_merge", "workspace/app.py", gate_passed=False).allowed
    assert not c("code_merge", "qalam/src/qalam/governance.py", gate_passed=True).allowed           # protected files never merge
    v = c("schedule_create")
    assert not v.allowed and v.needs_approval and c("schedule_create", approved=True).allowed        # scheduling work for itself needs approval
    for kind in ("policy_edit", "gate_edit", "eval_edit", "test_edit", "approval_edit", "confinement_edit", "ci_edit", "secret_access", "something_new"):
        v = c(kind, approved=True, gate_passed=True)
        assert not v.allowed and not v.needs_approval, kind                                         # no approval unlocks these


def test_protected_paths_cover_the_model_s_own_limits():
    p = governance.is_protected
    for path in ("qalam/src/qalam/governance.py", "qalam/src/qalam/evolve.py", "qalam/tests/test_qalam.py", "qalam/eval/suite.json", ".github/workflows/x.yml",
                 "deploy/oracle/a", "athar/x", "CLAUDE.md", "config/secrets.json", "a/b/.env", "../outside", "qalam/../../etc/passwd", "qalam/src/qalam/agent.py"):
        assert p(path), path
    assert not p("qalam/notebooks/N05_writer.py") and not p("workspace/app.py")
    assert not governance.classify("code_edit_dev", "qalam/src/qalam/evolve.py").allowed
    assert governance.classify("code_edit_dev", "workspace/app.py").allowed


# ------------------------------------------------------------------------------------------------------- experience and the gate
def test_experience_only_verified_clean_unique_and_capped():
    log = evolve.ExperienceLog(per_user_cap=2)
    ok = lambda t, r, u="u1", **k: log.add(evolve.Experience(t, r, k.get("verified", True), k.get("verifier", "pytest"), u))   # noqa: E731
    assert ok("add two numbers", "def f(a,b): return a+b")[0]
    assert not ok("add two numbers", "def f(a,b): return a+b")[0]                              # duplicate
    assert not ok("x", "y", verified=False)[0] and not ok("x", "y", verifier="")[0]
    assert not ok("mail me", "to bob@example.com")[0]                                           # PII
    assert ok("second", "r2")[0] and not ok("third", "r3")[0]                                  # per-user cap of 2
    assert ok("third", "r3", u="u2")[0]
    pairs = log.curriculum(lambda t: [t + " please", t + "?"], variants=2)
    assert ("add two numbers", "def f(a,b): return a+b") in pairs and len(pairs) == 3 * 3


def test_wilson_and_gate_rules():
    assert evolve.wilson_lower(0, 0) == 0 and evolve.wilson_lower(10, 10) > 0.7 and evolve.wilson_lower(6, 10) < 0.6
    base = {"h1": (2, 20), "h2": (3, 20), "r": (18, 20)}
    good = {"h1": (19, 20), "h2": (18, 20), "r": (18, 20)}
    assert evolve.gate(good, base, ["h1", "h2"], ["r"]).passed
    assert not evolve.gate(good, base, ["h1"], ["r"]).passed                                      # two held-out sets are required
    regressed = dict(good, r=(15, 20))
    r = evolve.gate(regressed, base, ["h1", "h2"], ["r"])
    assert not r.passed and any("regressed" in x for x in r.reasons)
    weak = dict(good, h2=(10, 20))
    assert not evolve.gate(weak, base, ["h1", "h2"], ["r"]).passed                                 # Wilson lower bound below the floor
    same = {"h1": (2, 20), "h2": (3, 20), "r": (18, 20)}
    assert not evolve.gate(same, base, ["h1", "h2"], ["r"]).passed                                 # no improvement


# ------------------------------------------------------------------------------------------------------- the whole cycle on a real (tiny) model
MARK = {"A": 1, "B": 2, "C": 3}
RULE = {"A": lambda x: (x + 1) % 12 + 20, "B": lambda x: (x * 5) % 12 + 20, "C": lambda x: (x + 7) % 12 + 20}


def example(rule, x, variant):
    pad = [60 + variant, 70 + variant]
    return pad + [MARK[rule], x, RULE[rule](x)]


def make_suite(rule, variants):
    return [torch.tensor(example(rule, x, v)) for v in variants for x in range(12)]


def fit(model, params, curriculum, steps, lr=2e-2):
    opt = torch.optim.Adam(params, lr=lr)
    data = torch.stack(curriculum)
    model.train()
    for _ in range(steps):
        opt.zero_grad()
        lg, _ = model(data[:, :-1])
        F.cross_entropy(lg[:, -1], data[:, -1]).backward()
        opt.step()
    model.eval()


def accuracy(model, suite):
    t = torch.stack(suite)
    with torch.no_grad():
        lg, _ = model(t[:, :-1])
    return int((lg[:, -1].argmax(-1) == t[:, -1]).sum()), len(suite)


@pytest.fixture(scope="module")
def pretrained():
    torch.manual_seed(3)
    m = Qalam(tiny_config())
    data = torch.stack(make_suite("A", (0, 1, 2)) + make_suite("B", (0, 1, 2)))
    opt = torch.optim.Adam(m.parameters(), lr=3e-3)
    for _ in range(500):
        opt.zero_grad()
        lg, _ = m(data[:, :-1])
        F.cross_entropy(lg[:, -1], data[:, -1]).backward()
        opt.step()
    m.eval()
    assert accuracy(m, make_suite("A", (3,)))[0] >= 10 and accuracy(m, make_suite("B", (4,)))[0] >= 10        # it knows A and B, even in unseen variants
    assert accuracy(m, make_suite("C", (3,)))[0] <= 3                                                            # and does not know C
    return m


def suites():
    table = {"C_held1": ("C", (3,)), "C_held2": ("C", (4,)), "A_guard": ("A", (3,)), "B_guard": ("B", (4,))}
    return lambda model, name: accuracy(model, make_suite(*table[name]))


def test_a_good_update_passes_the_gate_and_is_promoted_automatically_and_can_be_reverted_exactly(pretrained, tmp_path):
    import copy
    import json
    from qalam.audit import AuditLog
    m = copy.deepcopy(pretrained)
    cur = make_suite("C", (0, 1, 2))
    replay = make_suite("A", (0, 1, 2)) + make_suite("B", (0, 1, 2))                       # what must not be forgotten
    h0 = lora.weights_hash(m)
    audit = AuditLog(tmp_path / "audit.jsonl")
    res = evolve.self_improve_cycle(m, cur, train_fn=lambda *a: fit(*a, lr=5e-3), eval_fn=suites(), held=["C_held1", "C_held2"], regression=["A_guard", "B_guard"],
                                    adapter="c1", lineage_dir=tmp_path, steps=250, rank=8, replay=replay, audit=audit)
    assert res.status == "promoted" and res.gate.passed and not res.needs_approval, res.reasons          # no human click
    assert res.new_hash != h0 and lora.weights_hash(m) == res.new_hash
    assert accuracy(m, make_suite("C", (3,)))[0] >= 10 and accuracy(m, make_suite("A", (3,)))[0] >= 10      # learned C, kept A
    assert all(not isinstance(x, lora.LoRALinear) for x in m.modules())
    line = [json.loads(x) for x in (tmp_path / "lineage.jsonl").read_text().splitlines()]
    assert line[-1]["passed"] and line[-1]["promoted"] and line[-1]["parent_weights"] == h0
    assert audit.entries()[-1]["status"] == "promoted" and audit.verify() == (True, -1)
    # the "back to the last trusted point" button: exact, bit for bit
    restored = evolve.revert(m, tmp_path, audit=audit)
    assert restored == h0 and accuracy(m, make_suite("C", (3,)))[0] <= 3 and accuracy(m, make_suite("A", (3,)))[0] >= 10
    with pytest.raises(ValueError):
        evolve.revert(m, tmp_path)                                                         # nothing left to revert


def test_with_auto_promotion_off_a_good_candidate_waits_and_promotes_without_approval(pretrained, tmp_path):
    import copy
    m = copy.deepcopy(pretrained)
    replay = make_suite("A", (0, 1, 2)) + make_suite("B", (0, 1, 2))
    h0 = lora.weights_hash(m)
    res = evolve.self_improve_cycle(m, make_suite("C", (0, 1, 2)), train_fn=lambda *a: fit(*a, lr=5e-3), eval_fn=suites(), held=["C_held1", "C_held2"],
                                    regression=["A_guard", "B_guard"], adapter="c2", lineage_dir=tmp_path, steps=250, rank=8, replay=replay, auto_promote=False)
    assert res.status == "promotable" and lora.weights_hash(m) == h0 and accuracy(m, make_suite("C", (3,)))[0] <= 3      # not live
    assert evolve.promote(m, res) != h0 and accuracy(m, make_suite("C", (3,)))[0] >= 10                                  # promotion needs the gate, not a person


def test_the_emergency_stop_halts_the_cycle_and_the_agent_loop(pretrained, tmp_path):
    from qalam.agent import run_agent
    from qalam.audit import EmergencyStop
    stop = EmergencyStop(tmp_path / "STOP")
    stop.engage("owner pressed stop")
    res = evolve.self_improve_cycle(pretrained, make_suite("C", (0,)), train_fn=fit, eval_fn=suites(), held=["C_held1", "C_held2"], regression=[], adapter="s",
                                    lineage_dir=tmp_path, steps=10, stop=stop)
    assert res.status == "stopped"
    cfg = tiny_config()
    steps, _ = run_agent(cfg, lambda s, n: [65], lambda ids: "", lambda t: [], [1], lambda k, t: (True, ""), lambda k, t: True, stop=stop)
    assert [x.kind for x in steps] == ["stopped"]
    stop.release()
    assert not stop.engaged()


def test_the_audit_log_detects_tampering(tmp_path):
    from qalam.audit import AuditLog
    log = AuditLog(tmp_path / "a.jsonl")
    for i in range(4):
        log.append("step", n=i)
    assert log.verify() == (True, -1) and len(log.entries()) == 4
    lines = (tmp_path / "a.jsonl").read_text().splitlines()
    (tmp_path / "a.jsonl").write_text("\n".join([lines[0], lines[1].replace('"n": 1', '"n": 9'), lines[2], lines[3]]) + "\n")
    assert log.verify() == (False, 1)                                                        # an edited line is found
    (tmp_path / "a.jsonl").write_text("\n".join([lines[0], lines[2], lines[3]]) + "\n")
    assert log.verify()[0] is False                                                          # a deleted line is found


def test_learning_a_new_skill_without_replay_forgets_the_old_ones_and_the_gate_catches_it(pretrained, tmp_path):
    import copy
    m = copy.deepcopy(pretrained)
    h0 = lora.weights_hash(m)
    res = evolve.self_improve_cycle(m, make_suite("C", (0, 1, 2)), train_fn=fit, eval_fn=suites(), held=["C_held1", "C_held2"], regression=["A_guard", "B_guard"],
                                    adapter="forgetful", lineage_dir=tmp_path, steps=150, rank=8)
    assert res.status == "rejected" and any("regressed" in r for r in res.reasons) and lora.weights_hash(m) == h0


def test_a_harmful_update_is_rejected_and_the_base_is_bit_identical(pretrained, tmp_path):
    import copy
    m = copy.deepcopy(pretrained)
    h0 = lora.weights_hash(m)
    ref = m(torch.stack(make_suite("A", (3,)))[:, :-1])[0]
    poison = make_suite("C", (0, 1, 2)) + [torch.tensor([60, 70, 1, x, (x + 3) % 12 + 20]) for x in range(12)] * 3        # teaches C but breaks A
    res = evolve.self_improve_cycle(m, poison, train_fn=fit, eval_fn=suites(), held=["C_held1", "C_held2"], regression=["A_guard", "B_guard"],
                                    adapter="bad", lineage_dir=tmp_path, steps=250, rank=8)
    assert res.status == "rejected" and any("A_guard" in r for r in res.reasons), res.reasons
    assert lora.weights_hash(m) == h0 and torch.allclose(m(torch.stack(make_suite("A", (3,)))[:, :-1])[0], ref)
    assert not (tmp_path / "bad.pt").exists()
    with pytest.raises(PermissionError):
        evolve.promote(m, res, approved=True)                                                # a rejected candidate can never be promoted, approved or not
    assert lora.weights_hash(m) == h0


def test_the_cycle_refuses_training_beyond_the_policy(pretrained, tmp_path):
    res = evolve.self_improve_cycle(pretrained, [], train_fn=fit, eval_fn=suites(), held=["C_held1", "C_held2"], regression=[], adapter="x",
                                    lineage_dir=tmp_path, steps=governance.MAX_ADAPTER_STEPS + 1)
    assert res.status == "refused"


# ------------------------------------------------------------------------------------------------------- skills and verified thinking
from qalam.skills import SkillLibrary, screen

GOOD = "def slugify(text):\n    return '-'.join(text.lower().split())\n"
GOOD_TESTS = "assert slugify('Hello World') == 'hello-world'\nassert slugify('a  b') == 'a-b'\n"


def test_skill_is_active_only_after_its_tests_pass(tmp_path):
    lib = SkillLibrary(tmp_path)
    ok, msg = lib.propose("slugify", GOOD, GOOD_TESTS, "turn a title into a url slug")
    assert ok and "v1" in msg and "slugify" in lib.get("slugify")
    ok, msg = lib.propose("slugify", "def slugify(t):\n    return t\n", GOOD_TESTS)                  # a worse version fails its tests
    assert not ok and "tests failed" in msg and lib.get("slugify") == GOOD                          # the active version is untouched
    ok, _ = lib.propose("slugify", GOOD.replace("'-'", "'_'"), "assert slugify('a b') == 'a_b'\n")
    assert ok and "_" in lib.get("slugify")
    assert lib.rollback("slugify") == 1 and lib.get("slugify") == GOOD
    assert [n for n, _ in lib.search("url slug title")] == ["slugify"]


def test_skill_rejections(tmp_path):
    lib = SkillLibrary(tmp_path)
    assert not lib.propose("computer_run", GOOD, GOOD_TESTS)[0]                                       # cannot shadow a built-in tool
    assert not lib.propose("Bad Name", GOOD, GOOD_TESTS)[0]
    assert not lib.propose("notests", GOOD, "print('hi')")[0]                                         # tests must assert
    for evil in ("import os\ndef f():\n    return os.listdir('/')\n", "def f():\n    return open('/etc/passwd').read()\n", "def f(s):\n    return eval(s)\n",
                 "import subprocess\n", "def f(x):\n    return x.__class__.__bases__\n", "from . import secret\n"):
        assert screen(evil) is not None, evil
        assert not lib.propose("evil_skill", evil, "assert f(1) == 1\n")[0]
    assert not lib.propose("looper", "def f():\n    while True:\n        pass\n", "assert f() is None\n")[0]       # an endless test is stopped
    assert lib.get("evil_skill") is None


def test_best_of_n_rejection_round_and_escalation():
    verify = lambda prompt, ans: ans == str(int(prompt.split("+")[0]) + int(prompt.split("+")[1]))   # noqa: E731
    flaky = lambda prompt, i: str(int(prompt.split("+")[0]) + int(prompt.split("+")[1]) + (0 if i == 2 else 1))     # right only on attempt 2   # noqa: E731
    best, passes = star.best_of_n(flaky, verify, "2+3", 4)
    assert best == "5" and passes == 1
    assert star.best_of_n(lambda p, i: "0", verify, "2+3", 4) == (None, 0)
    r = star.rejection_round(flaky, verify, ["1+1", "2+2", "3+3"], n=4)
    assert r["pass_at_1"] == 0.0 and r["pass_at_n"] == 1.0 and len(r["pairs"]) == 3 and r["pairs"][0] == ("1+1", "2")
    calls = []
    levels = [lambda t: (calls.append(1) or "wrong"), lambda t: (calls.append(2) or "wrong"), lambda t: (calls.append(3) or "5")]
    assert star.escalate(levels, verify, "2+3") == ("5", 2) and calls == [1, 2, 3]
    calls.clear()
    assert star.escalate([lambda t: (calls.append(1) or "5"), levels[2]], verify, "2+3") == ("5", 0) and calls == [1]       # cheap level answered: no escalation
    assert star.escalate([lambda t: "x"], verify, "2+3") == (None, 0)
