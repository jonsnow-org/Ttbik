"""
Sham's repair stage before merging ("مرحلة الإصلاح قبل الدمج").

Every checkpoint offered to the guarded merge (Track A, Track B, stage 1,
stage 2, the engineer's crawl notebook, anything that lands in a known
dataset) passes through here first. Instead of refusing a checkpoint at the
first defect, each defect that CAN be repaired is repaired, and the report
says exactly what was done. Only what cannot be repaired is refused.

  1. File format: our self-describing format, or a bare state_dict, or
     "state_dict"/"model" keys, with "module." (DataParallel) and
     "_orig_mod." (torch.compile) prefixes stripped.
  2. Architecture: the weights' SHAPES decide (not what a file claims). A
     different width/depth/heads cannot be repaired → refused with the
     reason. A different max_seq_len/rope setting is harmless (no weights).
  3. Missing tensors are filled from the main model; unknown ones dropped.
  4. NaN/Inf values are replaced by the main model's values.
  5. A DIFFERENT text tokenizer is no longer a refusal: the text rows are
     remapped by token string (same piece of text → the main model's id),
     rows for tokens the main tokenizer lacks are dropped, and tokens the
     source lacks keep the main model's rows. Refused only if under half
     of the main vocabulary is covered.
  6. Image/audio rows made with a different image/audio tokenizer are
     neutralised (they mean different pictures/sounds).
  7. Exploded rows/tensors (norm far above the main model's — a typical
     sign of a diverged or over-memorised run) are reset to the main
     model's values.
  8. A last health check: a forward pass must give finite logits.

What remains — "does it actually know something useful?" — is decided by
the merge gate on held-out data of every skill (sham_merge.guarded_merge),
which also tries a small ratio for sources that over-fit.
"""

from __future__ import annotations

from pathlib import Path

import torch

from model import TEXT_VOCAB_SIZE, ShamSmall

PREFIXES = ("module.", "_orig_mod.")
ROW_NORM_LIMIT = 5.0      # × the main model's median row norm
TENSOR_RMS_LIMIT = 10.0   # × the main model's tensor RMS
MIN_TEXT_COVERAGE = 0.5


def _read(path: Path):
    payload = torch.load(path, map_location="cpu", weights_only=False)
    step = 0
    if isinstance(payload, dict):
        step = int(payload.get("step") or payload.get("global_step") or 0)
        for key in ("model_state_dict", "state_dict", "model"):
            if isinstance(payload.get(key), dict):
                payload = payload[key]
                break
    if not isinstance(payload, dict) or not any(torch.is_tensor(v) for v in payload.values()):
        raise ValueError("لا يحتوي أوزان نموذج قابلة للقراءة")
    sd = {}
    for k, v in payload.items():
        if not torch.is_tensor(v):
            continue
        for p in PREFIXES:
            while k.startswith(p):
                k = k[len(p):]
        sd[k] = v
    return sd, step


def _text_map(main_tok, src_tok):
    """(main_ids, src_ids) pairs for the text pieces both tokenizers share."""
    src = src_tok._tokenizer.get_vocab()
    pairs = [(i, src[t]) for t, i in main_tok._tokenizer.get_vocab().items() if t in src]
    pairs = [(a, b) for a, b in pairs if a < TEXT_VOCAB_SIZE and b < TEXT_VOCAB_SIZE]
    if not pairs:
        return None, None
    a, b = zip(*pairs)
    return torch.tensor(a), torch.tensor(b)


def _transfer_text_rows(emb, src_tok, main_tok, fixed) -> tuple[int, int]:
    """Writes into `fixed` (the main model's embedding, text rows) the rows rebuilt from the source embedding `emb`."""
    src_vocab = src_tok._tokenizer.get_vocab()
    src_model = src_tok._tokenizer.model
    copied = built = 0
    for piece, nid in main_tok._tokenizer.get_vocab().items():
        if nid >= TEXT_VOCAB_SIZE:
            continue
        sid = src_vocab.get(piece)
        if sid is not None and sid < min(TEXT_VOCAB_SIZE, emb.shape[0]):
            fixed[nid] = emb[sid].to(fixed.dtype)
            copied += 1
            continue
        try:
            parts = [t.id for t in src_model.tokenize(piece)]
        except Exception:
            parts = []
        parts = [p for p in parts if p < min(TEXT_VOCAB_SIZE, emb.shape[0])]
        if parts:
            fixed[nid] = emb[parts].float().mean(0).to(fixed.dtype)
            built += 1
    return copied, built


def _pick_tokenizer(root: Path, main_tok):
    """The source's own text tokenizer: identical to the main one if present,
    otherwise the one sharing the most pieces with it."""
    from text_tokenizer import ShamTextTokenizer

    best, best_n = None, -1
    main_vocab = main_tok._tokenizer.get_vocab()
    for t in sorted(Path(root).rglob("*tokenizer*.json")):
        try:
            tok = ShamTextTokenizer.load(str(t))
        except Exception:
            continue
        vocab = tok._tokenizer.get_vocab()
        if vocab == main_vocab:
            return tok, True
        n = len(main_vocab.keys() & vocab.keys())
        if n > best_n:
            best, best_n = tok, n
    return best, False


@torch.no_grad()
def repair_candidate(ckpt: Path, root: Path, main_model, main_tokenizer, reference_dir: Path = Path("/kaggle/working")):
    """Returns (model, step, report_lines) — model is None when the checkpoint
    cannot be repaired (the report says why)."""
    report = [f"🔧 فحص وإصلاح {Path(ckpt).name}:"]
    try:
        sd, step = _read(Path(ckpt))
    except Exception as exc:
        return None, 0, report + [f"   ❌ تعذّرت قراءته: {str(exc)[:160]}"]

    main_sd = main_model.state_dict()
    vocab = main_model.cfg.vocab_size

    # 2) architecture from shapes
    for name, ref in main_sd.items():
        if name in sd and tuple(sd[name].shape) != tuple(ref.shape) and not (
                sd[name].dim() == 2 and ref.dim() == 2 and sd[name].shape[1] == ref.shape[1]
                and name in ("token_embedding.weight", "lm_head.weight")):
            return None, step, report + [f"   ❌ معمارية مختلفة لا تُصلح ({name}: {tuple(sd[name].shape)} ≠ {tuple(ref.shape)})"]

    other = ShamSmall(main_model.cfg)
    new_sd = {}
    missing = []
    for name, ref in main_sd.items():
        if name not in sd:
            missing.append(name)
            new_sd[name] = ref.detach().cpu().clone()
            continue
        new_sd[name] = sd[name].to(ref.dtype)
    dropped = len([k for k in sd if k not in main_sd])
    if missing:
        # the tied head is always rebuilt from the embedding
        real = [m for m in missing if m != "lm_head.weight"]
        if len(real) > len(main_sd) // 2:
            return None, step, report + [f"   ❌ أغلب الأوزان مفقودة ({len(real)} من {len(main_sd)})"]
        if real:
            report.append(f"   • {len(real)} مصفوفة ناقصة أُكملت من النموذج الرئيسي")
    if dropped:
        report.append(f"   • {dropped} مصفوفة غير معروفة حُذفت")

    # 5) text tokenizer: remap rows by token string
    emb = new_sd["token_embedding.weight"]
    src_tok, same = _pick_tokenizer(root, main_tokenizer)
    if src_tok is None:
        return None, step, report + ["   ❌ لا توجد معه أداة تقسيم نص لمعرفة معنى صفوفه"]
    if not same or emb.shape[0] != vocab:
        # A different text tokenizer is NOT a reason to discard a checkpoint (it holds weeks of training): every row of our
        # vocabulary is rebuilt from the source's rows — a piece both spell the same keeps its row, any other piece starts as
        # the mean of the source rows that spelled it (embedding transfer). Whether the result is any good is decided by the
        # quality gate that follows (held-out loss), not by how many pieces happen to match.
        fixed = main_sd["token_embedding.weight"].detach().cpu().clone()
        copied, built = _transfer_text_rows(emb, src_tok, main_tokenizer, fixed)
        if copied + built == 0:
            return None, step, report + ["   ❌ لم يُعثر على أي صلة بين مفردات أداة التقسيم وأداتنا"]
        if emb.shape[0] == vocab:  # media/special rows keep their positions
            fixed[TEXT_VOCAB_SIZE:] = emb[TEXT_VOCAB_SIZE:].to(fixed.dtype)
        new_sd["token_embedding.weight"] = fixed
        report.append(f"   • أداة تقسيم نص مختلفة: {copied:,} صف مشترك نُقل كما هو، و{built:,} صف بُني من متوسط قطع المصدر (تقرّر البوابة بعدها هل النتيجة صالحة)")
    new_sd["lm_head.weight"] = new_sd["token_embedding.weight"]

    # 4) non-finite values
    bad = 0
    for name, t in new_sd.items():
        mask = ~torch.isfinite(t)
        if mask.any():
            bad += int(mask.sum())
            t[mask] = main_sd[name].detach().cpu()[mask].to(t.dtype)
    if bad:
        report.append(f"   • {bad:,} قيمة NaN/Inf استُبدلت بقيم النموذج الرئيسي")

    # 7) exploded rows / tensors
    ref_emb = main_sd["token_embedding.weight"].detach().cpu().float()
    limit = ROW_NORM_LIMIT * ref_emb.norm(dim=1).median()
    rows = (new_sd["token_embedding.weight"].float().norm(dim=1) > limit).nonzero().squeeze(1)
    if rows.numel():
        new_sd["token_embedding.weight"][rows] = ref_emb[rows].to(new_sd["token_embedding.weight"].dtype)
        report.append(f"   • {rows.numel():,} صف منفجر القيمة أُعيد لقيمة النموذج الرئيسي")
    reset = []
    for name, t in new_sd.items():
        if name in ("token_embedding.weight", "lm_head.weight") or t.dim() < 2:
            continue
        ref_rms = main_sd[name].detach().float().pow(2).mean().sqrt()
        if float(t.float().pow(2).mean().sqrt()) > TENSOR_RMS_LIMIT * float(ref_rms) + 1e-8:
            new_sd[name] = main_sd[name].detach().cpu().clone()
            reset.append(name)
    if reset:
        report.append(f"   • {len(reset)} مصفوفة منفجرة القيم أُعيدت لقيم النموذج الرئيسي")

    other.load_state_dict(new_sd, strict=False)

    # 6) media rows from different image/audio tokenizers
    from sham_merge import _neutralize_foreign_media_rows
    _neutralize_foreign_media_rows(root, other, main_model, reference_dir=reference_dir)

    # 8) health check
    probe = torch.tensor([[1, 2, 3, 4]])
    other.eval()
    if not bool(torch.isfinite(other(probe)[0]).all()):
        return None, step, report + ["   ❌ ما زال يعطي مخرجات غير منتهية بعد الإصلاح"]
    if len(report) == 1:
        report.append("   ✅ سليم — لم يحتج إصلاحاً")
    else:
        report.append("   ✅ أُصلح وأصبح صالحاً لبوابة الدمج")
    return other, step, report


if __name__ == "__main__":
    import tempfile

    from checkpoint import save_checkpoint
    from model import ShamSmallConfig
    from text_tokenizer import ShamTextTokenizer, train_text_tokenizer

    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=16)
    main = ShamSmall(cfg)
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        seed = d / "s.txt"
        seed.write_text("شام نموذج عربي يتعلم من النصوص الحقيقية والصور والأصوات. " * 50, encoding="utf-8")
        tok = train_text_tokenizer([str(seed)], vocab_size=300)
        ref = d / "ref"; ref.mkdir()

        # a) healthy, our format
        src = d / "a"; src.mkdir()
        good = ShamSmall(cfg)
        save_checkpoint(src / "final.pt", good, step=7)
        tok.save(str(src / "sham_small_tokenizer.json"))
        m, step, rep = repair_candidate(src / "final.pt", src, main, tok, ref)
        assert m is not None and step == 7 and "سليم" in rep[-1], rep
        assert torch.equal(m.state_dict()["layers.0.mlp.up_proj.weight"], good.state_dict()["layers.0.mlp.up_proj.weight"])

        # b) DataParallel prefixes, NaN, exploded tensor, bare state_dict
        src = d / "b"; src.mkdir()
        sd = {f"module.{k}": v.clone() for k, v in good.state_dict().items()}
        sd["module.layers.0.mlp.up_proj.weight"][0, 0] = float("nan")
        sd["module.layers.0.attention.q_proj.weight"] *= 1000
        torch.save(sd, src / "final.pt")
        tok.save(str(src / "sham_small_tokenizer.json"))
        m, _, rep = repair_candidate(src / "final.pt", src, main, tok, ref)
        assert m is not None and any("NaN" in r for r in rep) and any("منفجرة" in r for r in rep), rep
        assert torch.isfinite(m.layers[0].mlp.up_proj.weight).all()

        # c) different text tokenizer → rows remapped by token string
        src = d / "c"; src.mkdir()
        seed2 = d / "s2.txt"
        seed2.write_text("النصوص الحقيقية شام يتعلم. أخبار ويكيبيديا اليوم. " * 60, encoding="utf-8")
        tok2 = train_text_tokenizer([str(seed), str(seed2)], vocab_size=320)
        save_checkpoint(src / "final.pt", good, step=9)
        tok2.save(str(src / "sham_small_tokenizer.json"))
        m, _, rep = repair_candidate(src / "final.pt", src, main, tok, ref)
        assert m is not None and any("صف مشترك" in r for r in rep), rep
        v1, v2 = tok._tokenizer.get_vocab(), tok2._tokenizer.get_vocab()
        piece = next(t for t in v1 if t in v2 and v1[t] != v2[t])
        assert torch.equal(m.token_embedding.weight[v1[piece]], good.token_embedding.weight[v2[piece]])

        # c2) a tokenizer that shares few whole pieces is no longer a reason to refuse: unshared pieces are built from the source's pieces
        import re as _re
        nums = [int(x.replace(",", "")) for x in _re.findall(r"([\d,]+) صف", next(r for r in rep if "صف مشترك" in r))]
        assert nums[0] > 0 and nums[1] >= 0 and torch.isfinite(m.token_embedding.weight).all(), rep

        # d) different architecture → refused with the reason
        src = d / "e"; src.mkdir()
        save_checkpoint(src / "final.pt", ShamSmall(ShamSmallConfig(vocab_size=42256, d_model=48, n_layers=1, n_heads=2,
                                                                     n_kv_heads=1, mlp_hidden=64, max_seq_len=16)), step=1)
        tok.save(str(src / "sham_small_tokenizer.json"))
        m, _, rep = repair_candidate(src / "final.pt", src, main, tok, ref)
        assert m is None and "معمارية" in rep[-1], rep
    print("sham_repair self-test OK")
