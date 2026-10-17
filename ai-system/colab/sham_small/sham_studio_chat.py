"""
How the hosted Sham (ModelScope Studio, and through it the Telegram bot) answers (owner, 2026-10-12).

Until now the Studio asked the model for a RAW continuation of the prompt: no dialogue turns (the chat stage trains «<USER> q <SHAM> a»), no date,
no search. A model that only continues text answers "the year is 2024". This module gives the answer path the three things the rest of the
project already trains for:

  1. the dialogue layout the chat stage uses (sham_decoding.chat_prompt_ids), so the model is asked the way it was taught to answer;
  2. today's date as CONTEXT in the prompt («التاريخ اليوم: 2026-10-12 (الاثنين)») — an input like any other, never a canned answer; the model learns
     to read it from the examples sham_chat.build_date_example adds to training;
  3. the model's own learned web search (sham_decoding.chat_generate_with_search): it decides to write <SEARCH_START> query <SEARCH_END>, a real
     search runs, the real text comes back in <RESULT_START>…<RESULT_END>, and it continues. If the Studio cannot reach the search provider the
     result is «لا توجد نتائج» and the model answers without it (nothing fails).

Switches (environment): SHAM_STUDIO_CHAT=0 → raw continuation as before; SHAM_STUDIO_SEARCH=0 → no search; SHAM_STUDIO_DATE=0 → no date line.
This file lives in sham_small, so a change here reaches the Studio with the normal sync; app.py only calls it.
"""
from __future__ import annotations

import datetime
import os

import torch

MAX_PROMPT_TOKENS = 384


def _on(name: str) -> bool:
    return os.environ.get(name, "1").strip().lower() not in ("0", "off", "false", "no", "")


def build_user_text(prompt: str, today: datetime.date | None = None) -> str:
    """The user's turn: the date line (unless switched off) and the question."""
    if not _on("SHAM_STUDIO_DATE"):
        return prompt
    from sham_chat import date_context_line
    return date_context_line(today or datetime.datetime.now(datetime.timezone.utc).date()) + "\n" + prompt


def raw_continuation(model, tokenizer, prompt: str, max_new_tokens: int) -> str:
    """The old path (kept as the fallback): a plain continuation of the prompt."""
    from generate import generate_tokens
    from model import SpecialTokens
    ids = torch.tensor([tokenizer.encode(prompt)], dtype=torch.long)
    out = generate_tokens(model, ids, max_new_tokens=max_new_tokens, temperature=0.8, top_k=50, top_p=0.95, eos_id=SpecialTokens.EOS,
                          repetition_penalty=1.3, allowed_ranges=[(0, tokenizer.vocab_size)] * max_new_tokens)
    new = [i for i in out[0, ids.shape[1]:].tolist() if i != SpecialTokens.EOS]
    return tokenizer.decode(new)


# 2026-10-16 (owner-approved fix): an empty chat answer used to fall back to a RAW continuation of the prompt, which is exactly the
# "continues Wikipedia text" reply seen in the bot. Now (SHAM_STUDIO_RAW_FALLBACK=0, default) it retries ONCE in the dialogue layout with
# <EOS> held back for the first MIN_ANSWER_TOKENS tokens (a second try with slightly hotter sampling if needed). No fixed/canned text is ever
# returned: whatever the model itself writes is the answer. SHAM_STUDIO_RAW_FALLBACK=1 = old behaviour.
MIN_ANSWER_TOKENS = 4
RETRY_TEMPERATURES = (0.7, 0.9)


def _raw_fallback() -> bool:
    return os.environ.get("SHAM_STUDIO_RAW_FALLBACK", "0").strip().lower() in ("1", "on", "true", "yes")


def _chat_retry(model, tokenizer, prompt: str, max_new_tokens: int, today=None) -> str:
    """Up to two more tries in the chat layout, no search; <EOS> is not allowed before MIN_ANSWER_TOKENS. Returns the model's own text."""
    text = ""
    for temp in RETRY_TEMPERATURES:
        text = _chat_try(model, tokenizer, prompt, max_new_tokens, today, temp)
        if text.strip():
            break
    return text


def _chat_try(model, tokenizer, prompt: str, max_new_tokens: int, today, temp: float) -> str:
    try:
        from model import SpecialTokens
        from sham_decoding import chat_prompt_ids, guarded_generate_tokens
        ids = tokenizer.encode(build_user_text(prompt, today))[-MAX_PROMPT_TOKENS:]
        wrapped = torch.tensor([chat_prompt_ids(ids)], dtype=torch.long)
        text_range = [(0, tokenizer.vocab_size)]
        n_min = max(1, min(MIN_ANSWER_TOKENS, max_new_tokens))
        out = guarded_generate_tokens(model, wrapped, n_min, temperature=temp, top_k=40, top_p=0.9, eos_id=None,
                                      allowed_ranges=text_range * n_min)
        rest = max_new_tokens - n_min
        if rest > 0:
            out = guarded_generate_tokens(model, out, rest, temperature=temp, top_k=40, top_p=0.9, eos_id=SpecialTokens.EOS,
                                          allowed_ranges=text_range * rest)
        new = [t for t in out[0, wrapped.shape[1]:].tolist() if t < tokenizer.vocab_size]
        return tokenizer.decode(new)
    except Exception as exc:
        print(f"chat retry failed ({type(exc).__name__}: {str(exc)[:120]})", flush=True)
        return ""


def studio_generate(model, tokenizer, prompt: str, max_new_tokens: int = 60, today: datetime.date | None = None, search_fn="default") -> str:
    """The answer to `prompt`. `search_fn`: "default" = real web search unless SHAM_STUDIO_SEARCH=0, None = no search, or any callable(str)->str.
    Two diagnostic prompts for the owner: «#info» reports which path is active; «#raw <text>» answers <text> with the old raw continuation, so the two
    ways can be compared on the same question."""
    stripped = prompt.strip()
    if stripped == "#info":
        return (f"sham_studio_chat فعّال | حوار={_on('SHAM_STUDIO_CHAT')} بحث={_on('SHAM_STUDIO_SEARCH')} تاريخ={_on('SHAM_STUDIO_DATE')} | "
                f"التاريخ في السياق الآن: {build_user_text('', today).splitlines()[0] if _on('SHAM_STUDIO_DATE') else '—'}")
    if stripped.startswith("#raw "):
        return raw_continuation(model, tokenizer, stripped[5:], max_new_tokens)
    if not _on("SHAM_STUDIO_CHAT"):
        if _raw_fallback():
            return raw_continuation(model, tokenizer, prompt, max_new_tokens)
        return _chat_retry(model, tokenizer, prompt, max_new_tokens, today)
    from sham_decoding import chat_generate_with_search, chat_prompt_ids, web_search_text
    if search_fn == "default":
        search_fn = web_search_text if _on("SHAM_STUDIO_SEARCH") else None
    ids = tokenizer.encode(build_user_text(prompt, today))[-MAX_PROMPT_TOKENS:]
    wrapped = torch.tensor([chat_prompt_ids(ids)], dtype=torch.long)
    answer, queries = chat_generate_with_search(model, wrapped, max_new_tokens, tokenizer, search_fn=search_fn,
                                                temperature=0.6, top_k=40, top_p=0.9)
    text = tokenizer.decode(answer).strip()
    if not text:                                    # the model answered nothing: fall back to the raw path rather than return an empty reply
        if _raw_fallback():                         # 2026-10-16: old behaviour only with SHAM_STUDIO_RAW_FALLBACK=1 (line above kept)
            return raw_continuation(model, tokenizer, prompt, max_new_tokens)
        text = _chat_retry(model, tokenizer, prompt, max_new_tokens, today)
    return ("[بحث: " + " | ".join(queries) + "] " + text) if queries else text


if __name__ == "__main__":
    import datetime as _dt

    from model import ShamSmall, ShamSmallConfig, SpecialTokens

    class Tok:                       # byte-ish tokenizer inside a small text range
        vocab_size = 400

        def encode(self, t):
            return [3 + (ord(c) % 390) for c in t]

        def decode(self, ids):
            return "".join(chr(0x0621 + (i % 40)) for i in ids)

    d = _dt.date(2026, 10, 12)
    assert build_user_text("سؤال", d).startswith("التاريخ اليوم: 2026-10-12 (الاثنين)\n")
    os.environ["SHAM_STUDIO_DATE"] = "0"
    assert build_user_text("سؤال", d) == "سؤال"
    os.environ.pop("SHAM_STUDIO_DATE")
    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=SpecialTokens.RESULT_END + 8, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=1024)
    model = ShamSmall(cfg).train(False)
    seen = []
    out = studio_generate(model, Tok(), "ما هي عاصمة فرنسا؟", 12, today=d, search_fn=lambda q: seen.append(q) or "نتيجة")
    assert isinstance(out, str) and out
    out2 = studio_generate(model, Tok(), "سؤال", 8, today=d, search_fn=None)
    assert isinstance(out2, str) and out2
    assert "sham_studio_chat" in studio_generate(model, Tok(), "#info", 8, today=d) and "2026-10-12" in studio_generate(model, Tok(), "#info", 8, today=d)
    assert isinstance(studio_generate(model, Tok(), "#raw سؤال", 8), str)
    os.environ["SHAM_STUDIO_CHAT"] = "0"
    assert isinstance(studio_generate(model, Tok(), "سؤال", 8), str)
    os.environ.pop("SHAM_STUDIO_CHAT")
    import sham_decoding as _sd                      # empty first answer -> retry in chat layout (never raw), then the honest message
    _orig = _sd.chat_generate_with_search
    _sd.chat_generate_with_search = lambda *a, **k: ([], [])
    calls = []
    _orig_raw = raw_continuation
    globals()["raw_continuation"] = lambda *a, **k: calls.append(1) or "RAW"
    r = studio_generate(model, Tok(), "سؤال", 8, today=d, search_fn=None)
    assert r and r != "RAW" and not calls, r
    globals()["_chat_retry"], _keep = (lambda *a, **k: "نص النموذج"), _chat_retry
    assert studio_generate(model, Tok(), "سؤال", 8, today=d, search_fn=None) == "نص النموذج" and not calls
    os.environ["SHAM_STUDIO_RAW_FALLBACK"] = "1"
    assert studio_generate(model, Tok(), "سؤال", 8, today=d, search_fn=None) == "RAW" and calls
    os.environ.pop("SHAM_STUDIO_RAW_FALLBACK")
    globals()["_chat_retry"], globals()["raw_continuation"], _sd.chat_generate_with_search = _keep, _orig_raw, _orig
    assert len(_chat_retry(model, Tok(), "سؤال", 8, today=d)) >= 1
    print("sham_studio_chat self-test OK")
