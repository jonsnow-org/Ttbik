"""Sham v2's OWN motion-token rows (owner decision 2026-11-25: real video from Sham Pro, CPU only).

Sham v2's media stage trained the image and audio rows of its (tied) embedding, never the 1024 motion rows: with a motion tokenizer alone the model
would sample motion codes from untrained rows (noise motion). scripts/transplant/train_sham_v2_motion_rows.py trains ONLY those rows on real clips in
the exact layout sham_studio_media._video_result generates (the body stays frozen), and publishes them as motion_rows.pt next to the checkpoint.

apply() overlays them at load time, and only when the file was trained for THIS checkpoint (fingerprint of its untouched motion rows) and THIS
motion tokenizer (sha256 of the file): a stale pair is refused and reported, never applied. Nothing else in the model changes."""
from __future__ import annotations

import hashlib
from pathlib import Path

import torch

FILE = "motion_rows.pt"


def _range():
    from model import MOTION_VOCAB_BASE, MOTION_VOCAB_SIZE
    return MOTION_VOCAB_BASE, MOTION_VOCAB_SIZE


def embedding(model) -> torch.Tensor:
    return model.token_embedding.weight


def rows_fingerprint(model) -> str:
    """Hash of the model's current motion rows (identifies the base checkpoint the rows were trained on)."""
    base, n = _range()
    w = embedding(model)[base:base + n].detach().to(torch.float32).cpu().contiguous()
    return hashlib.sha256(w.numpy().tobytes()).hexdigest()[:16]


def file_sha(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def save(path, rows: torch.Tensor, base_fp: str, motion_sha: str, metrics: dict) -> None:
    base, n = _range()
    torch.save({"schema": "sham.motion_rows.v1", "rows": rows.detach().to(torch.bfloat16).cpu(), "base": base, "n": n,
                "base_rows_fp": base_fp, "motion_tokenizer_sha": motion_sha, "metrics": dict(metrics)}, str(path))


def apply(model, ckpt_dir, motion_tokenizer_path) -> dict:
    """Overlay motion_rows.pt onto the model's tied motion rows. -> status dict (motion_rows: 'trained' | 'untrained' | 'refused: ...')."""
    p = Path(ckpt_dir) / FILE
    if not p.is_file():
        return {"motion_rows": "untrained (no motion_rows.pt)"}
    try:
        d = torch.load(str(p), map_location="cpu", weights_only=False)
        base, n = _range()
        w = embedding(model)
        rows = d["rows"]
        if d.get("base") != base or d.get("n") != n or tuple(rows.shape) != (n, w.shape[1]):
            return {"motion_rows": f"refused: shape/range mismatch {tuple(rows.shape)} base={d.get('base')} vs {(n, w.shape[1])} base={base}"}
        if d.get("base_rows_fp") != rows_fingerprint(model):
            return {"motion_rows": "refused: trained for another checkpoint"}
        if motion_tokenizer_path is None or d.get("motion_tokenizer_sha") != file_sha(motion_tokenizer_path):
            return {"motion_rows": "refused: trained for another motion tokenizer"}
        with torch.no_grad():
            w[base:base + n] = rows.to(w.dtype)
        return {"motion_rows": "trained", "motion_rows_metrics": d.get("metrics", {})}
    except Exception as exc:  # noqa: BLE001 - a broken file never stops the server; video then runs on the untrained rows and says so
        return {"motion_rows": f"refused: {type(exc).__name__}: {str(exc)[:120]}"}


def _selftest() -> None:
    import tempfile
    from model import ShamSmall, ShamSmallConfig, TOTAL_VOCAB_SIZE
    torch.manual_seed(0)
    m = ShamSmall(ShamSmallConfig(vocab_size=TOTAL_VOCAB_SIZE, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=64))
    d = Path(tempfile.mkdtemp())
    mt = d / "motion_tokenizer.pt"
    mt.write_bytes(b"tok-a")
    assert apply(m, d, mt)["motion_rows"].startswith("untrained")
    base, n = _range()
    fp = rows_fingerprint(m)
    new = torch.randn(n, 32)
    save(d / FILE, new, fp, file_sha(mt), {"heldout_nll": 1.0})
    other = d / "other.pt"
    other.write_bytes(b"tok-b")
    assert apply(m, d, other)["motion_rows"] == "refused: trained for another motion tokenizer"
    before = embedding(m)[:base].clone()
    r = apply(m, d, mt)
    assert r["motion_rows"] == "trained", r
    assert torch.allclose(embedding(m)[base:base + n], new.to(torch.bfloat16).float(), atol=1e-6)
    assert torch.equal(embedding(m)[:base], before), "rows outside the motion range must not change"
    assert m.lm_head.weight is m.token_embedding.weight or not m.cfg.tie_embeddings
    assert apply(m, d, mt)["motion_rows"] == "refused: trained for another checkpoint"     # applied once: the base fingerprint changed
    print("sham_motion_rows self-test OK")


if __name__ == "__main__":
    _selftest()
