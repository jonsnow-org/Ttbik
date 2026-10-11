"""
Growing Sham past 108M — depth first, with the function PRESERVED, plus a longer context (owner, 2026-10-11: "increase the size a little and the
memory"). Nothing already learned is thrown away:

  grow_checkpoint(ckpt, out, target_params, target_ctx, tokenizer_dir)
    1. depth growth: new transformer layers whose output projections start at zero, so the grown model computes EXACTLY what the old one did
       (expand_model.grow_model, verified here by a numeric comparison on the loaded model, not assumed)
    2. longer context: NTK-aware RoPE (sham_longctx.extend_context_ntk) — the position table reaches target_ctx, the new theta is saved in the
       checkpoint's config, so it reloads with the same positions. Short-context outputs move only slightly (measured and printed).
  The tokenizers (text/image/audio) are copied next to the grown checkpoint untouched.

Training then fills the new layers and the long positions (sham_longctx_train.py + the live trainers, which pick the grown checkpoint when it
measures at least as good: sham_base_select prefers it within 5%).

  python sham_grow.py <dataset-name> [target_params_millions] [target_ctx]     # uses Kaggle (GitHub workflow sham-grow.yml)
Offline self-test: python sham_grow.py
"""
from __future__ import annotations

import math
import shutil
import sys
from dataclasses import replace
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))


def layer_params(cfg) -> int:
    hd = cfg.d_model // cfg.n_heads
    attn = cfg.d_model * (cfg.n_heads * hd) * 2 + cfg.d_model * (cfg.n_kv_heads * hd) * 2
    return attn + 3 * cfg.d_model * cfg.mlp_hidden + 2 * cfg.d_model


def layers_to_add(cfg, current_params: int, target_params: int) -> int:
    return max(0, math.ceil((target_params - current_params) / layer_params(cfg)))


def grow_model_depth_and_context(model, add_layers: int, target_ctx: int, loss_fn=None, max_loss_rise: float = 0.03):
    """(grown model, report). Depth-only growth is exact. The context is extended in steps (x2, x4, ... up to target_ctx) and each step is kept
    only while the loss on a fixed real text (loss_fn(model) -> float) rises by at most max_loss_rise: NTK scaling is free in weights but
    not free in quality — the real model moved far more than a toy one (2026-10-11), so the extension is measured, never assumed."""
    from expand_model import grow_model
    from sham_longctx import extend_context_ntk
    model.train(False)
    x = torch.randint(0, min(model.cfg.vocab_size, 32000), (1, min(64, model.cfg.max_seq_len)))
    with torch.no_grad():
        ref = model(x)[0]
    base_loss = loss_fn(model) if loss_fn else None
    grown = grow_model(model, replace(model.cfg, n_layers=model.cfg.n_layers + add_layers))
    grown.train(False)
    with torch.no_grad():
        deep = grown(x)[0]
    exact = float((ref - deep).abs().max())
    deep_loss = loss_fn(grown) if loss_fn else None
    steps = []
    start_len, start_theta = grown.cfg.max_seq_len, grown.cfg.rope_theta
    ctx = start_len
    while ctx * 2 <= target_ctx:
        ctx *= 2
        saved = (grown.cfg.max_seq_len, grown.cfg.rope_theta)
        extend_context_ntk(grown, ctx)
        loss = loss_fn(grown) if loss_fn else None
        rise = (loss / deep_loss - 1) if loss is not None else 0.0
        steps.append((ctx, None if loss is None else round(loss, 3), round(rise, 4)))
        if loss is not None and rise > max_loss_rise:           # this step costs too much quality: undo it and stop
            grown.cfg.rope_theta = saved[1]
            grown.resize_max_seq_len(saved[0])
            steps[-1] = steps[-1] + ("رُفضت",)
            break
    with torch.no_grad():
        ext = grown(x)[0]
    report = {"layers": f"{model.cfg.n_layers}→{grown.cfg.n_layers}", "depth_max_logit_diff": exact,
              "loss_base": None if base_loss is None else round(base_loss, 3), "loss_depth_grown": None if deep_loss is None else round(deep_loss, 3),
              "ctx": f"{start_len}→{grown.cfg.max_seq_len}", "ctx_steps": steps, "ntk_max_logit_diff": float((ref - ext).abs().max()),
              "theta": f"{start_theta:.0f}→{grown.cfg.rope_theta:.0f}", "params_m": round(grown.count_parameters() / 1e6, 1)}
    return grown, report


def grow_checkpoint(ckpt: Path, out: Path, target_params: int, target_ctx: int, tokenizer_dir: Path | None = None, loss_fn=None) -> dict:
    from checkpoint import load_checkpoint, save_checkpoint
    model, step, _ = load_checkpoint(ckpt, map_location="cpu")
    cur = model.count_parameters()
    add = layers_to_add(model.cfg, cur, target_params)
    grown, rep = grow_model_depth_and_context(model, add, target_ctx, loss_fn=loss_fn)
    assert rep["depth_max_logit_diff"] < 1e-3, f"depth growth must preserve the function: {rep}"
    out.parent.mkdir(parents=True, exist_ok=True)
    save_checkpoint(out, grown, step)
    if tokenizer_dir:
        for f in ("sham_small_tokenizer.json", "image_tokenizer.pt", "audio_tokenizer.pt"):
            for src in Path(tokenizer_dir).rglob(f):
                shutil.copy2(src, out.parent / f)
                break
    rep["step"] = step
    rep["params_before_m"] = round(cur / 1e6, 1)
    return rep


def main(argv: list[str]) -> int:
    """auto <target_params_millions> <target_ctx>: the measured-best main-line checkpoint, grown, published as sham-grown-checkpoint."""
    from sham_base_select import choose_base, make_probe
    from sham_inputs import fetch_dataset, publish_dataset

    target = int(float(argv[1] if len(argv) > 1 else 160) * 1e6)
    ctx = int(argv[2]) if len(argv) > 2 else 8192
    names = (("sham-multimodal-checkpoint", "final_multimodal.pt"), ("sham-crawl-checkpoint", "final.pt"), ("sham-chat-checkpoint", "final_chat.pt"))
    cands, roots = [], {}
    for name, pat in names:
        root = fetch_dataset(name)
        hits = sorted(root.rglob(pat)) if root else []
        toks = sorted(root.rglob("sham_small_tokenizer.json")) if root else []
        if hits and toks:
            cands.append((name, hits[0], toks[0]))
            roots[name] = hits[0].parent
    best, scores = choose_base(cands, make_probe("cpu"))
    ckpt = next(c[1] for c in cands if c[0] == best)
    out = Path("/tmp/sham_grown/upload/final_grown.pt")
    from sham_base_select import text_loss
    from text_tokenizer import ShamTextTokenizer
    tok = ShamTextTokenizer.load(str(next(c[2] for c in cands if c[0] == best)))
    probe = make_probe("cpu")
    rep = grow_checkpoint(ckpt, out, target, ctx, roots[best], loss_fn=lambda m: text_loss(m, tok, probe.text, "cpu"))
    print("🌱 " + str(rep))
    slug = publish_dataset(out.parent, "sham-grown-checkpoint", f"grown from {best}: {rep['layers']} layers, ctx {rep['ctx']}, {rep['params_m']}M")
    print("نُشر:", slug)
    return 0 if slug else 1


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "auto":
        sys.exit(main(sys.argv[1:]))
    import tempfile

    from checkpoint import load_checkpoint, save_checkpoint
    from model import ShamSmall, ShamSmallConfig

    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=300, d_model=64, n_layers=3, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=128)
    base = ShamSmall(cfg)
    cur = base.count_parameters()
    assert layers_to_add(cfg, cur, cur) == 0 and layers_to_add(cfg, cur, cur + 2 * layer_params(cfg)) == 2
    assert abs(layer_params(cfg) - (base.count_parameters() - base.token_embedding.weight.numel() - cfg.d_model) / cfg.n_layers) < 5
    with tempfile.TemporaryDirectory() as d:
        a = Path(d, "a.pt")
        save_checkpoint(a, base, 7)
        (Path(d) / "sham_small_tokenizer.json").write_text("{}")
        rep = grow_checkpoint(a, Path(d, "grown", "final_grown.pt"), cur + 3 * layer_params(cfg), 1024, Path(d))
        again, step, _ = load_checkpoint(Path(d, "grown", "final_grown.pt"), map_location="cpu")
        assert step == 7 and again.cfg.n_layers == 6 and again.cfg.max_seq_len == 1024 and again.cfg.rope_theta > 10000.0
        assert Path(d, "grown", "sham_small_tokenizer.json").exists()
        x = torch.randint(0, 300, (1, 64))
        with torch.no_grad():
            base.train(False)
            again.train(False)
            diff = float((base(x)[0] - again(x)[0]).abs().max())
        assert rep["depth_max_logit_diff"] < 1e-5 and diff < 1.0, (rep, diff)
        # the grown model still trains: loss goes down with the new layers in play
        opt = torch.optim.AdamW(again.parameters(), lr=3e-3)
        pat = (torch.arange(64) % 5 + 3).unsqueeze(0)
        again.train(True)
        first = float(again(pat, labels=pat)[1])
        for _ in range(60):
            loss = again(pat, labels=pat)[1]
            opt.zero_grad()
            loss.backward()
            opt.step()
        assert float(loss) < first * 0.5
        new_layer_moved = float(again.layers[-1].attention.o_proj.weight.abs().max()) > 0
        assert new_layer_moved, "the new layers must learn (their zero-initialised output projections must move)"
    # the context steps are measured: a loss that rises more than 3% at 512 stops the ladder at 256 (and the rejected step is undone)
    m2 = ShamSmall(cfg)
    fake = {"calls": 0}
    def loss_fn(m):
        fake["calls"] += 1
        return 3.0 if m.cfg.max_seq_len <= 256 else 3.5          # base, depth-grown, x2 (256) fine; x4 (512) is +17%
    g2, rep2 = grow_model_depth_and_context(m2, 1, 1024, loss_fn=loss_fn)
    assert g2.cfg.max_seq_len == 256 and g2.cfg.rope_theta < 20000 and rep2["ctx_steps"][-1][-1] == "رُفضت", rep2
    print("sham_grow self-test OK |", rep, "| ladder:", rep2["ctx_steps"])
