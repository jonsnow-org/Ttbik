"""
Which checkpoint lineages carry a clearly BETTER image tokenizer than the one the published model carries (2026-10-17).

Measured on 2026-10-17 (sham_decoder_refine.py survey): the image tokenizer inside the merged model — and inside every lineage that started from it — is the
same step-53 file (reconstruction error 0.111 on the fixed sample), while the account holds tokenizers that reconstruct 2.5-2.8x better (0.040-0.044). A lineage
that trains with a better tokenizer can still be merged for text and chat, but its pictures can never reach the Studio unless it becomes the BASE: the media
rows of a source whose tokenizer differs are (rightly) left out of every merge.

  better_tokenizer_lineages(candidates, current_dir, measure=None, ratio=0.6) -> {name: (error, current_error)}
        candidates: [(name, folder)] ; a lineage qualifies when its image tokenizer is a different file from the current one and its measured
        reconstruction error is at most `ratio` times the current one (default: at least 40% lower).
Used by sham_ci_merge.pick_base: a qualifying lineage may become the base when its text loss is within EDGE_TOLERANCE of the best (sham_base_select.choose_base(edge=...)).
Offline self-test: python sham_media_edge.py
"""
from __future__ import annotations

import hashlib
from pathlib import Path

EDGE_RATIO = 0.6
EDGE_TOLERANCE = 1.03       # a better-tokenizer lineage wins the base when its text loss is at most 3% above the best


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _tok(folder: Path):
    files = sorted(Path(folder).rglob("image_tokenizer.pt"))
    return files[0] if files else None


def better_tokenizer_lineages(candidates, current_dir, measure=None, ratio: float = EDGE_RATIO, loader=None, log=print) -> dict:
    out: dict = {}
    cur = _tok(current_dir) if current_dir else None
    if cur is None:
        return out
    try:
        if measure is None:
            from tokenizer_select import default_measure
            measure = default_measure("image")
        if measure is None:
            return out
        if loader is None:
            from tokenizer_select import robust_load
            loader = lambda p: robust_load(str(p), "image")[0]
        cur_err = measure(loader(cur))
        if cur_err is None:
            return out
        cur_sha = _sha(cur)
        seen = {cur_sha: cur_err}
        for name, folder in candidates:
            f = _tok(folder)
            if f is None:
                continue
            sha = _sha(f)
            if sha not in seen:
                seen[sha] = measure(loader(f))
            err = seen[sha]
            if sha != cur_sha and err is not None and err <= ratio * cur_err:
                out[name] = (err, cur_err)
                log(f"🖼 {name}: مُرمِّز صور أفضل بوضوح (خطأ {err:.4f} مقابل {cur_err:.4f}) — مؤهَّل ليصير الأساس إن كان نصه قريباً")
    except Exception as exc:
        log(f"⚠ تعذّر مقارنة مُرمِّزات الصور بين السلالات ({type(exc).__name__}): {str(exc)[:100]}")
    return out


import torch


@torch.no_grad()
def reset_media_rows(model, kinds, log=print) -> None:
    """The model's rows for a switched media kind describe ids of ANOTHER tokenizer: start them where an untrained row would (mean of the text rows plus
    small noise) so the old mapping does not fight the new one. Tied embedding / output head: one tensor."""
    from model import AUDIO_VOCAB_BASE, AUDIO_VOCAB_SIZE, IMAGE_VOCAB_BASE, IMAGE_VOCAB_SIZE, TEXT_VOCAB_SIZE
    span = {"image": (IMAGE_VOCAB_BASE, IMAGE_VOCAB_BASE + IMAGE_VOCAB_SIZE), "audio": (AUDIO_VOCAB_BASE, AUDIO_VOCAB_BASE + AUDIO_VOCAB_SIZE)}
    emb = model.token_embedding.weight
    mean, std = emb[:TEXT_VOCAB_SIZE].mean(0), emb[:TEXT_VOCAB_SIZE].std()
    gen = torch.Generator(device="cpu").manual_seed(20261017)
    for kind in kinds:
        lo, hi = span[kind]
        emb[lo:hi] = mean + 0.1 * std * torch.randn(hi - lo, emb.shape[1], generator=gen).to(emb.device, emb.dtype)
        log(f"♻ صفوف {kind} أُعيدت تهيئتها لمُرمِّزها الجديد")


def plan_switch(base_dir, measure_for=None, selector=None, ratio: float = EDGE_RATIO, log=print) -> dict:
    """The published head carries ONE image and ONE audio tokenizer, and every lineage that continues from the head inherits it. If the account holds a tokenizer
    that measures clearly better on the fixed sample (error <= ratio x the head's), the head itself should move to it ONCE — then every lineage trains the SAME
    new ids and their media rows merge normally. Returns {kind: (path of the better tokenizer, its error, the head's error)} (empty = keep)."""
    out: dict = {}
    try:
        from tokenizer_select import default_measure, robust_load, select_pretrained_tokenizer
        selector = selector or (lambda kind: select_pretrained_tokenizer(kind))
        for kind in ("image", "audio"):
            cur_files = sorted(Path(base_dir).rglob(f"{kind}_tokenizer.pt"))
            if not cur_files:
                continue
            measure = (measure_for or default_measure)(kind)
            if measure is None:
                continue
            best = selector(kind)                      # (tokenizer, step, path): healthy codebook first, then measured error, over everything the account holds
            if not best:
                continue
            best_path = Path(best[2])
            if _sha(best_path) == _sha(cur_files[0]):
                continue
            cur_tok = robust_load(str(cur_files[0]), kind)[0]
            e_cur, e_best = measure(cur_tok), measure(best[0])
            if e_cur and e_best and e_best <= ratio * e_cur:
                out[kind] = (best_path, e_best, e_cur)
                log(f"🔁 {kind}: الرأس المنشور ينتقل مرة واحدة إلى مُرمِّز أفضل بوضوح (خطأ {e_best:.4f} مقابل {e_cur:.4f})")
            else:
                log(f"  {kind}: لا مُرمِّز في الحساب أفضل بما يكفي من مُرمِّز الرأس ({e_best} مقابل {e_cur}) — يبقى")
    except Exception as exc:
        log(f"⚠ فحص انتقال المُرمِّز فشل ({type(exc).__name__}): {str(exc)[:120]} — يبقى مُرمِّز الرأس")
    return out


if __name__ == "__main__":
    import tempfile

    import torch

    from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
    from train_image_tokenizer import save_tokenizer_checkpoint

    cfg = ImageTokenizerConfig(image_size=32, base_channels=8, channel_multipliers=(1, 2), code_dim=8, num_codes=64)
    td = Path(tempfile.mkdtemp())
    for name, seed in (("cur", 0), ("same", 0), ("better", 1), ("worse", 2)):
        (td / name).mkdir()
        torch.manual_seed(seed)
        save_tokenizer_checkpoint(td / name / "image_tokenizer.pt", ImageTokenizer(cfg), 1)
    (td / "same" / "image_tokenizer.pt").write_bytes((td / "cur" / "image_tokenizer.pt").read_bytes())
    errs = {_sha(td / "cur" / "image_tokenizer.pt"): 0.11}
    errs[_sha(td / "better" / "image_tokenizer.pt")] = 0.04
    errs[_sha(td / "worse" / "image_tokenizer.pt")] = 0.2
    measure = lambda tok: tok._sha_for_test
    def loader(p):
        t = type("T", (), {})()
        t._sha_for_test = errs[_sha(Path(p))]
        return t
    res = better_tokenizer_lineages([("same", td / "same"), ("better", td / "better"), ("worse", td / "worse")], td / "cur", measure=measure, loader=loader, log=lambda *_: None)
    assert list(res) == ["better"], res
    # plan_switch: a better tokenizer file in the account moves the head once; the same file again is never a switch
    sel_dir = td / "better" / "image_tokenizer.pt"
    fake_tok = type("T", (), {"_sha_for_test": 0.04})()
    plan = plan_switch(td / "cur", measure_for=lambda kind: (lambda tok: getattr(tok, '_sha_for_test', 0.11)), selector=lambda kind: (fake_tok, 1, str(sel_dir)) if kind == "image" else None,
                       log=lambda *_: None)
    assert "image" in plan and plan["image"][0] == sel_dir, plan
    same = plan_switch(td / "cur", measure_for=lambda kind: (lambda tok: getattr(tok, '_sha_for_test', 0.11)), selector=lambda kind: (fake_tok, 1, str(td / "cur" / "image_tokenizer.pt")), log=lambda *_: None)
    assert same == {}
    from model import ShamSmall, ShamSmallConfig, TOTAL_VOCAB_SIZE, IMAGE_VOCAB_BASE, TEXT_VOCAB_SIZE, AUDIO_VOCAB_BASE
    m = ShamSmall(ShamSmallConfig(vocab_size=TOTAL_VOCAB_SIZE, d_model=16, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=32, max_seq_len=32))
    t0 = m.token_embedding.weight[:TEXT_VOCAB_SIZE].clone()
    a0 = m.token_embedding.weight[AUDIO_VOCAB_BASE:AUDIO_VOCAB_BASE + 2048].clone()
    i0 = m.token_embedding.weight[IMAGE_VOCAB_BASE:IMAGE_VOCAB_BASE + 8192].clone()
    reset_media_rows(m, ["image"], log=lambda *_: None)
    w = m.token_embedding.weight
    assert torch.equal(w[:TEXT_VOCAB_SIZE], t0) and torch.equal(w[AUDIO_VOCAB_BASE:AUDIO_VOCAB_BASE + 2048], a0) and not torch.equal(w[IMAGE_VOCAB_BASE:IMAGE_VOCAB_BASE + 8192], i0)
    print("sham_media_edge self-test OK")
