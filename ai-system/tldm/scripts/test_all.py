#!/usr/bin/env python3
"""python scripts/test_all.py -> every check of the checklist. PASS/FAIL per test; exit code 1 if any fails."""
import importlib.util
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT  # noqa: E402
import torch  # noqa: E402
from sham_tldm import (BitLinear, Compressor, LatentThinker, MambaBlock, DiffusionWriter, Sham1_TLDM, ShamBodyTLDM, encode_bytes, decode_bytes,  # noqa: E402
                       pack_ternary, unpack_ternary, bitnet_size_bytes)
import terminal_tasks as T  # noqa: E402

TESTS = []


def test(f):
    TESTS.append(f)
    return f


@test
def bitlinear_is_ternary_and_packs_to_a_fifth_of_a_byte():
    layer = BitLinear(100, 50)
    q, s = layer.ternary()
    assert set(q.unique().tolist()) <= {-1, 0, 1}
    blob = pack_ternary(q)
    assert torch.equal(unpack_ternary(blob, q.numel(), q.shape), q.to(torch.int8)), "pack/unpack must round-trip"
    assert abs(len(blob) / q.numel() - 0.2) < 0.01, len(blob) / q.numel()
    y = layer(torch.randn(3, 100)); y.sum().backward()
    assert layer.weight.grad is not None, "straight-through estimator must pass gradients"


@test
def mamba_parallel_scan_equals_token_by_token_recurrence():
    torch.manual_seed(0)
    b = MambaBlock(32, bitnet=False, chunk=8).eval()
    x = torch.randn(2, 37, 32)
    with torch.no_grad():
        full = b(x)
        h = torch.zeros(2, 32)
        outs = []
        for t in range(x.shape[1]):
            y, h = b.step(x[:, t], h)
            outs.append(y)
    assert torch.allclose(full, torch.stack(outs, 1), atol=1e-4), (full - torch.stack(outs, 1)).abs().max()


@test
def compressor_compresses_long_input_and_does_not_expand_short_input():
    c = Compressor(32, 12, pool_over=512)
    assert c(torch.randn(1, 5000, 32)).shape == (1, 12, 32)
    assert c(torch.randn(1, 7, 32)).shape == (1, 12, 32)


@test
def thinker_early_exit_stops_when_converged():
    th = LatentThinker(32, steps=8)
    z = torch.randn(1, 6, 32)
    _, used_full = th(z)
    for p in th.parameters():
        p.data.zero_()                                    # a cell that changes nothing has converged at once
    _, used = th(z, early_exit=True)
    assert used_full == 8 and used < 8, (used_full, used)


@test
def writer_writes_the_block_in_the_requested_number_of_passes_and_is_deterministic():
    w = DiffusionWriter(32, 48, vocab=257, layers=2)
    calls = []
    orig = w.logits
    w.logits = lambda *a, **k: (calls.append(1), orig(*a, **k))[1]
    z = torch.randn(2, 6, 32)
    out = w.generate(z, steps=10)
    assert out.shape == (2, 48) and len(calls) == 10, (out.shape, len(calls))
    assert torch.equal(out, w.generate(z, steps=10))


@test
def model_learns_the_30_examples_gradients_everywhere_and_generation_depends_on_the_task():
    # Pinned to one thread and 400 steps: with 250 steps the result depended on the thread count (2 threads, the GitHub runner's: 1/6 exact from seed 0; 1 thread: 6/6),
    # which made the T-LDM workflow fail one run in two. Measured locally, 400 steps: 5-6/6 for seeds 0-2 at 1 and 2 threads.
    threads = torch.get_num_threads()
    torch.set_num_threads(1)
    try:
        torch.manual_seed(0)
        m = Sham1_TLDM(d=96, layers=2, latents=8, think_steps=3, block=48, heads=4, in_len=48)
        rows = T.TRAIN[:6]
        ids = torch.tensor([encode_bytes(t, 48) for t, _ in rows])
        tgt = torch.tensor([encode_bytes(c, 48) for _, c in rows])
        opt = torch.optim.AdamW(m.parameters(), lr=3e-3)
        first = None
        for step in range(400):
            opt.zero_grad(); l = m.loss(ids, tgt); l.backward(); opt.step()
            first = first or l.item()
        assert all(p.grad is not None for p in m.parameters()), "every parameter must receive a gradient"
        assert l.item() < first * 0.3, (first, l.item())
        m.eval()
        out, _ = m.generate(ids, steps=10)
        cmds = [decode_bytes(r) for r in out]
        assert len(set(cmds)) > 1, "different tasks must give different commands"
        assert sum(c == ref for c, (_, ref) in zip(cmds, rows)) >= 4, cmds
    finally:
        torch.set_num_threads(threads)

def _tiny_sham_body():
    d = os.path.join(os.path.dirname(ROOT), "colab", "sham_small")
    sys.path.insert(0, d)
    spec = importlib.util.spec_from_file_location("sham_small_model", os.path.join(d, "model.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cfg = mod.ShamSmallConfig(vocab_size=400, d_model=64, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=64, adapter_rank=4)
    return mod.ShamSmall(cfg)


@test
def sham_body_conversion_freezes_the_donor_and_trains_only_head_and_adapters():
    torch.manual_seed(0)
    body = _tiny_sham_body()
    before = {k: v.clone() for k, v in body.state_dict().items() if "adapter" not in k}
    m = ShamBodyTLDM(body, latents=8, think_steps=3, block=32, heads=4)
    rep = m.trainable_report()
    assert rep["trainable_pct"] < 100 and rep["new_head"] > 0, rep
    assert not any(p.requires_grad for n, p in body.named_parameters() if "adapter" not in n), "donor weights must be frozen"
    ids = torch.randint(0, 300, (2, 20))
    tgt = torch.tensor([encode_bytes("ls", 32)] * 2)
    opt = torch.optim.AdamW([p for p in m.parameters() if p.requires_grad], lr=1e-2)
    for _ in range(3):
        opt.zero_grad(); m.loss(ids, tgt).backward(); opt.step()
    after = body.state_dict()
    assert all(torch.equal(before[k], after[k]) for k in before), "a training step changed donor weights"
    out, info = m.generate(ids, steps=5)
    assert out.shape == (2, 32) and info["latents"] == 8


@test
def sandbox_blocks_every_forbidden_command_and_path_escape():
    t = T.fresh()
    try:
        for cmd in ("rm -rf /", "rm -rf .", "sudo ls", "passwd", "shutdown now", "curl http://x", "wget http://x", "cat /etc/passwd", "cat ../x", "ls /", "echo hi > /tmp/x", "ls; ls", "ls && ls", "pip install x", "git status", "bash -c ls"):
            r = t.run(cmd, confirm=True)
            assert not r.ok and (r.refused or r.out == ""), (cmd, r)
        assert t.run("echo $HOME").out == "$HOME", "no shell expansion: a variable name stays a literal and no environment can leak"
        assert t.run("mkdir backup").needs_confirmation, "mkdir must ask the human"
        assert t.run("python3 -c \"import os\"").refused, "python code with os must be refused"
    finally:
        t.close()


@test
def trusted_script_runs_but_a_modified_one_is_refused():
    t = T.fresh()
    try:
        assert t.run("python3 organize.py").ok
        assert os.path.isdir(os.path.join(t.dir, "jpg")) and os.path.isdir(os.path.join(t.dir, "txt"))
    finally:
        t.close()
    t = T.fresh()
    try:
        open(os.path.join(t.dir, "organize.py"), "a").write("\n# changed\n")
        assert "sha256" in t.run("python3 organize.py").refused
    finally:
        t.close()


@test
def the_30_terminal_examples_all_run_and_are_logged():
    rows = [r for r in (T.execute(c) for _, c in T.TRAIN)]
    assert all(ok for ok, _, _ in rows), [c for (_, c), (ok, _, _) in zip(T.TRAIN, rows) if not ok]
    assert len(T.TRAIN) == 30 and len(T.HELDOUT) >= 10


@test
def same_effect_masks_the_sandbox_folder_and_the_clock_but_still_tells_wrong_commands_apart():
    assert T.same_effect("pwd", "pwd") and T.same_effect("date", "date")      # each run has its own temp folder / second
    assert not T.same_effect("pwd", "ls") and not T.same_effect("date", "touch date.txt")
    assert not T.same_effect("pwd", "echo '<sandbox>'"), "the mask must not be writable by the command itself"


def _sham_computer(session):
    d = os.path.join(os.path.dirname(ROOT), "colab", "sham_small")
    sys.path.insert(0, d)
    sys.path.insert(0, os.path.join(os.path.dirname(ROOT), "terminal"))
    import sham_computer
    import uuid
    return sham_computer.Computer(session=session + "_" + uuid.uuid4().hex[:8])         # a fresh workspace per run: tests must not depend on earlier runs


@test
def one_body_per_model_the_terminal_works_through_the_models_own_computer():
    sys.path.insert(0, os.path.join(os.path.dirname(ROOT), "terminal"))
    from backends import ComputerBackend
    comp = _sham_computer("tldm_test_one_body")
    calls = []
    orig = comp.execute
    comp.execute = lambda name, args: (calls.append(name), orig(name, args))[1]
    b = ComputerBackend(comp, policy="model_computer")
    assert b.run("echo hello > made_by_terminal.txt").ok
    assert "hello" in comp.execute("computer_read", {"path": "made_by_terminal.txt"}), "the model's own tools must see the terminal's file: one body"
    assert set(calls) <= {"computer_run", "computer_read"}, calls                      # the terminal only ever calls the tool the model already has
    assert b.run("echo $HOME").out.startswith("/"), "model_computer policy = the computer's own behaviour, unchanged (shell expansion works)"
    assert b.run("false").ok is False


@test
def strict_policy_is_applied_before_the_command_reaches_the_computer():
    sys.path.insert(0, os.path.join(os.path.dirname(ROOT), "terminal"))
    from backends import ComputerBackend
    comp = _sham_computer("tldm_test_strict")
    calls = []
    orig = comp.execute
    comp.execute = lambda name, args: (calls.append((name, args.get("command"))), orig(name, args))[1]
    b = ComputerBackend(comp, policy="strict")
    for cmd in ("rm -rf /", "sudo ls", "curl http://x", "cat /etc/passwd", "ls; ls"):
        r = b.run(cmd, confirm=True)
        assert not r.ok and r.refused, cmd
    assert calls == [], "a refused command must never reach the computer"
    assert b.run("mkdir backup").needs_confirmation and calls == []
    assert b.run("mkdir backup", confirm=True).ok and b.run("ls").out == "backup"
    assert [c for c, _ in calls] == ["computer_run", "computer_run"]


@test
def sham_v1_and_v2_share_one_embedded_computer_today_and_the_terminal_is_visible_to_the_owner():
    sys.path.insert(0, os.path.join(os.path.dirname(ROOT), "terminal"))
    from sham_binding import ShamEmbeddedBackend, session_key
    import sham_embedded_tools as tools
    import uuid
    s = "tldm_bind_test_" + uuid.uuid4().hex[:8]
    b1, b2 = ShamEmbeddedBackend(s, "sham", separate=False), ShamEmbeddedBackend(s, "sham_v2", separate=False)
    assert b1.key == b2.key == s and b1.computer is b2.computer, "today v1 and v2 share the computer, as the models themselves do"
    assert b1.run("echo v1 > f.txt").ok and "v1" in tools.computer_for(s).execute("computer_read", {"path": "f.txt"}), "one body"
    act = tools.view(s, "activity")["activity"]
    assert act and act[-1]["tool"] == "computer_run" and "echo v1" in act[-1]["arguments"], "the owner's read-only Mini App screen must list the terminal's command"
    # the future split: its own computer of the same class per model, by a switch, no code change
    assert session_key(s, "sham", separate=True) == "sham:" + s and session_key(s, "sham_v2", separate=True) == "sham_v2:" + s
    c1, c2 = ShamEmbeddedBackend(s, "sham", separate=True), ShamEmbeddedBackend(s, "sham_v2", separate=True)
    assert c1.computer is not c2.computer and str(c1.computer.home) != str(c2.computer.home)
    assert type(c1.computer) is type(b1.computer)
    assert c2.run("ls").out == "", "a separated computer starts empty: nothing leaks from the other model"


@test
def hidden_terminal_the_user_sees_only_the_final_reply_and_the_flag_is_off_by_default():
    sys.path.insert(0, os.path.join(os.path.dirname(ROOT), "terminal"))
    from sham_binding import ShamEmbeddedBackend
    import serve_adapter
    assert serve_adapter.enabled() is False, "SHAM_TLDM must be off unless deliberately enabled"
    script = iter(["$ echo 7 > n.txt", "$ cat n.txt", "The number is 7."])
    seen = []
    chat = serve_adapter.TLDMChat(lambda task, hist: (seen.append(list(hist)), next(script))[1], lambda session: ShamEmbeddedBackend("tldm_hidden_" + __import__("uuid").uuid4().hex[:8], "sham", separate=False))
    reply, events = chat.respond("tldm_hidden", "save 7 and read it back")
    assert reply == "The number is 7." and "$" not in reply
    assert [e.out for e in events] == ["", "7"] and seen[2] == [("echo 7 > n.txt", ""), ("cat n.txt", "7")], "the terminal's result must come back to the model"


@test
def owner_policy_2026_11_18_shams_computer_plus_approval_before_a_sensitive_command():
    sys.path.insert(0, os.path.join(os.path.dirname(ROOT), "terminal"))
    from sham_binding import ShamEmbeddedBackend
    import uuid
    b = ShamEmbeddedBackend("tldm_policy_" + uuid.uuid4().hex[:8], "sham", separate=False)
    assert b.policy == "model_computer_approvals", b.policy
    calls = []
    orig = b._exec
    b._exec = lambda c: (calls.append(c), orig(c))[1]
    assert b.run("echo kept > k.txt").ok and b.run("echo $HOME").out.startswith("/"), "the base is the computer as it is"
    r = b.run("rm k.txt")
    assert r.needs_confirmation and not r.ok and "rm k.txt" not in calls, "without the owner's allow it never reaches the computer"
    assert b.run("rm k.txt", confirm=True).ok and calls[-1] == "rm k.txt"


@test
def train_sham2_on_a_tiny_body_saves_only_head_and_adapters_and_refuses_a_real_donor_before_the_gate():
    import json as _json
    import tempfile
    sys.path.insert(0, os.path.join(ROOT, "training"))
    import train_sham2
    d = tempfile.mkdtemp(prefix="sham2_test_")
    out, res = os.path.join(d, "h.pt"), os.path.join(d, "r.json")
    assert train_sham2.main(["--tiny", "--steps", "3", "--out", out, "--json", res]) == 0
    r = _json.load(open(res))
    assert r["donor_weights_unchanged"] and r["trainable"]["new_head"] > 0
    saved = torch.load(out)["head_and_adapters"]
    assert saved and all(k.startswith("core.") or ".adapter_" in k for k in saved), "the output must hold no donor weight"
    gate = os.path.join(d, "gate.json")
    _json.dump({"heldout": {"same_effect": 0.417}, "heldout2": {"same_effect": 0.9}}, open(gate, "w"))
    assert train_sham2.main(["--donor", os.path.join(d, "none.pt"), "--gate", gate, "--out", os.path.join(d, "x.pt")]) == 2, "below the gate: a real donor is refused"
    assert train_sham2.main(["--donor", os.path.join(d, "none.pt"), "--out", os.path.join(d, "x.pt")]) == 2, "no gate file: refused"
    assert not os.path.exists(os.path.join(d, "x.pt"))


@test
def rewordings_never_copy_or_come_close_to_a_held_out_task():
    import rewordings as RW
    rows = RW.generate()
    assert len(rows) > 200 and RW.check(rows) == [], RW.check(rows)[:3]
    assert {c for _, c in rows} <= {c for _, c in T.TRAIN}
    assert all(T.execute(c)[0] for _, c in RW.HELDOUT2), "every held-out-2 reference command runs"


@test
def inference_speed_options_keep_results_bitlinear_cache_bf16_confident_exit_thinker_confidence():
    from sham_tldm.bitlinear import BitLinear
    torch.manual_seed(0)
    lin = BitLinear(16, 8)
    x = torch.randn(3, 16)
    ref = lin(x)                                                    # training path
    lin.eval()
    with torch.inference_mode():
        assert torch.allclose(lin(x), ref, atol=1e-6) and torch.allclose(lin(x), ref, atol=1e-6)    # cached ternary weight = same result
    with torch.no_grad():
        lin.weight.mul_(-1)                                          # a weight update must drop the cache
    with torch.inference_mode():
        assert torch.allclose(lin(x), -ref, atol=1e-5)
    m = Sham1_TLDM(d=32, layers=1, latents=4, think_steps=3, block=8, writer_layers=1, heads=2, in_len=12).eval()
    ids = torch.tensor([encode_bytes("ls", 12)])
    out, info = m.generate(ids, steps=4)
    assert info["writer_passes"] == 4
    out2, info2 = m.generate(ids, steps=4, confident=1e-9)          # everything "confident": one pass fills the block
    assert info2["writer_passes"] == 1 and out2.shape == out.shape
    mb = Sham1_TLDM(d=32, layers=1, latents=4, think_steps=3, block=8, writer_layers=1, heads=2, in_len=12).eval().to(torch.bfloat16)
    assert mb.generate(ids, steps=4)[0].shape == (1, 8), "bf16 inference runs (the reader's scan keeps the dtype)"
    mc = Sham1_TLDM(d=32, layers=1, latents=4, think_steps=20, block=8, writer_layers=1, heads=2, in_len=12, think_exit="confidence", think_min_steps=7).eval()
    with torch.no_grad():
        mc.core.thinker.conf.bias.fill_(10.0)                        # confidence ~1: the book's rule exits at step 7
    assert mc.generate(ids, steps=2, early_exit=True)[1]["latent_steps_used"] == 7
    with torch.no_grad():
        mc.core.thinker.conf.bias.fill_(-10.0)
    assert mc.generate(ids, steps=2, early_exit=True)[1]["latent_steps_used"] == 20


@test
def long_term_file_memory_recall_lessons_and_one_memory_per_model():
    import unittest
    suite = unittest.defaultTestLoader.discover(os.path.join(ROOT, "memory"), pattern="test_memory.py", top_level_dir=os.path.join(ROOT, "memory"))
    res = unittest.TextTestRunner(stream=open(os.devnull, "w"), verbosity=0).run(suite)
    assert res.testsRun >= 8 and res.wasSuccessful(), [str(t) + ": " + e.splitlines()[-1] for t, e in res.failures + res.errors]


if __name__ == "__main__":
    failed = 0
    for f in TESTS:
        try:
            f()
            print("PASS", f.__name__)
        except Exception:
            failed += 1
            print("FAIL", f.__name__)
            traceback.print_exc(limit=3)
    print(f"\n{len(TESTS) - failed}/{len(TESTS)} passed")
    sys.exit(1 if failed else 0)
