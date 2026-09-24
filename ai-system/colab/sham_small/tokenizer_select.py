"""Picks the best pretrained image/audio tokenizer among everything attached
as input — so stage 2 accepts both paths automatically, without conflict:

  * the separate CPU tokenizer tracks' datasets, and
  * any other dataset that also carries an image_tokenizer.pt /
    audio_tokenizer.pt (e.g. a combined video-frames + tokenizers dataset),

and falls back to training a fresh tokenizer only when no usable one exists.

"Usable" = it loads, and its codebook size matches the vocabulary range the
main model reserves for that modality (IMAGE_VOCAB_SIZE / AUDIO_VOCAB_SIZE) —
a tokenizer with a different codebook would silently produce ids outside
that range. Among usable ones the most-trained wins: samples consumed (from
the progress JSON saved next to it, when present), then training step, then
newest file. Every candidate and the reason it was taken/skipped is printed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from model import AUDIO_VOCAB_SIZE, IMAGE_VOCAB_SIZE

_EXPECTED = {"image": IMAGE_VOCAB_SIZE, "audio": AUDIO_VOCAB_SIZE}


def _progress_samples(ckpt: Path, kind: str) -> int:
    for p in (ckpt.parent / f"{kind}_tokenizer_progress.json", ckpt.parent.parent / f"{kind}_tokenizer_progress.json"):
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                return int(data.get("samples_consumed") or data.get("samples") or 0)
            except Exception:
                return 0
    return 0


def select_pretrained_tokenizer(kind: str, search_root: str | Path = "/kaggle/input", loader: Any = None):
    """Returns (tokenizer, step, path) for the best usable candidate, or None."""
    if kind not in _EXPECTED:
        raise ValueError(kind)
    if loader is None:
        if kind == "image":
            from train_image_tokenizer import load_tokenizer_checkpoint as loader
        else:
            from train_audio_tokenizer import load_tokenizer_checkpoint as loader
    root = Path(search_root)
    candidates = sorted(root.rglob(f"{kind}_tokenizer.pt")) if root.exists() else []
    best = None
    for path in candidates:
        try:
            tok, step = loader(str(path))
        except Exception as exc:
            print(f"  ⏭ {path}: تعذّر التحميل ({exc.__class__.__name__}) — تم تجاهله")
            continue
        codes = getattr(tok.cfg, "num_codes", None)
        if codes != _EXPECTED[kind]:
            print(f"  ⏭ {path}: حجم القاموس {codes} لا يطابق {_EXPECTED[kind]} المحجوز في النموذج — تم تجاهله")
            continue
        score = (_progress_samples(path, kind), int(step or 0), path.stat().st_mtime)
        print(f"  • {path}: صالح — عيّنات={score[0]:,} خطوة={score[1]}")
        if best is None or score > best[0]:
            best = (score, tok, int(step or 0), path)
    if best is None:
        return None
    return best[1], best[2], best[3]


if __name__ == "__main__":
    import tempfile

    class Cfg:
        def __init__(self, n):
            self.num_codes = n

    class Tok:
        def __init__(self, n):
            self.cfg = Cfg(n)

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "a").mkdir()
        (root / "b").mkdir()
        (root / "c").mkdir()
        for d in ("a", "b", "c"):
            (root / d / "image_tokenizer.pt").write_text(d)
        (root / "b" / "image_tokenizer_progress.json").write_text(json.dumps({"samples_consumed": 5000}))
        (root / "a" / "image_tokenizer_progress.json").write_text(json.dumps({"samples_consumed": 900}))
        fake = {"a": (Tok(IMAGE_VOCAB_SIZE), 50), "b": (Tok(IMAGE_VOCAB_SIZE), 9), "c": (Tok(1024), 999)}
        loader = lambda p: fake[Path(p).parent.name]
        tok, step, path = select_pretrained_tokenizer("image", root, loader)
        assert path.parent.name == "b" and step == 9, path  # most samples wins; wrong-size "c" skipped
        assert select_pretrained_tokenizer("image", root / "missing", loader) is None
    print("tokenizer_select self-test: OK")
