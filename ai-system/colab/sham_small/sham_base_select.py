"""
Which checkpoint should a stage start from? By MEASUREMENT, never by name or habit (2026-10-11).

Found by auditing every checkpoint on one fixed text with its own tokenizer: the chat stage's output (step 45,584, the old tokenizer) sits at
chance level — loss 10.7 = ln(vocabulary) — while the multimodal checkpoint (61,555) and the live trainer's (54,729) write fluent Arabic. Every
stage still resumed from "its own previous output" or from "chat, else multimodal", so a broken lineage was extended for weeks.

  make_probe(device) -> probe(ckpt, tokenizer_json) -> mean next-token loss on one fixed text sample, with that checkpoint's OWN tokenizer
  choose_base(candidates, probe, keep=None) -> (name, {name: loss})
        candidates: [(name, ckpt_path, tokenizer_json_or_None)]; the lowest loss wins, except that `keep` (the lineage already in use) stays
        unless another candidate is better by more than 5% (hysteresis: no flip-flopping on noise)
  CHANCE_FRACTION: a model whose loss is above 0.9 * ln(vocab) is reported as untrained, whatever it is called

Offline self-test: python sham_base_select.py
"""
from __future__ import annotations

import math
from pathlib import Path

import torch

HYSTERESIS = 1.05
CHANCE_FRACTION = 0.9


def make_probe(device: str = "cpu", work: str | Path = "/tmp/sham_probe", documents: int = 60, text: str | None = None):
    from checkpoint import load_checkpoint
    from text_tokenizer import ShamTextTokenizer

    if text is None:
        import sham_text_mix
        files = sham_text_mix.stream_mix(str(Path(work) / "probe_text"), max_documents=documents, seed=4242, documents_per_file=documents)
        text = "\n".join(Path(f).read_text(encoding="utf-8") for f in files if f.endswith(".txt"))

    def probe(ckpt: Path, tok_json: Path) -> float:
        model, _step, _ = load_checkpoint(ckpt, map_location=device)
        tok = ShamTextTokenizer.load(str(tok_json))
        loss = text_loss(model, tok, text, device)
        probe.last_chance = math.log(model.cfg.vocab_size)
        del model
        return loss
    probe.last_chance = None
    probe.text = text
    probe.device = device
    return probe


def text_loss(model, tok, text: str, device: str = "cpu", windows: int = 16, length: int = 256) -> float:
    """Mean next-token loss of `model` on the first `windows` windows of `text` (a fixed sample: comparable across calls and models)."""
    ids = tok.encode(text)
    L = min(length, model.cfg.max_seq_len)
    wins = [ids[i:i + L] for i in range(0, len(ids) - L + 1, L)][:windows]
    was = model.training
    model.train(False)
    total = 0.0
    with torch.no_grad():
        for w in wins:
            x = torch.tensor([w], device=device)
            total += float(model(x, labels=x)[1])
    model.train(was)
    return total / max(len(wins), 1)


def choose_base(candidates, probe, keep: str | None = None, log=print, prefer: tuple[str, ...] = (), hysteresis: float = HYSTERESIS):
    scores: dict[str, float] = {}
    for name, ckpt, tok in candidates:
        if tok is None:
            continue
        try:
            scores[name] = probe(Path(ckpt), Path(tok))
        except Exception as exc:
            log(f"⚠ تعذّر قياس {name}: {type(exc).__name__}: {str(exc)[:100]}")
    if not scores:
        return (candidates[0][0] if candidates else None), {}
    best = min(scores, key=scores.get)
    if keep in scores and scores[keep] <= scores[best] * hysteresis:
        best = keep
    for name in prefer:                      # e.g. the grown checkpoint: more capacity, same function — wins any near-tie
        if name in scores and scores[name] <= scores[best] * HYSTERESIS:
            best = name
            break
    chance = getattr(probe, "last_chance", None)
    note = ""
    if chance and scores[best] > CHANCE_FRACTION * chance:
        note = f" ⚠ حتى الأفضل بمستوى التخمين العشوائي ({chance:.1f}): لا نقطة سليمة"
    log("🎯 اختيار نقطة الانطلاق بالقياس: " + " | ".join(f"{k}={v:.2f}" for k, v in sorted(scores.items(), key=lambda kv: kv[1])) + f" ⇒ {best}" + note)
    return best, scores


if __name__ == "__main__":
    import tempfile

    from checkpoint import save_checkpoint
    from model import ShamSmall, ShamSmallConfig
    from text_tokenizer import ShamTextTokenizer

    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=400, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=64)
    with tempfile.TemporaryDirectory() as d:
        # two checkpoints: `good` has learned a repeating pattern, `bad` is untouched random weights
        good, bad = ShamSmall(cfg), ShamSmall(cfg)
        opt = torch.optim.AdamW(good.parameters(), lr=3e-3)
        pattern = (torch.arange(64) % 7 + 5).unsqueeze(0)
        for _ in range(200):
            loss = good(pattern, labels=pattern)[1]
            opt.zero_grad()
            loss.backward()
            opt.step()
        paths = {}
        for name, m in (("good", good), ("bad", bad)):
            save_checkpoint(Path(d) / f"{name}.pt", m, 1)
            paths[name] = Path(d) / f"{name}.pt"
        # a stand-in tokenizer whose encode() maps text to the same repeating pattern
        class FakeTok:
            vocab_size = 400
            def encode(self, text): return (torch.arange(len(text)) % 7 + 5).tolist()
        import sham_base_select as me
        import text_tokenizer as tt
        tt.ShamTextTokenizer.load = staticmethod(lambda p: FakeTok())
        probe = make_probe("cpu", text="x" * 2000)
        best, scores = choose_base([("bad", paths["bad"], Path(d) / "t.json"), ("good", paths["good"], Path(d) / "t.json")], probe)
        assert best == "good" and scores["good"] < scores["bad"] * 0.5, scores
        # hysteresis: the lineage in use stays while it is within 5% of the best
        best2, _ = choose_base([("bad", paths["bad"], Path(d) / "t.json"), ("good", paths["good"], Path(d) / "t.json")], probe, keep="bad")
        assert best2 == "good", "a clearly worse kept lineage must be dropped"
        best4, _ = choose_base([("good", paths["good"], Path(d) / "t.json"), ("grown", paths["good"], Path(d) / "t.json")], probe, keep="good", prefer=("grown",))
        assert best4 == "grown", "a preferred (grown) checkpoint wins a near-tie"
        best3, _ = choose_base([("good", paths["good"], Path(d) / "t.json"), ("good2", paths["good"], Path(d) / "t.json")], probe, keep="good2")
        assert best3 == "good2", "a lineage within 5% of the best is kept"
    print("sham_base_select self-test OK")
