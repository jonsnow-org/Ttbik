"""
Sham's contrastive link loss ("خسارة الربط التبايني") — our own answer to the
"unified latent space" idea, INSIDE Sham's single backbone, with no outside
encoder and without giving up generation (images/sounds stay tokens in the
same stream, so Sham can still draw and speak).

For every training batch that holds text<->media pairs, each sequence's
media tokens and text tokens are pooled from Sham's final hidden states and
an InfoNCE loss (as in CLIP, but on Sham's own states) pulls each caption
toward ITS image/sound and away from the other pairs in the batch. Added to
the usual next-token loss with a small weight. The link we measure every
session (وصف→صورة, صورة→وصف, …) is exactly what this trains.

Installed from sham_inputs (like sham_schedule / sham_vq): it wraps
train.train, so stage 2, the chat stage and any notebook calling train()
get it with no cell change. Batches with fewer than two pairs are untouched.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F

from model import TEXT_VOCAB_SIZE, SpecialTokens

WEIGHT = 0.1
TEMPERATURE = 0.07
_MEDIA_LO = TEXT_VOCAB_SIZE
_MEDIA_HI = SpecialTokens._base
STATS = {"batches": 0, "loss_sum": 0.0}


def pooled_pairs(hidden: torch.Tensor, input_ids: torch.Tensor):
    """(text_vecs, media_vecs, media_keys) for sequences holding both."""
    text_mask = input_ids < TEXT_VOCAB_SIZE
    media_mask = (input_ids >= _MEDIA_LO) & (input_ids < _MEDIA_HI)
    keep = (text_mask.sum(1) > 0) & (media_mask.sum(1) > 0)
    if int(keep.sum()) < 2:
        return None
    h = hidden[keep].float()
    tm, mm = text_mask[keep].unsqueeze(-1).float(), media_mask[keep].unsqueeze(-1).float()
    t = (h * tm).sum(1) / tm.sum(1)
    m = (h * mm).sum(1) / mm.sum(1)
    # the same pair can appear twice in a batch (understand + create); those are not negatives
    keys = [hash(tuple(row[msk].tolist())) for row, msk in zip(input_ids[keep], media_mask[keep])]
    return t, m, keys


def contrast_loss(hidden: torch.Tensor, input_ids: torch.Tensor) -> torch.Tensor | None:
    got = pooled_pairs(hidden, input_ids)
    if got is None:
        return None
    t, m, keys = got
    t, m = F.normalize(t, dim=-1), F.normalize(m, dim=-1)
    logits = t @ m.T / TEMPERATURE
    same = torch.tensor([[a == b for b in keys] for a in keys], device=logits.device)
    eye = torch.eye(len(keys), dtype=torch.bool, device=logits.device)
    logits = logits.masked_fill(same & ~eye, float("-inf"))  # duplicates: neither positive nor negative
    if bool((~same).sum() == 0):
        return None  # every row is the same pair — nothing to contrast
    target = torch.arange(len(keys), device=logits.device)
    return 0.5 * (F.cross_entropy(logits, target) + F.cross_entropy(logits.T, target))


def attach(model):
    """Makes model(ids, labels=...) add WEIGHT × contrast loss while training.
    Returns a detach() callable that restores the model exactly."""
    captured = {}
    hook = model.final_norm.register_forward_hook(lambda _m, _i, out: captured.__setitem__("h", out))
    original = model.forward

    def forward(input_ids, labels=None, *args, **kwargs):
        out = original(input_ids, labels, *args, **kwargs)
        if labels is None or not model.training or kwargs.get("use_cache") or out[1] is None:
            return out
        aux = contrast_loss(captured.get("h"), input_ids)
        if aux is None:
            return out
        STATS["batches"] += 1
        STATS["loss_sum"] += float(aux.detach())
        return (out[0], out[1] + WEIGHT * aux, *out[2:])

    model.forward = forward

    def detach():
        hook.remove()
        if model.__dict__.get("forward") is forward:
            del model.forward
    return detach


def report() -> str:
    from sham_selfdev import record
    if not STATS["batches"]:
        record("الربط التبايني", "لم يعمل: لا دفعات فيها أزواج نص/وسائط كافية")
        return "🔗 خسارة الربط التبايني: لا دفعات فيها أزواج نص/وسائط كافية."
    record("الربط التبايني", f"{STATS['batches']:,} دفعة، متوسط {STATS['loss_sum'] / STATS['batches']:.3f}")
    return (f"🔗 خسارة الربط التبايني: {STATS['batches']:,} دفعة، "
            f"متوسط {STATS['loss_sum'] / STATS['batches']:.3f}")


def install() -> None:
    import train as _train

    if getattr(_train.train, "_sham_link_contrast", False):
        return
    original = _train.train

    def train_with_link(model, *args, **kwargs):
        STATS.update(batches=0, loss_sum=0.0)
        detach = attach(model)
        try:
            return original(model, *args, **kwargs)
        finally:
            detach()
            print(report())

    train_with_link._sham_link_contrast = True
    _train.train = train_with_link


if __name__ == "__main__":
    from model import ShamSmall, ShamSmallConfig

    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=32)
    model = ShamSmall(cfg)
    B, S, E = SpecialTokens.BOS, SpecialTokens.IMAGE_START, SpecialTokens.IMAGE_END
    rows = [[B, 10 + i, 20 + i, S, _MEDIA_LO + 5 * i, _MEDIA_LO + 5 * i + 1, E, SpecialTokens.EOS] for i in range(4)]
    ids = torch.tensor(rows)
    model.train()
    base = model(ids, labels=ids)[1]
    detach = attach(model)
    with_aux = model(ids, labels=ids)[1]
    assert float(with_aux) > float(base) and STATS["batches"] == 1
    with_aux.backward()
    assert model.token_embedding.weight.grad is not None
    # text-only batch: unchanged
    txt = torch.randint(0, 100, (3, 8))
    assert torch.equal(model(txt, labels=txt)[1], ShamSmall.forward(model, txt, txt)[1])
    # duplicates only → nothing to contrast
    dup = torch.tensor([rows[0], rows[0]])
    assert contrast_loss(torch.randn(2, 8, 32), dup) is None
    detach()
    assert "forward" not in model.__dict__
    # a few steps of the loss alone separate the pairs
    opt = torch.optim.AdamW(model.parameters(), lr=1e-2)
    first = None
    for _ in range(30):
        cap = {}
        h = model.final_norm.register_forward_hook(lambda _m, _i, o: cap.__setitem__("h", o))
        model(ids)
        h.remove()
        loss = contrast_loss(cap["h"], ids)
        first = first if first is not None else float(loss)
        opt.zero_grad(); loss.backward(); opt.step()
    assert float(loss) < first * 0.5, (first, float(loss))
    print("sham_link_contrast self-test OK")
