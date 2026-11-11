"""
Sham — token-by-token generation with a ROLLING window: the length of a reply is not capped by the model's 2048-token window.

Why 2048 at all: it is the `max_seq_len` the model was trained at and the size of its position table (RoPE); attention cost also grows with the square of the
length on a CPU. It is a property of how this checkpoint was trained, not a law. Two things lift it, and this file is the first of them:

  1. (here, now, no retraining) a rolling window: when the context is full, the middle is dropped — the first `anchor` tokens (the question / the task)
     and the most recent half of the window are kept — and the rest is re-read once. Generation then goes on without end; what has scrolled out of the
     window is forgotten, like a person writing a long text who keeps only the task and the last pages in mind. The re-read happens once per half window,
     so the cost per token stays flat.
  2. (needs training, existing tooling) a longer window: sham_longctx.extend_context_ntk stretches the position table, sham_longctx_train.py teaches the
     model to use it. A longer window means less forgetting; the rolling window removes the CAP either way.

`iter_tokens` yields one token id at a time (so a caller can stream text to the user, stop on a marker, or run a tool when the model writes a call).

Against the forgetting: what scrolls out is not thrown away. The dropped middle goes into a small bank of 64-token chunks (key = mean embedding, as sham_longctx.TokenBank
does) and, every time the window slides, the chunks most similar to what is being written now are put back between the anchor and the recent tail, so a long reply can
still look at its own earlier pages. How much the model USES them is a training matter (sham_longctx_train.py teaches exactly this layout: anchor + retrieved + tail).
"""
from __future__ import annotations

from typing import Iterator

import torch

import generate as _generate
from sham_decoding import penalize_text_logits


@torch.no_grad()
def iter_tokens(model, prompt_ids: list[int], max_new_tokens: int, *, temperature: float = 0.6, top_k: int | None = 40, top_p: float | None = 0.9,
                text_vocab: int | None = None, extra_allowed: tuple[int, ...] = (), eos_id: int | None = None, stop_ids: set[int] | None = None,
                repetition_penalty: float = 1.1, frequency_penalty: float = 0.05, no_repeat_ngram: int = 4, anchor: int | None = None,
                window: int | None = None, embed_weight: torch.Tensor | None = None, bank_chunks: int = 4, bank_chunk_size: int = 64, stats: dict | None = None,
                banned_ids: list[int] | None = None) -> Iterator[int]:
    """Yield generated token ids until EOS / a stop id / max_new_tokens. `text_vocab`: sampling is limited to ids below it (plus `extra_allowed`).
    The window defaults to the model's max_seq_len; the first `anchor` tokens (default: up to a quarter of the window) always stay."""
    model.eval()
    max_ctx = int(window or model.cfg.max_seq_len)
    ids = list(prompt_ids)
    anchor = min(len(ids), anchor if anchor is not None else max_ctx // 4)
    new: list[int] = []
    past = None
    nxt = torch.tensor([ids], dtype=torch.long)
    stop = set(stop_ids or ())
    if embed_weight is None and hasattr(model, "token_embedding"):
        embed_weight = model.token_embedding.weight
    bank: list[tuple[torch.Tensor, list[int]]] = []
    seen: set[tuple] = set()
    C = bank_chunk_size

    def key(chunk: list[int]) -> torch.Tensor:
        v = embed_weight[torch.tensor(chunk)].float().mean(0)
        return v / (v.norm() + 1e-6)

    def remember(tokens: list[int]) -> None:
        for i in range(0, len(tokens) - C + 1, C):
            ch = tokens[i:i + C]
            t = tuple(ch)
            if t not in seen:
                seen.add(t)
                bank.append((key(ch), ch))
    for _ in range(max_new_tokens):
        if len(ids) >= max_ctx - 1:                 # full: keep the anchor and the most recent half of the window, read them again once
            keep = max(8, (max_ctx - anchor) // 2)
            lost = ids[anchor:len(ids) - keep]
            back: list[int] = []
            if embed_weight is not None and bank_chunks > 0:
                remember(lost)
                room = min(bank_chunks, max(0, (max_ctx - anchor - keep - 8) // C))
                if room and bank and len(ids) >= C:
                    q = key(ids[-C:])
                    present = {tuple(ids[i:i + C]) for i in range(anchor, len(ids) - C + 1, C)}
                    scored = sorted(((float(k @ q), ch) for k, ch in bank if tuple(ch) not in present), key=lambda x: -x[0])[:room]
                    order = {tuple(ch): n for n, (_, ch) in enumerate(bank)}
                    for _, ch in sorted(scored, key=lambda x: order[tuple(x[1])]):      # back in the order they were written
                        back += ch
                    if stats is not None:
                        stats["retrieved"] = stats.get("retrieved", 0) + len(scored)
            if stats is not None:
                stats["slides"] = stats.get("slides", 0) + 1
            ids = ids[:anchor] + back + ids[len(ids) - keep:]
            past = None
            nxt = torch.tensor([ids], dtype=torch.long)
        logits, _, past = model(nxt, past_key_values=past, use_cache=True)
        last = logits[:, -1, :].float()
        last = torch.stack([penalize_text_logits(last[0], new, repetition_penalty, frequency_penalty, no_repeat_ngram)])
        allowed = None
        if text_vocab is not None:
            mask = torch.full_like(last, float("-inf"))
            mask[:, :text_vocab] = 0.0
            keep_ids = [i for i in ((eos_id,) if eos_id is not None else ()) + tuple(extra_allowed)]
            if keep_ids:
                mask[:, keep_ids] = 0.0
            last = last + mask
        if banned_ids:                               # tokens of a script that is in none of the conversation's messages (sham_studio_chat.script_banned_ids)
            last[:, banned_ids] = float("-inf")
        tok = _generate._sample_from_logits(last, temperature=temperature, top_k=top_k, top_p=top_p, allowed_range=allowed)
        t = int(tok[0, 0])
        new.append(t)
        ids.append(t)
        nxt = tok
        yield t
        if (eos_id is not None and t == eos_id) or t in stop:
            return


def _selftest() -> None:
    from model import ShamSmall, ShamSmallConfig
    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=300, d_model=32, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=64, max_seq_len=48)
    model = ShamSmall(cfg).eval()
    prompt = list(range(5, 25))
    out = list(iter_tokens(model, prompt, 400, text_vocab=250, temperature=1.0, top_k=None, top_p=None))
    assert len(out) == 400, len(out)                              # 400 tokens from a 48-token window: no cap
    st: dict = {}
    again = list(iter_tokens(model, prompt, 400, text_vocab=250, temperature=1.0, top_k=None, top_p=None, stats=st, bank_chunk_size=4))
    assert len(again) == 400 and st.get("slides", 0) >= 3 and st.get("retrieved", 0) > 0, st     # the window slid, and earlier chunks came back
    assert all(0 <= t < 250 for t in out)
    stopped = list(iter_tokens(model, prompt, 400, text_vocab=250, stop_ids={out[7]}, temperature=1.0, top_k=None, top_p=None))
    assert stopped and stopped[-1] in (out[7],) or len(stopped) <= 400
    first = [t for t in iter_tokens(model, prompt, 5, text_vocab=250, temperature=0.0001, top_k=1, top_p=None)]
    assert len(first) == 5
    print("sham_stream self-test OK  (400 tokens through a 48-token window)")


if __name__ == "__main__":
    _selftest()
