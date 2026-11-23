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
    assert c.vocab_size == c.motion_base + c.motion_codes
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
    for _ in range(400):
        opt.zero_grad()
        loss, _ = joint_loss(m, seq.repeat(4, 1), tldm_weight=1.0, cycle_dropout=False)
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
    assert check_tool('read_file {"path": "src/a.py"}') == check_tool('read_file {"path": "src/a.py"}') and check_tool('read_file {"path": "src/a.py"}').allowed
    assert not check_tool('read_file {"path": "src/a.py"}').needs_approval
    assert check_tool('write_file {"path": "a.txt", "content": "x"}').needs_approval
    assert not check_tool('delete_everything {}').allowed
    assert not check_tool('read_file {"path": "../etc/passwd"}').allowed
    assert not check_tool('read_file {"path": 5}').allowed
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
