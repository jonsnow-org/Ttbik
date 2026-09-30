"""
Sham's guarded knowledge merge ("الدمج المحروس") — the missing link the
owner caught: Track A (CPU text), Track B (autonomous web research) and the
GPU text stage each train their OWN copy of Sham's text brain, and until now
only the GPU copy ever reached the model that talks in the bot. Likewise the
chat stage continues its own lineage, so later stage-2 progress on images and
sound never reached it either.

How merging works (no outside model involved — only Sham's own lineages):
  1. Every candidate source is loaded and CHECKED first: same architecture
     (d_model, layers, heads, mlp, vocab) and the IDENTICAL text tokenizer
     (same token -> same id). Anything else is skipped with the reason — a
     weight average across different tokenizers would be silent garbage.
  2. Interpolation toward the source: θ = (1-λ)·θ_main + λ·θ_source, tried at
     a few λ. Only the vocabulary rows the source actually trained are
     touched (a text-only track never touches image/audio/special rows, so
     the main model's media and chat abilities are never diluted).
  3. The gate: each λ is scored on held-out data of EVERY skill (text, chat
     answers, image/audio/video pairs). A λ is accepted only if the total
     improves and no single skill gets worse by more than a hair. Otherwise
     the main weights are restored exactly. The best accepted λ wins.
  4. Each source version is merged at most once (its step is remembered), so
     an old version never pulls the model back again and again.

Data-level merge: Track B's filtered web corpus (research_corpus/*.txt) is
also offered to rehearsal, so its knowledge arrives even when the tokenizer
check fails.
"""

from __future__ import annotations

from pathlib import Path

import torch

from model import AUDIO_VOCAB_SIZE, IMAGE_VOCAB_SIZE, TEXT_VOCAB_SIZE

TEXT_ROWS = [(0, TEXT_VOCAB_SIZE)]
MEDIA_ROWS = [(0, TEXT_VOCAB_SIZE + IMAGE_VOCAB_SIZE + AUDIO_VOCAB_SIZE)]

# (dataset, checkpoint glob, vocabulary rows that source really trained)
KNOWN_SOURCES = [
    ("sham-multimodal-checkpoint", "final_multimodal.pt", MEDIA_ROWS),
    ("sham-checkpoint", "step_*.pt", TEXT_ROWS),
    ("sham-cpu-track-checkpoint-v2", "step_*.pt", TEXT_ROWS),
    ("sham-research-track-checkpoint-v2", "final.pt", TEXT_ROWS),  # Track B saves final.pt
    # The engineer's crawl notebook (Wikipedia + news feeds). It once published its
    # final.pt INTO sham-multimodal-checkpoint; sham_inputs repairs that dataset by
    # moving such files here (FOREIGN_HOME), so it is merged only through the gate.
    ("sham-crawl-checkpoint", "final*.pt", MEDIA_ROWS),
    ("sham-chat-checkpoint-incoming", "final*.pt", MEDIA_ROWS),
]


class _WithDiscovered(list):
    """KNOWN_SOURCES plus, the first time it is iterated, every model dataset
    of the account named sham-crawl-* (any number of collection notebooks,
    each under its own name — found automatically, merged only through the
    repair stage and the gate, each with its own "already merged" record)."""

    _done = False

    def __iter__(self):
        if not self._done:
            self._done = True
            try:
                from sham_inputs import crawl_dataset_names
                have = {n for n, _, _ in list.__iter__(self)}
                new = [n for n in crawl_dataset_names()["models"] if n not in have]
                if new:
                    print("🔎 مصادر جمع مكتشفة تلقائياً: " + ", ".join(new))
                self.extend((n, "final*.pt", MEDIA_ROWS) for n in new)
            except Exception as exc:
                print(f"⚠ تعذّر اكتشاف مصادر الجمع تلقائياً: {exc}")
        return list.__iter__(self)


KNOWN_SOURCES = _WithDiscovered(KNOWN_SOURCES)
_ARCH_KEYS = ("vocab_size", "d_model", "n_layers", "n_heads", "n_kv_heads", "mlp_hidden")


def _step_of(p: Path) -> int:
    try:
        return int(p.stem.split("_")[-1])
    except ValueError:
        return -1


def latest_checkpoint(root: Path, pattern: str) -> Path | None:
    found = sorted(root.rglob(pattern), key=_step_of)
    return found[-1] if found else None


def same_tokenizer(a, b) -> bool:
    return a._tokenizer.get_vocab() == b._tokenizer.get_vocab()


def load_source(root: Path, pattern: str, main_model, main_tokenizer):
    """(model, step) if the source is (or could be repaired to be)
    merge-compatible, else (None, reason). Every source first passes the
    repair stage (sham_repair.py), which prints what it found and fixed."""
    from sham_repair import repair_candidate

    ckpt = latest_checkpoint(root, pattern)
    if ckpt is None:
        return None, "لا توجد نقطة حفظ"
    other, step, report = repair_candidate(ckpt, root, main_model, main_tokenizer)
    print("\n".join(report))
    if other is None:
        return None, report[-1].strip()
    return (other, step), None


def _codebook(path: Path):
    from tokenizer_select import robust_load
    try:
        kind = "image" if path.name.startswith("image") else "audio"
        return robust_load(path, kind)[0].quantizer.codebook.weight.detach()
    except Exception:
        return None


@torch.no_grad()
def _neutralize_foreign_media_rows(root: Path, other, main_model, reference_dir: Path = Path("/kaggle/working")) -> None:
    """Image/audio ids only mean the same thing under the SAME tokenizer. If the
    source was trained with different image/audio tokenizers than the ones the
    main model uses now (reference_dir holds those), its media rows are made
    identical to the main model's, so interpolation leaves them untouched."""
    from model import AUDIO_VOCAB_BASE, IMAGE_VOCAB_BASE
    spans = {"image_tokenizer.pt": (IMAGE_VOCAB_BASE, IMAGE_VOCAB_BASE + IMAGE_VOCAB_SIZE),
             "audio_tokenizer.pt": (AUDIO_VOCAB_BASE, AUDIO_VOCAB_BASE + AUDIO_VOCAB_SIZE)}
    main_params = dict(main_model.named_parameters())
    for fname, (lo, hi) in spans.items():
        mine = reference_dir / fname
        theirs = sorted(Path(root).rglob(fname))
        if not mine.exists():
            continue
        a, b = _codebook(mine), (_codebook(theirs[0]) if theirs else None)
        if a is not None and b is not None and a.shape == b.shape and torch.equal(a, b):
            continue  # same tokenizer: media rows are comparable
        for name, p in other.named_parameters():
            if p.shape[0] == other.cfg.vocab_size and name in main_params:
                p[lo:hi].copy_(main_params[name][lo:hi].to(p.device))


@torch.no_grad()
def _interpolate(model, base: dict, other: dict, lam: float, rows) -> None:
    vocab = model.cfg.vocab_size
    for name, p in model.named_parameters():
        if name not in other:
            continue
        b, o = base[name], other[name].to(p.dtype)
        if p.shape[0] == vocab and p.dim() >= 1:
            p.copy_(b)
            for lo, hi in rows:
                p[lo:hi].copy_((1 - lam) * b[lo:hi] + lam * o[lo:hi].to(p.device))
        else:
            p.copy_((1 - lam) * b + lam * o.to(p.device))


def _passes(score: dict, base: dict, tolerance: float) -> bool:
    if any(score[k] > base[k] * (1 + tolerance) for k in base):
        return False
    return sum(score[k] / base[k] for k in base) < len(base) - 1e-3


def guarded_merge(model, sources, score_fn, ratios=(0.05, 0.15, 0.3, 0.5), tolerance=0.005):
    """sources: [(name, other_model, rows)]. score_fn(model) -> {skill: loss}.
    Mutates model in place (only accepted merges stay). Returns report lines."""
    report = []
    base_score = score_fn(model)
    report.append("قبل الدمج: " + ", ".join(f"{k}={v:.3f}" for k, v in base_score.items()))
    for name, other, rows in sources:
        base = {n: p.detach().clone() for n, p in model.named_parameters()}
        other_sd = dict(other.named_parameters())
        best = None
        for lam in ratios:
            _interpolate(model, base, other_sd, lam, rows)
            s = score_fn(model)
            if _passes(s, base_score, tolerance) and (best is None or sum(s.values()) < sum(best[1].values())):
                best = (lam, s)
        if best is None:
            with torch.no_grad():
                for n, p in model.named_parameters():
                    p.copy_(base[n])
            report.append(f"❌ {name}: لم يُدمج (لم يحسّن كل المهارات معاً)")
        else:
            _interpolate(model, base, other_sd, best[0], rows)
            base_score = best[1]
            report.append(f"✅ {name}: دُمج بنسبة {best[0]:.2f} — " + ", ".join(f"{k}={v:.3f}" for k, v in best[1].items()))
        del base
    return report


@torch.no_grad()
def batches_loss(model, batches, device: str) -> float:
    """Mean loss over held-out batches (tensor = plain text, tuple = (ids, labels))."""
    model.eval()
    total, n = 0.0, 0
    for b in batches:
        ids, labels = b if isinstance(b, tuple) else (b, b)
        _, loss = model(ids.to(device), labels=labels.to(device))[:2]
        total += float(loss)
        n += 1
    model.train()
    return total / max(n, 1)


def research_corpus_files(root: Path | None, crawl: bool = True) -> list[str]:
    """Track B's filtered web documents plus the crawl notebook's texts
    (sham-crawl-corpus, text/**/*.txt) — the data-level merge."""
    files = [str(p) for p in sorted(Path(root).rglob("research_corpus/**/*.txt"))] if root else []
    if crawl:
        try:
            from sham_inputs import crawl_dataset_names, fetch_dataset
            corpora = sorted(set(crawl_dataset_names()["corpora"]) | {"sham-crawl-corpus"})
        except Exception:
            corpora = []
        for name in corpora:
            try:
                crawl_root = fetch_dataset(name)
            except Exception:
                crawl_root = None
            if crawl_root:
                found = [str(p) for p in sorted(Path(crawl_root).rglob("text/**/*.txt"))]
                print(f"  • نصوص الجمع للتذكّر من {name}: {len(found):,}")
                files += found
    return files


if __name__ == "__main__":
    # Offline self-test: a compatible source that is strictly better on the
    # gate gets merged; a harmful one is rejected and weights restored exactly.
    from model import ShamSmall, ShamSmallConfig

    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=64)
    main, good, bad = ShamSmall(cfg), ShamSmall(cfg), ShamSmall(cfg)
    target = {n: p.detach().clone() for n, p in good.named_parameters()}
    dist = lambda m: sum(float((p.detach() - target[n]).pow(2).sum()) for n, p in m.named_parameters())
    score = lambda m: {"skill": dist(m) + 1.0}
    with torch.no_grad():
        for n, p in bad.named_parameters():
            p.copy_(target[n] * -3)  # moving toward it only moves away from the target
    before = {n: p.detach().clone() for n, p in main.named_parameters()}
    rep = guarded_merge(main, [("bad", bad, MEDIA_ROWS)], score)
    assert "❌" in rep[-1] and all(torch.equal(p, before[n]) for n, p in main.named_parameters())
    rep = guarded_merge(main, [("good", good, MEDIA_ROWS)], score)
    assert "✅" in rep[-1] and dist(main) < sum(float((before[n] - target[n]).pow(2).sum()) for n in before)
    # text-only rows: image rows of the embedding stay untouched
    main2 = ShamSmall(cfg)
    img_before = main2.token_embedding.weight[TEXT_VOCAB_SIZE:].clone()
    guarded_merge(main2, [("good-text", good, TEXT_ROWS)], score)
    assert torch.equal(main2.token_embedding.weight[TEXT_VOCAB_SIZE:], img_before)
    # different image tokenizer on the source → its image rows can't move the main model
    import tempfile
    from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
    from model import IMAGE_VOCAB_BASE
    from train_image_tokenizer import save_tokenizer_checkpoint
    with tempfile.TemporaryDirectory() as d:
        ref, src = Path(d, "ref"), Path(d, "src")
        ref.mkdir(), src.mkdir()
        small = lambda: ImageTokenizer(ImageTokenizerConfig(image_size=16, base_channels=8, channel_multipliers=(1, 2), code_dim=8))
        torch.manual_seed(1); save_tokenizer_checkpoint(ref / "image_tokenizer.pt", small(), step=1)
        torch.manual_seed(2); save_tokenizer_checkpoint(src / "image_tokenizer.pt", small(), step=1)
        main3, src3 = ShamSmall(cfg), ShamSmall(cfg)
        _neutralize_foreign_media_rows(src, src3, main3, reference_dir=ref)
        lo = IMAGE_VOCAB_BASE
        assert torch.equal(src3.token_embedding.weight[lo:lo + 10], main3.token_embedding.weight[lo:lo + 10])
        assert not torch.equal(src3.token_embedding.weight[:10], main3.token_embedding.weight[:10])
    print("sham_merge self-test OK")
