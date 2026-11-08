"""
How the hosted Sham (ModelScope Studio, and through it the Telegram bot) answers (owner, 2026-10-12).

Until now the Studio asked the model for a RAW continuation of the prompt: no dialogue turns (the chat stage trains «<USER> q <SHAM> a»), no date,
no search. A model that only continues text answers "the year is 2024". This module gives the answer path the three things the rest of the
project already trains for:

  1. legacy Sham chat uses the dialogue layout learned in its chat stage; the Qwen3 route below instead consumes native user/assistant turns;
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

# Legacy one-prompt window. Native Qwen3 role chat budgets directly against the model's max_seq_len.
MAX_PROMPT_TOKENS = int(os.environ.get("SHAM_MAX_PROMPT_TOKENS", "384" if os.environ.get("SHAM_LIMITS", "").strip().lower() == "closed" else "1024"))     # owner 2026-11-08: no small caps; the 2048-token window is shared with the reply


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
    return os.environ.get("SHAM_STUDIO_RAW_FALLBACK", "1").strip().lower() in ("1", "on", "true", "yes")      # owner 2026-11-08: raw generation is essential; ON


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


_MODES = None


def split_modes(prompt: str) -> tuple[str, dict]:
    """The engine's thinking / accuracy / speed settings arrive as ONE header line at the start of the prompt (src/lib/shamModes.ts):
    "[[sham temp=0.20 think=300]]". Returns (the prompt without it, {"temp": float, "think": int}); no header = no settings (the Studio's own defaults)."""
    import re
    global _MODES
    if _MODES is None:
        _MODES = re.compile(r"^\s*\[\[sham ([^\]]*)\]\]\n?")
    m = _MODES.match(prompt)
    if not m:
        return prompt, {}
    out: dict = {}
    for kv in m.group(1).split():
        k, _, v = kv.partition("=")
        try:
            if k == "temp":
                out["temp"] = min(1.5, max(0.0, float(v)))
            elif k == "think":
                out["think"] = max(0, min(2048, int(float(v))))
        except ValueError:
            pass
    return prompt[m.end():], out


def _uses_qwen3_chat(model) -> bool:
    """Use the donor's chat format only when the checkpoint itself declares it."""
    return getattr(getattr(model, "cfg", None), "chat_format", "") == "qwen3"


def _qwen3_messages_prompt_ids(tokenizer, messages: list[dict], max_context_tokens: int) -> list[int]:
    """Serialize actual user/assistant turns and trim oldest complete turns first."""
    segments = []
    for message in messages:
        role = message.get("role")
        if role not in ("user", "assistant"):
            raise ValueError(f"unsupported Qwen3 chat role: {role!r}")
        content = str(message.get("content") or "")
        head = tokenizer.encode(f"<|im_start|>{role}\n")
        body = tokenizer.encode(content)
        tail = tokenizer.encode("<|im_end|>\n")
        segments.append((head, body, tail))
    assistant = tokenizer.encode("<|im_start|>assistant\n")
    budget = max(1, int(max_context_tokens) - len(assistant))
    selected = []
    used = 0
    for head, body, tail in reversed(segments):
        full = len(head) + len(body) + len(tail)
        remaining = budget - used
        if full <= remaining:
            selected.append((head, body, tail))
            used += full
            continue
        if not selected:
            keep = remaining - len(head) - len(tail)
            if keep > 0:
                selected.append((head, body[:keep], tail))
        break
    if not selected:
        raise ValueError("Qwen3 context window is too small for the current user message")
    ids = []
    for head, body, tail in reversed(selected):
        ids.extend(head)
        ids.extend(body)
        ids.extend(tail)
    return ids + assistant


def _qwen3_prompt_ids(tokenizer, prompt: str, think: bool = False, max_context_tokens: int | None = None) -> list[int]:
    """Compatibility wrapper for older one-prompt callers; no hidden system message is inserted."""
    limit = max_context_tokens if max_context_tokens is not None else MAX_PROMPT_TOKENS
    ids = _qwen3_messages_prompt_ids(tokenizer, [{"role": "user", "content": prompt}], limit)
    if not think:
        ids.extend(tokenizer.encode("<think>\n\n</think>\n\n"))
    return ids


def qwen3_chat_messages(model, tokenizer, messages: list[dict], max_new_tokens: int,
                        temperature: float = 0.0, think_tokens: int = 0, tool_prompt: str | None = None) -> str:
    """Generate from native role messages; plain chat adds no identity or answer instructions."""
    from generate import generate_tokens
    from model import SpecialTokens
    context = int(getattr(getattr(model, "cfg", None), "max_seq_len", MAX_PROMPT_TOKENS))
    n = max(1, min(int(max_new_tokens), context - 16))
    close = tokenizer.encode("</think>")
    think = max(0, min(int(think_tokens or 0), context - n - 16)) if len(close) == 1 else 0
    prompt_budget = max(1, context - n - think - 8)
    prompt_ids = _qwen3_messages_prompt_ids(tokenizer, messages, prompt_budget)
    if not think:
        prompt_ids.extend(tokenizer.encode("<think>\n\n</think>\n\n"))
    if len(prompt_ids) + think + n > context:
        raise ValueError("Qwen3 prompt + thinking + answer exceeds model context")
    ids = torch.tensor([prompt_ids], dtype=torch.long)
    end = tokenizer.encode("<|im_end|>")[-1]
    sample = dict(temperature=temperature or 1.0, top_k=1 if not temperature else 40, top_p=1.0 if not temperature else 0.9)
    if think:
        out = generate_tokens(model, ids, max_new_tokens=think, eos_id=end, stop_ids={close[0]},
                              repetition_penalty=1.0, allowed_ranges=[(0, tokenizer.vocab_size)] * think, **sample)
        got = out[0, ids.shape[1]:].tolist()
        if close[0] not in got:
            out = torch.cat([out, torch.tensor([close + tokenizer.encode("\n\n")], dtype=torch.long)], dim=1)
        ids = out
    from sham_toolcall import ToolCallGuard, repair_call, tool_names_from_prompt
    guard = ToolCallGuard(tokenizer, tool_names_from_prompt(tool_prompt)) if tool_prompt and _on("SHAM_TOOLCALL_GUARD") else None
    use = bool(guard and guard.usable)
    if not use and not think:           # a plain answer: Sham v1's rolling-window loop (length not capped by the context); tool prompts keep the guarded loop below
        plain = [t for t in _roll_tokens(model, ids[0].tolist(), tokenizer, max(1, int(max_new_tokens)), end, temperature) if t != end and t < tokenizer.vocab_size]
        return tokenizer.decode(plain).strip()
    out = generate_tokens(model, ids, max_new_tokens=n, eos_id=end, repetition_penalty=1.0 if use else 1.05,
                          allowed_ranges=[(0, tokenizer.vocab_size)] * n,
                          stop_ids={guard.close_id} if use else None, allowed_fn=guard if use else None, **sample)
    new = [i for i in out[0, ids.shape[1]:].tolist() if i != end and i < tokenizer.vocab_size]
    answer = tokenizer.decode(new).strip()
    return repair_call(answer) if use else answer


def _roll_tokens(model, ids: list[int], tokenizer, n: int, end: int, temperature: float):
    """Token ids of a plain answer written with sham_stream's ROLLING window (the same loop Sham v1 uses): the reply is not capped by the 2048-token
    context, and the scrolled-out chunks come back through the bank. `ids` is the whole prompt; the sampling matches qwen3_chat_messages."""
    from sham_stream import iter_tokens
    sample = dict(temperature=temperature or 1.0, top_k=1 if not temperature else 40, top_p=1.0 if not temperature else 0.9)
    yield from iter_tokens(model, list(ids), n, text_vocab=tokenizer.vocab_size, eos_id=end, stop_ids={end}, repetition_penalty=1.05, **sample)


def qwen3_chat_stream(model, tokenizer, messages: list[dict], max_new_tokens: int, temperature: float = 0.0):
    """Yield decoded text pieces of a native role chat as the model writes them, so a server can stream the answer
    token by token (the Mini App live view). Same prompt and sampling as qwen3_chat_messages; no tool-call guard and
    no thinking span (a streamed reply is a plain answer). Since 2026-11-08 it runs on the rolling window (Sham v1's loop): the reply length is bounded
    by max_new_tokens, not by the 2048-token context."""
    context = int(getattr(getattr(model, "cfg", None), "max_seq_len", MAX_PROMPT_TOKENS))
    n = max(1, int(max_new_tokens))
    prompt_ids = _qwen3_messages_prompt_ids(tokenizer, messages, max(1, context - min(n, context // 2) - 8))
    prompt_ids.extend(tokenizer.encode(" thinking\n\n</think>\n\n"))
    end = tokenizer.encode("<|im_end|>")[-1]
    held: list[int] = []
    prev = ""
    for token in _roll_tokens(model, prompt_ids, tokenizer, n, end, temperature):
        if token == end or token >= tokenizer.vocab_size:
            break
        held.append(token)
        # Hold back the last token (a byte-level token can be the start of a multi-byte character) and yield only the
        # NEW text since the previous piece, so the caller appends deltas and never repeats the answer.
        text = tokenizer.decode(held[:-1])
        if len(text) > len(prev):
            yield text[len(prev):]
            prev = text


def studio_generate_stream(model, tokenizer, prompt: str, max_new_tokens: int = 60, today: datetime.date | None = None, search_fn="default"):
    """The token-by-token sibling of studio_generate: yields decoded text pieces for the Mini App's live view.
    Only the model's own chat path is streamed; a `#` diagnostic or the legacy dialogue layout is answered in one
    piece (their search pause / retry is not a token stream), so callers get a uniform iterator either way."""
    prompt, modes = split_modes(prompt)
    if not prompt.strip().startswith("#") and _uses_qwen3_chat(model):
        yield from qwen3_chat_stream(model, tokenizer, [{"role": "user", "content": prompt}], max_new_tokens,
                                     temperature=modes.get("temp", 0.0))
        return
    # the legacy Sham's own chat path is now token-streamed too (sham_stream.iter_tokens): the loop runs in a thread, the pieces come out as they are written
    import queue
    import threading
    q: queue.Queue = queue.Queue()
    done = object()
    final: dict = {}

    def work():
        try:
            final["text"] = studio_generate(model, tokenizer, prompt, max_new_tokens, today, search_fn, on_text=lambda piece: q.put(piece))
        except Exception as exc:
            final["error"] = f"{type(exc).__name__}: {str(exc)[:160]}"
        finally:
            q.put(done)

    threading.Thread(target=work, daemon=True).start()
    streamed = False
    while True:
        item = q.get()
        if item is done:
            break
        streamed = True
        yield item
    if final.get("error"):
        raise RuntimeError(final["error"])
    if not streamed and final.get("text"):      # a path that is not a token stream (raw continuation, a retry): one piece
        yield final["text"]


def qwen3_chat(model, tokenizer, prompt: str, max_new_tokens: int, temperature: float = 0.0, think_tokens: int = 0) -> str:
    """Backward-compatible single-user-turn entry. Tool prompts retain their own call guard."""
    return qwen3_chat_messages(model, tokenizer, [{"role": "user", "content": prompt}], max_new_tokens,
                               temperature=temperature, think_tokens=think_tokens, tool_prompt=prompt)

_COMPUTER = None            # the embedded computer of this Studio process (created on first use)


def studio_generate(model, tokenizer, prompt: str, max_new_tokens: int = 60, today: datetime.date | None = None, search_fn="default", on_text=None) -> str:
    """The answer to `prompt`. `search_fn`: "default" = real web search unless SHAM_STUDIO_SEARCH=0, None = no search, or any callable(str)->str.
    Two diagnostic prompts for the owner: «#info» reports which path is active; «#raw <text>» answers <text> with the old raw continuation, so the two
    ways can be compared on the same question."""
    prompt, modes = split_modes(prompt)
    stripped = prompt.strip()
    if stripped == "#info":
        cfg = getattr(model, "cfg", None)
        chat_format = str(getattr(cfg, "chat_format", "") or "غير مسجل")
        qwen3 = _uses_qwen3_chat(model)
        return (f"sham_studio_chat فعّال | حوار={_on('SHAM_STUDIO_CHAT')} بحث={_on('SHAM_STUDIO_SEARCH')} تاريخ={_on('SHAM_STUDIO_DATE')} | "
                f"قالب النموذج={chat_format} | مسار Qwen3={'فعّال' if qwen3 else 'غير مستخدم'} | "
                f"التاريخ في السياق الآن: {build_user_text('', today).splitlines()[0] if _on('SHAM_STUDIO_DATE') else '—'}")
    if _uses_qwen3_chat(model) and not stripped.startswith("#"):
        return qwen3_chat(model, tokenizer, prompt, max_new_tokens, temperature=modes.get("temp", 0.0), think_tokens=modes.get("think", 0))
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
    from sham_computer import Computer, chat_generate_with_computer, enabled as _computer_on
    global _COMPUTER
    if _computer_on():          # Sham's own embedded computer (sham_computer.py, ON by default since 2026-11-08)
        _COMPUTER = _COMPUTER or Computer("studio")
    # one token-by-token loop for every reply: a rolling window (the reply is not capped by the 2048-token context), the learned search, the computer
    answer, calls = chat_generate_with_computer(model, wrapped, max_new_tokens, tokenizer, _COMPUTER if _computer_on() else None, search_fn=search_fn,
                                                temperature=modes.get("temp", 0.6), top_k=40, top_p=0.9, on_text=on_text)
    queries = [a["query"] for n, a, _ in calls if n == "search"]
    used = [n for n, _, _ in calls if n != "search"]
    text = tokenizer.decode(answer).strip()
    if text:
        head = ("[بحث: " + " | ".join(queries) + "] " if queries else "") + ("[حاسوب: " + " | ".join(used) + "] " if used else "")
        return head + text
    answer, queries = chat_generate_with_search(model, wrapped, max_new_tokens, tokenizer, search_fn=search_fn,
                                                temperature=modes.get("temp", 0.6), top_k=40, top_p=0.9)
    text = tokenizer.decode(answer).strip()
    if not text:                                    # the model answered nothing: fall back to the raw path rather than return an empty reply
        if _raw_fallback():                         # 2026-10-16: old behaviour only with SHAM_STUDIO_RAW_FALLBACK=1 (line above kept)
            return raw_continuation(model, tokenizer, prompt, max_new_tokens)
        text = _chat_retry(model, tokenizer, prompt, max_new_tokens, today)
    return ("[بحث: " + " | ".join(queries) + "] " + text) if queries else text


if __name__ == "__main__":
    import datetime as _dt

    os.environ["SHAM_INTERNAL_COMPUTER"] = "0"       # these checks are about the chat / search / raw paths; the computer loop has its own self-test (sham_computer.py)
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
    import sham_computer as _sc
    _orig_cc = _sc.chat_generate_with_computer
    _sc.chat_generate_with_computer = lambda *a, **k: ([], [])
    calls = []
    _orig_raw = raw_continuation
    globals()["raw_continuation"] = lambda *a, **k: calls.append(1) or "RAW"
    os.environ["SHAM_STUDIO_RAW_FALLBACK"] = "0"      # the default is ON since 2026-11-08; the chat-retry branch is checked with it switched off
    r = studio_generate(model, Tok(), "سؤال", 8, today=d, search_fn=None)
    assert r and r != "RAW" and not calls, r
    globals()["_chat_retry"], _keep = (lambda *a, **k: "نص النموذج"), _chat_retry
    assert studio_generate(model, Tok(), "سؤال", 8, today=d, search_fn=None) == "نص النموذج" and not calls
    os.environ["SHAM_STUDIO_RAW_FALLBACK"] = "1"
    assert studio_generate(model, Tok(), "سؤال", 8, today=d, search_fn=None) == "RAW" and calls
    os.environ.pop("SHAM_STUDIO_RAW_FALLBACK")
    assert _raw_fallback(), "raw generation must be ON by default (owner's order 2026-11-08)"
    globals()["_chat_retry"], globals()["raw_continuation"], _sd.chat_generate_with_search = _keep, _orig_raw, _orig
    _sc.chat_generate_with_computer = _orig_cc
    assert len(_chat_retry(model, Tok(), "سؤال", 8, today=d)) >= 1
    # the engine's thinking / accuracy / speed header: read, removed, clamped; no header = nothing
    assert split_modes("[[sham temp=0.20 think=300]]\nسؤال") == ("سؤال", {"temp": 0.2, "think": 300})
    assert split_modes("[[sham temp=9 think=99999]]\nx")[1] == {"temp": 1.5, "think": 2048}
    assert split_modes("سؤال عادي") == ("سؤال عادي", {}) and split_modes("[[sham temp=abc]]\nx") == ("x", {})
    class Tok2:                      # specials as single ids: <|im_end|> 398, </think> 399
        vocab_size = 398

        def encode(self, t):
            return [398] if t == "<|im_end|>" else [399] if t == "</think>" else [3 + (ord(c) % 380) for c in t]

        def decode(self, ids):
            return "".join(chr(0x0621 + (i % 40)) for i in ids)

    cfgq = ShamSmallConfig(vocab_size=402, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=1024)
    mq = ShamSmall(cfgq).train(False)
    calls = []
    import generate as _g
    _real = _g.generate_tokens
    _g.generate_tokens = lambda *a, **k: (calls.append(k.get("max_new_tokens")), _real(*a, **k))[1]
    a1 = qwen3_chat(mq, Tok2(), "سؤال", 10, temperature=0.2, think_tokens=6)       # a thought of at most 6 tokens, then the answer
    a0 = qwen3_chat(mq, Tok2(), "سؤال", 10, temperature=0.0, think_tokens=0)       # no thought
    _g.generate_tokens = _real
    assert calls == [6, 10], calls        # the thought + its answer use the guarded loop; the plain no-thought answer uses the rolling window (Sham v1's loop), not generate_tokens
    assert isinstance(a1, str) and isinstance(a0, str)
    # token streaming (the Mini App's live view): the streamed pieces reassemble to a prefix of the one-shot answer
    cfgq3 = ShamSmallConfig(vocab_size=402, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=1024, chat_format="qwen3")
    mq3 = ShamSmall(cfgq3).train(False)
    pieces = list(studio_generate_stream(mq3, Tok2(), "سؤال", 10))
    joined = "".join(pieces)
    full = qwen3_chat(mq3, Tok2(), "سؤال", 10, temperature=0.0, think_tokens=0)
    assert pieces and all(isinstance(p, str) for p in pieces), pieces
    assert joined and full.startswith(joined), (joined, full)
    longer = "".join(studio_generate_stream(mq3, Tok2(), "سؤال", 1500))                  # longer than the 1024-token window: the rolling window goes on, no cap/crash
    assert len(longer) > 10, len(longer)                  # (a random toy model may stop early on its end token; the point is that a request beyond the window works)
    print("sham_studio_chat self-test OK")
