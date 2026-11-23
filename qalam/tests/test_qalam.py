import copy

import pytest
import torch

from qalam import Qalam
from qalam.agent import check_command, check_tool
from qalam.checkpoint import load_checkpoint, save_checkpoint
from qalam.config import ModelConfig, SPECIAL_NAMES, base_config, tiny_config
from qalam.training import joint_loss, train_steps

ONECORE_PARAMS = 57_579_201


@pytest.fixture()
def tiny() -> Qalam:
    torch.manual_seed(0)
    return Qalam(tiny_config()).double().eval()


def test_base_is_larger_than_onecore_and_in_budget():
    with torch.device("meta"):
        m = Qalam(base_config())
    n = m.count_parameters()
    assert n > 2 * ONECORE_PARAMS and 120_000_000 <= n <= 170_000_000, n
    assert m.active_parameters_per_token() < n                       # sparse experts: less compute than stored capacity


def test_vocabulary_layout_is_one_id_space():
    c = tiny_config()
    assert len(SPECIAL_NAMES) == 64 and len(set(SPECIAL_NAMES)) == 64
    assert c.modality_of(0) == "text" and c.modality_of(c.special_id("MASK")) == "special"
    assert c.modality_of(c.image_base) == "image" and c.modality_of(c.audio_base) == "audio" and c.modality_of(c.motion_base) == "motion"
    assert c.vocab_size == c.tool_base + c.tool_codes and c.modality_of(c.tool_base) == "tool"
    with pytest.raises(ValueError):
        c.modality_of(c.vocab_size)
    with pytest.raises(ValueError):
        ModelConfig(width=64, heads=5)


def test_forward_shapes_and_aux(tiny):
    ids = torch.randint(0, 200, (2, 12))
    logits, aux = tiny(ids)
    assert logits.shape == (2, 12, tiny.cfg.vocab_size) and torch.isfinite(logits).all() and float(aux.detach()) > 0
    with pytest.raises(ValueError):
        tiny(torch.tensor([[tiny.cfg.vocab_size]]))


def test_causality(tiny):
    a = torch.randint(0, 200, (1, 10))
    b = a.clone()
    b[0, 7] = (b[0, 7] + 1) % 200
    la, _ = tiny(a)
    lb, _ = tiny(b)
    assert torch.allclose(la[:, :7], lb[:, :7], atol=1e-10) and not torch.allclose(la[:, 7:], lb[:, 7:])


def test_cache_matches_full_forward(tiny):
    ids = torch.randint(0, 200, (1, 14))
    full, _ = tiny.forward_causal(ids)
    h1, cache = tiny.forward_causal(ids[:, :9])
    h2, cache = tiny.forward_causal(ids[:, 9:], cache)            # a multi-token chunk after a cache
    assert torch.allclose(torch.cat([h1, h2], dim=1), full, atol=1e-9)
    h3, _ = tiny.forward_causal(ids[:, 12:13], tiny.forward_causal(ids[:, :12])[1])   # one token after a cache
    assert torch.allclose(h3[:, 0], full[:, 12], atol=1e-9)


def test_fewer_cycles_is_a_valid_shallower_model(tiny):
    ids = torch.randint(0, 200, (1, 8))
    l1, _ = tiny(ids, cycles=1)
    l2, _ = tiny(ids, cycles=2)
    assert l1.shape == l2.shape and not torch.allclose(l1, l2)
    with pytest.raises(ValueError):
        tiny(ids, cycles=3)


def test_tldm_loss_trains_every_native_part():
    torch.manual_seed(1)
    m = Qalam(tiny_config()).train()
    ids = torch.randint(0, 200, (2, 40))
    loss = m.tldm_loss(ids, block=8)
    assert torch.isfinite(loss)
    loss.backward()
    for name, p in (("compressor", m.compressor.q.weight), ("reader", m.reader.o.weight), ("latent_queries", m.latent_queries),
                    ("embed", m.embed.weight), ("expert", m.blocks[0].moe.experts[0].up.weight)):
        assert p.grad is not None and float(p.grad.abs().sum()) > 0, name


def test_generate_tldm_fills_block_with_allowed_ids_only(tiny):
    prefix = torch.randint(0, 200, (1, 6))
    allowed = list(range(10, 20))
    a = tiny.generate_tldm(prefix, block=7, steps=3, allowed=allowed)
    b = tiny.generate_tldm(prefix, block=7, steps=3, allowed=allowed)
    assert a.shape == (1, 7) and set(a.flatten().tolist()) <= set(allowed) and torch.equal(a, b)
    with pytest.raises(ValueError):
        tiny.generate_tldm(prefix, allowed=[tiny.cfg.special_id("MASK")])


def greedy_reference(m: Qalam, prefix: torch.Tensor, n: int, allowed: list[int]) -> list[int]:
    keep = torch.full((m.cfg.vocab_size,), float("-inf"), dtype=torch.float64)
    keep[allowed] = 0.0
    ids = prefix.clone()
    out = []
    for _ in range(n):
        logits, _ = m(ids)
        t = int((logits[0, -1] + keep).argmax())
        out.append(t)
        ids = torch.cat([ids, torch.tensor([[t]])], dim=1)
    return out


@pytest.mark.parametrize("block,steps", [(4, 1), (6, 2), (3, 3)])
def test_speculative_decoding_equals_greedy(tiny, block, steps):
    prefix = torch.randint(0, 200, (1, 5))
    allowed = tiny.cfg.text_and_end_ids()
    want = greedy_reference(tiny, prefix, 17, allowed)
    got, info = tiny.generate_speculative(prefix, 17, block=block, steps=steps)
    assert got[0].tolist() == want and info["tokens"] == 17


def test_speculative_never_costs_more_passes_than_tokens(tiny):
    got, info = tiny.generate_speculative(torch.randint(0, 200, (1, 5)), 12, block=4, steps=2)
    assert info["passes"] <= 1 + info["tokens"] and got.shape == (1, 12)


def test_speculative_decoding_is_much_faster_when_the_writer_is_right():
    torch.manual_seed(3)
    m = Qalam(tiny_config()).train()
    seq = torch.tensor([[7, 8, 9, 10] * 8 + [7, 8]])                          # a repeating pattern the model can learn completely
    opt = torch.optim.AdamW(m.parameters(), lr=3e-3)
    for _ in range(400):                                                       # the writer needs a high loss weight early (see TRAINING_NOTEBOOKS.md): 3.0 here
        opt.zero_grad()
        loss, _ = joint_loss(m, seq.repeat(4, 1), tldm_weight=3.0, cycle_dropout=False)
        loss.backward()
        opt.step()
    m.double().eval()
    prompt = torch.tensor([[7, 8, 9, 10, 7, 8, 9, 10]])
    got, info = m.generate_speculative(prompt, 16, block=8, steps=3)
    assert got[0].tolist() == greedy_reference(m, prompt, 16, m.cfg.text_and_end_ids())      # exactly greedy
    assert info["passes"] <= 8 and info["accepted_draft_tokens"] >= 8                       # 16 tokens in at most half the causal passes


def test_training_reduces_loss():
    torch.manual_seed(2)
    m = Qalam(tiny_config())
    data = torch.randint(0, 40, (8, 33))
    first = joint_loss(m, data, cycle_dropout=False)[0].item()
    log = train_steps(m, iter([data] * 60), 60, lr=3e-3)
    assert log[-1]["causal"] < log[0]["causal"] and log[-1]["loss"] < first


def test_agent_rules():
    assert check_tool('computer_read {"path": "src/a.py"}', {"computer"}).allowed
    assert not check_tool('computer_read {"path": "src/a.py"}', {"computer"}).needs_approval
    assert check_tool('computer_write {"path": "a.txt", "content": "x"}', {"computer"}).needs_approval
    assert not check_tool('delete_everything {}').allowed
    assert not check_tool('computer_read {"path": "../etc/passwd"}', {"computer"}).allowed
    assert not check_tool('computer_read {"path": 5}', {"computer"}).allowed
    assert check_command("ls -la src").allowed and not check_command("ls -la src").needs_approval
    assert check_command("git status").needs_approval
    for bad in ("rm -rf /", "cat a | sh", "echo $(id)", "curl http://x", "ls; ls", "cat ../x", "sudo ls", "", "ls\nls"):
        assert not check_command(bad).allowed, bad


def test_checkpoint_roundtrip_lineage_and_tamper(tmp_path):
    torch.manual_seed(4)
    m = Qalam(tiny_config())
    sha = save_checkpoint(tmp_path / "a.pt", m, 5)
    sha2 = save_checkpoint(tmp_path / "b.pt", m, 6, parent_sha=sha, meta={"note": "x"})
    m2, side = load_checkpoint(tmp_path / "b.pt")
    assert side["parent_sha256"] == sha and side["step"] == 6 and sha2 != sha and side["meta"] == {"note": "x"}
    ids = torch.randint(0, 200, (1, 6))
    m.eval(), m2.eval()
    assert torch.allclose(m(ids)[0], m2(ids)[0])
    with open(tmp_path / "a.pt", "ab") as f:
        f.write(b"x")
    with pytest.raises(ValueError):
        load_checkpoint(tmp_path / "a.pt")


def test_independence_no_imports_from_other_models():
    import pathlib
    import re
    bad = re.compile(r"^\s*(from|import)\s+(sham|nova|onecore|sham_tldm|ai_system)\b", re.M | re.I)
    for f in pathlib.Path(__file__).resolve().parents[1].joinpath("src").rglob("*.py"):
        assert not bad.search(f.read_text(encoding="utf-8")), f


def test_int8_copy_stays_close_and_does_not_touch_the_original():
    from qalam.quant import quantize_int8
    torch.manual_seed(5)
    m = Qalam(tiny_config()).eval()
    before = m.blocks[0].moe.experts[0].up.weight.clone()
    q = quantize_int8(m)
    ids = torch.randint(0, 200, (1, 24))
    a, _ = m(ids)
    b = q.lm_head(q.forward_causal(ids)[0])
    cos = torch.nn.functional.cosine_similarity(a.flatten(), b.flatten(), dim=0)
    assert float(cos) > 0.97 and torch.equal(before, m.blocks[0].moe.experts[0].up.weight)
    h, cache = q.forward_causal(ids[:, :10])
    assert q.forward_causal(ids[:, 10:11], cache)[0].shape == (1, 1, q.cfg.width)        # the single-token decode path works quantised too


# ----------------------------------------------------------------------------------------------- media: no fixed sizes
from qalam import media


@pytest.mark.parametrize("h,w", [(1, 1), (3, 17), (23, 5), (9, 9)])
def test_image_of_any_size_round_trips(h, w):
    cfg = tiny_config()
    codes = torch.randint(0, cfg.image_codes, (h, w))
    lay = media.image_layout(cfg, codes)
    assert len(lay) == h * (w + 1) + 2 and lay.grid.shape == (len(lay), 3)
    assert torch.equal(media.parse_image(cfg, lay.ids), codes)
    assert lay.grid[1].tolist() == [0, 0, 0] and lay.grid[-2].tolist() == [h - 1, w, 0]


@pytest.mark.parametrize("f,h,w", [(1, 2, 2), (5, 3, 4), (30, 1, 6)])
def test_video_of_any_length_and_continuation_window(f, h, w):
    cfg = tiny_config()
    codes = torch.randint(0, cfg.image_codes, (f, h, w))
    lay = media.video_layout(cfg, codes, time_offset=7)
    assert torch.equal(media.parse_video(cfg, lay.ids), codes)
    assert int(lay.grid[:, 2].max()) == 7 + f and int(lay.grid[:, 2].min()) == 7        # time axis is positional, frames carry their own index


@pytest.mark.parametrize("f,k", [(1, 1), (10, 4), (50, 8)])
def test_audio_delay_pattern_round_trips_any_duration(f, k):
    cfg = tiny_config()
    codes = torch.randint(0, cfg.audio_codes, (f, k))
    assert torch.equal(media.undelay_codes(media.delay_codes(codes, -1), f), codes)
    lay = media.audio_layout(cfg, codes)
    assert len(lay) == (f + k - 1) * k + 2 and torch.equal(media.parse_audio(cfg, lay.ids, k, f), codes)


def test_media_rejects_bad_input():
    cfg = tiny_config()
    with pytest.raises(ValueError):
        media.image_layout(cfg, torch.full((2, 2), cfg.image_codes))
    with pytest.raises(ValueError):
        media.parse_image(cfg, torch.tensor([cfg.special_id("IMG_BEGIN"), cfg.image_base, cfg.special_id("IMG_END")]))


def test_grid_positions_are_felt_by_the_model(tiny):
    cfg = tiny.cfg
    codes = torch.randint(0, cfg.image_codes, (3, 4))
    lay = media.image_layout(cfg, codes)
    a, _ = tiny.forward_causal(lay.ids[None], grid=lay.grid)
    shifted = lay.grid.clone()
    shifted[:, 0] += 5
    assert torch.allclose(a, tiny.forward_causal(lay.ids[None], grid=shifted)[0], atol=1e-9)      # rotary is relative: moving the whole picture changes nothing
    moved = lay.grid.clone()
    moved[7:, 0] += 5
    b, _ = tiny.forward_causal(lay.ids[None], grid=moved)
    assert not torch.allclose(a, b)                                         # but changing the geometry between tokens changes the result
    c, cache = tiny.forward_causal(lay.ids[None, :7], grid=lay.grid[:7])
    d, _ = tiny.forward_causal(lay.ids[None, 7:], cache, grid=lay.grid[7:])
    assert torch.allclose(torch.cat([c, d], dim=1), a, atol=1e-9)           # cache + grid stays exact
    with pytest.raises(ValueError):
        tiny.forward_causal(lay.ids[None], grid=torch.full_like(lay.grid, 999))


@pytest.mark.parametrize("rows,cols", [(1, 1), (4, 9), (13, 3)])
def test_parallel_image_generation_of_any_size(tiny, rows, cols):
    cfg = tiny.cfg
    prefix = torch.randint(0, 200, (1, 5))
    a = media.generate_image_codes(tiny, prefix, rows, cols, steps=3)
    b = media.generate_image_codes(tiny, prefix, rows, cols, steps=3)
    assert a.shape == (rows, cols) and int(a.min()) >= 0 and int(a.max()) < cfg.image_codes and torch.equal(a, b)
    with pytest.raises(ValueError):
        media.generate_image_codes(tiny, prefix, cfg.max_grid + 1, 2)


# ----------------------------------------------------------------------------------------------- the agent loop
def _scripted(cfg, script):
    """A fake generator that returns the next scripted reply (as ids) - the loop is tested without a trained model."""
    it = iter(script)
    enc = lambda s: [ord(c) % cfg.text_vocab for c in s]   # noqa: E731
    dec = lambda ids: "".join(chr(i) for i in ids if i < cfg.text_vocab)   # noqa: E731
    return (lambda stream, n: next(it)), dec, enc


def test_agent_loop_runs_allowed_commands_and_feeds_results_back():
    from qalam.agent import run_agent
    cfg = tiny_config()
    sp = cfg.special_id
    ids = lambda s: [ord(c) for c in s]   # noqa: E731
    gen, dec, enc = _scripted(cfg, [
        [sp("THINK_BEGIN")] + ids("look") + [sp("THINK_END"), sp("CMD_BEGIN")] + ids("ls src") + [sp("CMD_END")],
        ids("done") + [sp("EOS")],
    ])
    seen = []
    steps, stream = run_agent(cfg, gen, dec, enc, ids("task"), lambda k, t: (seen.append((k, t)) or (True, "a.py")), lambda k, t: False)
    assert [s.kind for s in steps] == ["command", "answer"] and seen == [("command", "ls src")] and steps[1].text == "done"
    assert sp("RESULT_BEGIN") in stream and sp("OK") in stream


def test_agent_loop_refuses_declines_and_stops_on_budget():
    from qalam.agent import run_agent
    cfg = tiny_config()
    sp = cfg.special_id
    ids = lambda s: [ord(c) for c in s]   # noqa: E731
    cmd = lambda s: [sp("CMD_BEGIN")] + ids(s) + [sp("CMD_END")]   # noqa: E731
    ran = []
    gen, dec, enc = _scripted(cfg, [cmd("rm -rf /"), cmd("git status"), cmd("ls"), cmd("ls"), cmd("ls")])
    steps, stream = run_agent(cfg, gen, dec, enc, ids("t"), lambda k, t: (ran.append(t) or (True, "ok")), lambda k, t: False, max_steps=5)
    kinds = [s.kind for s in steps]
    assert kinds[:2] == ["refused", "declined"] and "command" in kinds and kinds[-1] == "budget"
    assert "rm -rf /" not in ran and "git status" not in ran                      # neither was ever executed
    assert sp("FAIL") in stream


def test_agent_loop_cuts_overlong_thinking():
    from qalam.agent import run_agent
    cfg = tiny_config()
    sp = cfg.special_id
    long_think = [sp("THINK_BEGIN")] + [65] * 500 + [sp("THINK_END")] + [66, sp("EOS")]
    seen = {}
    gen, dec, enc = _scripted(cfg, [long_think])
    steps, stream = run_agent(cfg, gen, dec, enc, [1], lambda k, t: (True, ""), lambda k, t: True, think_budget=20)
    assert steps[0].kind == "answer" and len(stream) < 40


# ----------------------------------------------------------------------------------------------- the advanced tool system
from qalam import tools


def test_registry_is_complete_stable_and_fits_the_vocabulary():
    assert len(tools.REGISTRY) >= 85 and len(set(tools.ORDER)) == len(tools.ORDER)
    for cfg in (base_config(), tiny_config()):
        assert len(tools.ORDER) <= cfg.tool_codes
    cfg = base_config()
    for i, n in enumerate(tools.ORDER):
        assert tools.tool_name(cfg, tools.tool_id(cfg, n)) == n and cfg.modality_of(tools.tool_id(cfg, n)) == "tool"
    assert tools.tool_name(cfg, 3) is None
    assert {"github", "computer", "worker", "web", "media", "memory", "schedule", "connectors", "core"} <= set(tools.GROUPS)
    for must in ("computer_run", "computer_repo", "computer_publish", "computer_batch", "github_create_pr", "deep_research", "generate_image", "generate_video",
                 "generate_audio", "mcp_call", "browser", "desktop", "delegate", "request_secret", "load_tools"):
        assert must in tools.REGISTRY, must


def test_lazy_groups_keep_the_context_short():
    core = tools.visible_tools()
    assert "load_tools" in core and "github_read_file" not in core and len(core) < 12
    assert "github_read_file" in tools.visible_tools({"github"}) and "computer_run" not in tools.visible_tools({"github"})
    v = tools.validate("github_read_file", {"repo": "a/b", "path": "x"})
    assert not v.ok and "load_tools" in v.reason                                  # a call to a group that is not loaded is refused
    assert tools.validate("github_read_file", {"repo": "a/b", "path": "x"}, {"github"}).ok


def test_risk_tiers_and_approvals():
    g = {"github", "computer", "web", "memory"}
    assert not tools.validate("github_read_file", {"repo": "a/b", "path": "x"}, g).needs_approval
    assert tools.validate("github_create_pr", {"repo": "a/b", "branch": "x", "title": "t"}, g).needs_approval
    v = tools.validate("github_delete_branch", {"repo": "a/b", "branch": "x"}, g)
    assert v.ok and v.needs_approval and v.needs_confirmation                    # destructive = approval AND a typed confirmation
    assert tools.validate("http_request", {"method": "GET", "url": "https://example.com"}, g).needs_approval is False
    assert tools.validate("http_request", {"method": "POST", "url": "https://example.com"}, g).needs_approval
    assert tools.validate("request_secret", {"name": "k", "reason": "r"}).risk == "secret"
    assert tools.validate("computer_job", {"action": "log", "id": "1"}, g).risk == "read"


def test_arguments_are_checked_strictly():
    g = {"github", "computer", "web", "media"}
    bad = [("github_read_file", {"repo": "a/b"}), ("computer_read", {"path": "/etc/passwd"}), ("computer_read", {"path": "a/../../b"}),
           ("computer_read", {"path": "a", "lines": "5"}), ("computer_read", {"path": "a", "extra": 1}), ("computer_job", {"action": "format"}),
           ("fetch_page", {"url": "http://localhost:8080/x"}), ("fetch_page", {"url": "http://169.254.169.254/latest"}), ("fetch_page", {"url": "ftp://x"}),
           ("fetch_page", {"url": "http://10.0.0.5/"}), ("computer_read", {"path": "x" * 30000}), ("generate_image", {"prompt": "p", "rows": True})]
    for name, args in bad:
        assert not tools.validate(name, args, g).ok, (name, args)
    assert tools.validate("fetch_page", {"url": "https://example.com/a"}, g).ok
    assert tools.validate("generate_image", {"prompt": "p", "rows": 300, "columns": 17}, g).ok       # any size is expressible


def test_batch_rules():
    g = {"computer"}
    steps = [{"tool": "computer_read", "args": {"path": "a"}}, {"tool": "computer_search", "args": {"pattern": "x"}}]
    assert tools.validate("computer_batch", {"steps": steps}, g).ok
    assert not tools.validate("computer_batch", {"steps": steps}, g).needs_approval
    w = steps + [{"tool": "computer_write", "args": {"path": "a", "content": "b"}}]
    assert tools.validate("computer_batch", {"steps": w}, g).needs_approval               # the strictest step decides
    assert not tools.validate("computer_batch", {"steps": steps * 5}, g).ok                # more than 8 steps
    assert not tools.validate("computer_batch", {"steps": [{"tool": "computer_batch", "args": {"steps": steps}}]}, g).ok      # no nesting
    assert not tools.validate("computer_batch", {"steps": [{"tool": "github_read_file", "args": {}}]}, g).ok                    # not batchable
    assert not tools.validate("computer_batch", {"steps": [{"tool": "computer_read", "args": {}}]}, g).ok                       # a bad step fails the batch


def test_long_results_keep_head_and_tail():
    text = "A" * 5000 + "ERROR at the end"
    shaped = tools.shape_result(text, 200)
    assert len(shaped) < 300 and shaped.startswith("A") and shaped.endswith("ERROR at the end") and "characters cut" in shaped
    assert tools.shape_result("short", 200) == "short"


def test_native_tool_tokens_and_lazy_loading_in_the_agent_loop():
    from qalam.agent import run_agent
    cfg = tiny_config()
    sp = cfg.special_id
    ids = lambda s: [ord(c) for c in s]   # noqa: E731
    call = lambda name, js: [sp("TOOL_BEGIN"), tools.tool_id(cfg, name)] + ids(js) + [sp("TOOL_END")]   # noqa: E731
    gen, dec, enc = _scripted(cfg, [
        call("github_read_file", '{"repo": "a/b", "path": "x"}'),             # not loaded yet -> refused
        call("load_tools", '{"group": "github"}'),                              # handled by the loop
        call("github_read_file", '{"repo": "a/b", "path": "x"}'),             # now allowed, runs
        call("github_delete_branch", '{"repo": "a/b", "branch": "x"}'),        # destructive: approved but not confirmed -> declined
        ids("ok") + [sp("EOS")],
    ])
    ran = []
    steps, stream = run_agent(cfg, gen, dec, enc, ids("t"), lambda k, t: (ran.append(t) or (True, "content")), lambda k, t: True, max_steps=8)
    assert [s.kind for s in steps] == ["refused", "tool", "tool", "declined", "answer"]
    assert "load_tools" in steps[0].result
    assert ran == ['github_read_file {"repo": "a/b", "path": "x"}']          # only the loaded, allowed read ran; the delete never did
    steps2, _ = run_agent(cfg, _scripted(cfg, [call("github_delete_branch", '{"repo": "a/b", "branch": "x"}'), ids("k") + [sp("EOS")]])[0], dec, enc, ids("t"),
                          lambda k, t: (True, "gone"), lambda k, t: True, confirm=lambda k, t: True, loaded={"github"})
    assert [s.kind for s in steps2] == ["tool", "answer"] and steps2[0].result == "gone"      # with the typed confirmation it runs


# ----------------------------------------------------------------------------------------------- the pre-training freeze
def test_packed_documents_do_not_see_each_other(tiny):
    torch.manual_seed(7)
    a = torch.randint(0, 200, (1, 6))
    b = torch.randint(0, 200, (1, 5))
    other = torch.randint(0, 200, (1, 6))
    seg = torch.tensor([[0] * 6 + [1] * 5])
    packed, _ = tiny(torch.cat([a, b], dim=1), segments=seg)
    alone, _ = tiny(b)
    assert torch.allclose(packed[:, 6:], alone, atol=1e-9)                      # document b, packed after a, equals b alone
    changed, _ = tiny(torch.cat([other, b], dim=1), segments=seg)
    assert torch.allclose(packed[:, 6:], changed[:, 6:], atol=1e-9)             # and does not depend on the document before it
    with pytest.raises(ValueError):
        tiny.forward_causal(a, tiny.forward_causal(a)[1], segments=seg[:, :6])


def test_loss_mask_trains_only_where_asked():
    torch.manual_seed(8)
    m = Qalam(tiny_config()).eval()
    ids = torch.randint(0, 200, (2, 20))
    full = joint_loss(m, ids, tldm_weight=0, cycle_dropout=False)[1]["causal"]
    mask = torch.zeros(2, 20)
    mask[:, 10:] = 1
    part = joint_loss(m, ids, tldm_weight=0, cycle_dropout=False, loss_mask=mask)[1]["causal"]
    assert full != part and part > 0
    one = torch.ones(2, 20)
    assert abs(joint_loss(m, ids, tldm_weight=0, cycle_dropout=False, loss_mask=one)[1]["causal"] - full) < 1e-6


def test_freeze_contract_vocabulary_codecs_and_init():
    c = base_config()
    assert c.text_vocab >= 256 and c.audio_samples_per_frame == 960 and c.image_patch == 16 and c.audio_books == 4
    assert c.max_seq >= 2048 and c.rope_theta >= 100000 and c.shared_hidden > 0
    with pytest.raises(ValueError):
        ModelConfig(text_vocab=100)
    with pytest.raises(ValueError):
        ModelConfig(audio_sample_rate=24000, audio_frame_rate=7)
    torch.manual_seed(9)
    m = Qalam(tiny_config())
    k = 1.0 / (2 * m.cfg.unique_blocks * m.cfg.cycles) ** 0.5
    assert float(m.blocks[0].attn.o.weight.std()) < 0.02 * k * 1.5               # residual outputs start small
    with torch.device("meta"):
        n = Qalam(c).count_parameters()
    assert 120_000_000 <= n <= 170_000_000, n


def test_the_frozen_architecture_has_not_changed():
    from qalam.config import FROZEN_HASH, config_hash, small_config
    assert config_hash(base_config()) == FROZEN_HASH["base"], "base architecture changed: this means retraining everything"
    assert config_hash(small_config()) == FROZEN_HASH["small"], "small architecture changed: this means retraining everything"
    assert config_hash(base_config()) != config_hash(small_config())
