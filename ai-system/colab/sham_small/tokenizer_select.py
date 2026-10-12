"""Picks the best pretrained image/audio tokenizer among everything attached
as input — so stage 2 accepts both paths automatically, without conflict:

  * the separate CPU tokenizer tracks' datasets, and
  * any other dataset that also carries an image_tokenizer.pt /
    audio_tokenizer.pt (e.g. a combined video-frames + tokenizers dataset),

and falls back to training a fresh tokenizer only when nothing can be used
even after repair.

Incompatible candidates are REPAIRED and accepted, not ignored:
  * codebook size ≠ the range the main model reserves for that modality
    (IMAGE_VOCAB_SIZE / AUDIO_VOCAB_SIZE):
      - smaller → the codebook is grown to the exact size; every trained
        code keeps its id and vector and the new slots are placed out of
        reach, so the tokenizer's output is bit-for-bit unchanged;
      - larger → the codebook is compressed to the exact size by k-means over
        the trained code vectors, so every id stays in range and each old
        code maps to its nearest surviving centroid (small, measured loss);
  * checkpoint saved by an older/newer version (extra or missing config
    fields, or no config at all) → the config is rebuilt from the known
    fields / the weights' own shapes and loaded.
Only a file whose weights truly cannot be loaded into the architecture is
reported as unrepairable. Among usable ones the most-trained wins: samples
consumed (progress JSON next to it), then training step, then an unrepaired
one over a repaired one, then newest file. Every decision is printed.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Any

import torch

from model import AUDIO_VOCAB_SIZE, IMAGE_VOCAB_SIZE

_EXPECTED = {"image": IMAGE_VOCAB_SIZE, "audio": AUDIO_VOCAB_SIZE}


def _progress_samples(ckpt: Path, kind: str) -> int:
    for p in (ckpt.parent / f"{kind}_tokenizer_progress.json", ckpt.parent.parent / f"{kind}_tokenizer_progress.json",
              ckpt.parent / f"{kind}_progress.json"):      # the last one is what the Lightning CPU trainer writes
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                return int(data.get("samples_consumed") or data.get("samples") or 0)
            except Exception:
                return 0
    return 0


def _classes(kind: str):
    if kind == "image":
        from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
        return ImageTokenizer, ImageTokenizerConfig
    from audio_tokenizer import AudioTokenizer, AudioTokenizerConfig
    return AudioTokenizer, AudioTokenizerConfig


def robust_load(path: str | Path, kind: str):
    """Loads a tokenizer checkpoint even when it was saved by another version
    of the code. Returns (tokenizer, step, notes)."""
    Tok, Cfg = _classes(kind)
    payload = torch.load(path, map_location="cpu", weights_only=False)
    notes: list[str] = []
    if isinstance(payload, dict) and "state_dict" in payload:
        state, step, raw_cfg = payload["state_dict"], int(payload.get("step") or 0), dict(payload.get("config") or {})
    else:  # a bare state_dict
        state, step, raw_cfg = payload, 0, {}
        notes.append("ملف بلا إعدادات — أُعيد بناؤها من الأوزان")
    known = {f.name for f in dataclasses.fields(Cfg)}
    extra = sorted(set(raw_cfg) - known)
    if extra:
        notes.append(f"حُذفت حقول إعدادات غير معروفة: {', '.join(extra)}")
    cfg_kwargs = {k: (tuple(v) if isinstance(v, list) else v) for k, v in raw_cfg.items() if k in known}
    cb = state.get("quantizer.codebook.weight")
    if cb is not None:  # the weights are the truth for the codebook's shape
        cfg_kwargs["num_codes"], cfg_kwargs["code_dim"] = int(cb.shape[0]), int(cb.shape[1])
    tok = Tok(Cfg(**cfg_kwargs))
    tok.load_state_dict(state)  # strict: a real architecture mismatch must fail loudly
    return tok, step, notes


def fit_codebook(tok, target: int) -> str | None:
    """Resizes tok's codebook to exactly `target` codes in place. Returns a
    description of the repair, or None when nothing was needed."""
    q = tok.quantizer
    old = q.codebook.weight.detach().clone()
    n, dim = old.shape
    if n == target:
        return None
    g = torch.Generator().manual_seed(0)
    if n < target:
        # New slots sit far outside the trained codes' region, so the frozen
        # tokenizer keeps producing exactly the same ids it was trained to
        # produce; the slots stay reserved inside the model's range.
        extra = target - n
        far = old.norm(dim=1).max().clamp_min(1.0) * 1e3
        dirs = torch.randn(extra, dim, generator=g)
        new = torch.cat([old, dirs / dirs.norm(dim=1, keepdim=True) * far], dim=0)
        how = f"توسيع القاموس {n}→{target} (نفس الرموز ونفس النتائج تماماً)"
    else:
        cent = old[torch.randperm(n, generator=g)[:target]].clone()
        for _ in range(25):  # k-means over the trained code vectors
            assign = torch.cdist(old, cent).argmin(dim=1)
            sums = torch.zeros_like(cent).index_add_(0, assign, old)
            counts = torch.bincount(assign, minlength=target).unsqueeze(1)
            cent = torch.where(counts > 0, sums / counts.clamp_min(1), cent)
        err = torch.cdist(old, cent).min(dim=1).values.mean() / old.norm(dim=1).mean().clamp_min(1e-8)
        new = cent
        how = f"ضغط القاموس {n}→{target} بـ k-means (خطأ نسبي متوسط {err.item():.1%})"
    q.codebook = torch.nn.Embedding(target, dim)
    q.codebook.weight.data.copy_(new)
    q.num_codes = target
    tok.cfg.num_codes = target
    return how


_PROBE: dict = {}


def default_measure(kind: str, n: int = 24, seed: int = 20261012):
    """A measuring function (tokenizer → reconstruction error, lower is better) on ONE fixed sample of fresh factory items, the same for every
    candidate; None when the factory cannot be reached (offline). Quality decides between tokenizers, not how long one trained (owner, 2026-10-12:
    never replace one with another unless it measures better). The sample is random factory items, so a candidate that happened to train on exactly
    these items would be favoured slightly; with hundreds of thousands of items that overlap is small and the same for everybody."""
    try:
        if kind not in _PROBE:
            import tempfile
            from sham_media_shards import with_factory
            _PROBE[kind] = with_factory(kind, None, tempfile.mkdtemp(prefix="tokprobe_"), k=1, limit=n * 2, seed=seed)
        manifest = _PROBE[kind]
        if not manifest:
            return None
        from sham_vq_train import ManifestAudio, ManifestImages, _forward

        def measure(tok) -> float | None:
            ds = ManifestImages(manifest, tok.cfg.image_size) if kind == "image" else ManifestAudio(manifest, tok.cfg.n_mels, tok.cfg.segment_frames)
            items = [ds[i] for i in range(min(n, len(ds)))]
            if not items:
                return None
            tok.train(False)
            with torch.no_grad():
                return float(_forward(tok, torch.stack(items), None)[1])
        return measure
    except Exception as exc:
        print(f"  ⚠ تعذّر تجهيز عيّنة القياس ({exc.__class__.__name__}) — المفاضلة بعدد العيّنات المتدربة")
        return None


def select_pretrained_tokenizer(kind: str, search_root: str | Path | None = None, loader: Any = None, measure: Any = "auto"):
    """Returns (tokenizer, step, path) for the best candidate — repairing
    incompatible ones — or None when nothing at all could be loaded.

    Ranking: a healthy codebook first, then MEASURED reconstruction error on a shared sample (when one is available; `measure` may be a function
    tokenizer→error, None to skip, or "auto" to build the default factory sample), then samples trained, then step."""
    if measure == "auto":
        measure = default_measure(kind) if search_root is None else None
    if kind not in _EXPECTED:
        raise ValueError(kind)
    if loader is None:
        loader = lambda p: robust_load(p, kind)
    if search_root is None:  # /kaggle/input + datasets fetched by sham_inputs.fetch_dataset
        from sham_inputs import fetch_all_tokenizer_datasets, rglob_inputs
        fetch_all_tokenizer_datasets()          # every tokenizer output of the account competes, whatever notebook or machine made it
        candidates = sorted(rglob_inputs(f"{kind}_tokenizer.pt"))
    else:
        root = Path(search_root)
        candidates = sorted(root.rglob(f"{kind}_tokenizer.pt")) if root.exists() else []
    best = None
    for path in candidates:
        try:
            loaded = loader(str(path))
        except Exception as exc:
            print(f"  ✖ {path}: أوزانه لا تطابق معمارية شام ولا يمكن إصلاحه ({exc.__class__.__name__}: {str(exc)[:120]})")
            continue
        tok, step = loaded[0], loaded[1]
        notes = list(loaded[2]) if len(loaded) > 2 else []
        try:
            fixed = fit_codebook(tok, _EXPECTED[kind]) if hasattr(tok, "quantizer") else None
        except Exception as exc:
            print(f"  ✖ {path}: فشل إصلاح القاموس ({exc.__class__.__name__})")
            continue
        if fixed:
            notes.append(fixed)
        if getattr(tok.cfg, "num_codes", None) != _EXPECTED[kind]:
            print(f"  ✖ {path}: حجم القاموس {getattr(tok.cfg, 'num_codes', None)} ولا يمكن مطابقته")
            continue
        repaired = bool(notes)
        from sham_vq import live_codes
        live = live_codes(tok)
        healthy = live >= 0.05 * _EXPECTED[kind]
        # A collapsed codebook (a handful of live codes) always ranks below a healthy one,
        # however long it trained: it can only ever produce the same flat texture.
        err = None
        if measure is not None and healthy:
            try:
                err = measure(tok)
            except Exception as exc:
                print(f"  ⚠ تعذّر قياس {path.parent.name}: {exc.__class__.__name__}")
        # with a measurement: lower error ranks higher (an unmeasurable candidate ranks below every measured one); without: the old order
        quality = (-err if err is not None else -1e9) if measure is not None else 0.0
        score = (1 if healthy else 0, quality, _progress_samples(path, kind), int(step or 0), 0 if repaired else 1, path.stat().st_mtime)
        tag = "🔧 أُصلح وقُبل — " + "؛ ".join(notes) if repaired else "صالح"
        state = (f"رموز حيّة {live:,}/{_EXPECTED[kind]:,}" + ("" if healthy else " ⚠ قاموس منهار")
                 + (f" | خطأ إعادة البناء المقيس {err:.4f}" if err is not None else ""))
        print(f"  • {path}: {tag} — عيّنات={score[2]:,} خطوة={score[3]} — {state}")
        if best is None or score > best[0]:
            best = (score, tok, int(step or 0), path)
    if best is not None and best[0][0] == 0 and search_root is not None:
        # The model's own saved tokenizer has collapsed: switch to a healthy
        # (revived) one from the tokenizer tracks if one is available. Its codes
        # mean different things, so the model relearns image/audio tokens from here
        # — worth it, since the collapsed vocabulary can't express any real picture.
        from sham_inputs import fetch_dataset
        from sham_vq import is_collapsed
        # Stage 2's own copy first (what the multimodal brain actually learned
        # with — the chat stage and the bot must speak the same codes), then the
        # tokenizer tracks.
        mm = fetch_dataset("sham-multimodal-checkpoint")
        fetch_dataset(f"sham-{kind}-tokenizer-checkpoint")
        tried = []
        if mm and Path(mm).resolve() != Path(search_root).resolve():
            tried.append(select_pretrained_tokenizer(kind, mm, loader, measure))
        tried.append(select_pretrained_tokenizer(kind, None, loader, measure))
        for other in tried:
            if other is not None and not is_collapsed(other[0]):
                print(f"  ⇄ أداة {kind} المحفوظة مع النموذج منهارة — التبديل إلى الأداة المُحياة: {other[2]}")
                return other
    if best is None:
        return None
    return best[1], best[2], best[3]


if __name__ == "__main__":
    import tempfile

    from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
    from train_image_tokenizer import save_tokenizer_checkpoint

    def small(n):
        return ImageTokenizer(ImageTokenizerConfig(image_size=16, base_channels=8, channel_multipliers=(1, 2), code_dim=8, num_codes=n))

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        for d in ("a", "b", "c", "d", "e"):
            (root / d).mkdir()
        # a: exact size, little training | b: smaller codebook, most trained
        # c: larger codebook | d: old version (extra config field) | e: garbage
        torch.manual_seed(0)
        save_tokenizer_checkpoint(root / "a/image_tokenizer.pt", small(IMAGE_VOCAB_SIZE), step=5)
        tb = small(1024)
        save_tokenizer_checkpoint(root / "b/image_tokenizer.pt", tb, step=40)
        (root / "b/image_tokenizer_progress.json").write_text(json.dumps({"samples_consumed": 5000}))
        save_tokenizer_checkpoint(root / "c/image_tokenizer.pt", small(IMAGE_VOCAB_SIZE + 500), step=7)
        td_ = small(IMAGE_VOCAB_SIZE)
        payload = {"config": {**td_.cfg.__dict__, "legacy_flag": True}, "step": 3, "state_dict": td_.state_dict()}
        torch.save(payload, root / "d/image_tokenizer.pt")
        (root / "e/image_tokenizer.pt").write_bytes(b"not a checkpoint")

        tok, step, path = select_pretrained_tokenizer("image", root)
        assert path.parent.name == "b" and step == 40, path  # most trained wins, after repair
        assert tok.cfg.num_codes == IMAGE_VOCAB_SIZE == tok.quantizer.codebook.weight.shape[0]
        # growth keeps every trained code identical -> same ids for any input
        x = torch.rand(2, 3, 16, 16) * 2 - 1
        assert torch.equal(tok.encode(x), tb.encode(x))
        assert int(tok.encode(x).max()) < IMAGE_VOCAB_SIZE

        tc, _, _ = robust_load(root / "c/image_tokenizer.pt", "image")
        fit_codebook(tc, IMAGE_VOCAB_SIZE)
        assert tc.cfg.num_codes == IMAGE_VOCAB_SIZE and int(tc.encode(x).max()) < IMAGE_VOCAB_SIZE
        _, _, notes = robust_load(root / "d/image_tokenizer.pt", "image")
        assert notes and "legacy_flag" in notes[0]
        assert select_pretrained_tokenizer("image", root / "missing") is None
        # measured quality beats "trained longest": the candidate with the least training wins when it reconstructs best
        # (every toy tokenizer is declared healthy here so the comparison is about the measurement alone)
        import sham_vq
        _live = sham_vq.live_codes
        sham_vq.live_codes = lambda t: IMAGE_VOCAB_SIZE

        def fake_measure(t):
            return {5: 0.05, 40: 0.30, 7: 0.20, 3: 0.40}.get(int(getattr(t, "_step", -1)), 0.5)

        def tagged_loader(pth):
            loaded = robust_load(pth, "image")
            loaded[0]._step = loaded[1]
            return loaded
        tok3, step3, path3 = select_pretrained_tokenizer("image", root, loader=tagged_loader, measure=fake_measure)
        assert path3.parent.name == "a" and step3 == 5, (path3, step3)
        tok4, step4, path4 = select_pretrained_tokenizer("image", root, loader=tagged_loader, measure=None)
        assert path4.parent.name == "b" and step4 == 40, (path4, step4)       # no measurement: the old order (most trained) still applies
        sham_vq.live_codes = _live
    print("tokenizer_select self-test: OK")
