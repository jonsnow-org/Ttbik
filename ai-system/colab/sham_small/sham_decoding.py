"""
Sham's anti-loop decoding — the owner's live bot showed replies stuck on
one word ("سامي سامي سامي ..."), gray images and one-second noise audio.
Part of that is training (fixed in stage 2 / the chat stage), part is how
tokens are picked at inference. This module fixes the inference side
WITHOUT editing serve.py or generate.py (engineer-owned files): the bot
notebook calls install_on_serve(serve) once, which swaps in wrapped
functions at runtime.

What it adds:
  1. guarded_generate_tokens(): the same loop as generate.generate_tokens
     (same signature, same forced_ids/allowed_ranges/stop_ids semantics)
     plus, for TEXT tokens only:
       - repetition penalty over everything already generated,
       - frequency penalty (grows with every repeat, so a word can't win
         forever),
       - no-repeat n-gram ban (an n-gram already produced can't be
         produced again — the direct cure for "سامي سامي سامي"),
       - loop breaker: if the last `loop_window` tokens are one short
         pattern repeated, that pattern's next token is banned.
     Image/audio tokens are never penalized (a sky really does repeat the
     same blue patch many times).
  2. Chat framing: when a chat-trained checkpoint is served, a plain text
     prompt is wrapped as <BOS><USER> prompt <SHAM> — the exact shape
     sham_chat.py trains on — so the bot talks in the format the model
     learned. The returned tensor still starts with the caller's original
     prompt, so serve.py's own `out[0, len(prompt):]` slicing stays right.
  3. Media prompts in the trained shape (<BOS> caption <IMAGE_START>…, or the
     chat shape after the chat stage — serve.py sends the caption without
     <BOS>), sampled with self-guidance (see guided_span) for pictures, sound
     and video frames that follow the description.
  4. <EOS> is kept reachable: generate.generate_tokens applies
     allowed_ranges=[(0, text_vocab)] literally, which excludes <EOS>, so
     serve.py's text replies could never stop and turned into noise after
     the real answer. guarded_generate_tokens always leaves <EOS> allowed.
  5. Audio inverse: serve.py inverts mel with n_fft=256, hop=64, while the
     trained audio tokenizer's mels use n_fft=512, hop=160
     (mel_spectrogram.waveform_to_mel_spectrogram defaults) — that
     mismatch alone turns a 2.56 s segment into ~1 s of noise. The wrapper
     forces the training parameters.
  6. Learned search: a chat-trained Sham may write <SEARCH_START> query
     <SEARCH_END>; the real search runs and its text comes back inside
     <RESULT_START>…<RESULT_END> (chat_generate_with_search).
"""

from __future__ import annotations

import torch

import generate as _generate
from model import AUDIO_VOCAB_BASE, AUDIO_VOCAB_SIZE, IMAGE_VOCAB_BASE, IMAGE_VOCAB_SIZE, SpecialTokens, TEXT_VOCAB_SIZE

# Two of the reserved control ids model.py leaves free ("3 of
# NUM_SPECIAL_TOKENS's 16 reserved ids remain free"): turn markers for
# Sham's own dialogue format. Defined here (not in model.py) so the
# engineer's file stays untouched; the assert below fails loudly if model.py
# ever assigns these ids to something else.
USER_TURN = SpecialTokens._base + 13
SHAM_TURN = SpecialTokens._base + 14
_taken = {v for k, v in vars(SpecialTokens).items() if k.isupper() and isinstance(v, int)}
assert USER_TURN not in _taken and SHAM_TURN not in _taken, "model.py now uses the chat turn ids — pick new ones"


def _banned_by_ngram(history: list[int], n: int) -> set[int]:
    """Tokens that would complete an n-gram already present in history."""
    if n <= 1 or len(history) < n:
        return set()
    prefix = tuple(history[-(n - 1):])
    banned = set()
    for i in range(len(history) - n + 1):
        if tuple(history[i:i + n - 1]) == prefix:
            banned.add(history[i + n - 1])
    return banned


def _loop_token(history: list[int], window: int) -> int | None:
    """If the tail of history is one short pattern (period 1..window//2)
    repeated at least twice, return the token that would continue it."""
    for period in range(1, window // 2 + 1):
        if len(history) < 2 * period:
            break
        if history[-period:] == history[-2 * period:-period]:
            return history[-period]
    return None


def penalize_text_logits(
    logits: torch.Tensor,
    history: list[int],
    repetition_penalty: float = 1.3,
    frequency_penalty: float = 0.4,
    no_repeat_ngram: int = 3,
    loop_window: int = 8,
) -> torch.Tensor:
    """logits: (vocab,) for one sequence. Only text ids (< TEXT_VOCAB_SIZE)
    in history are penalized."""
    text_hist = [t for t in history if t < TEXT_VOCAB_SIZE]
    if not text_hist:
        return logits
    logits = logits.clone()
    counts: dict[int, int] = {}
    for t in text_hist:
        counts[t] = counts.get(t, 0) + 1
    ids = torch.tensor(list(counts), device=logits.device)
    freq = torch.tensor(list(counts.values()), dtype=logits.dtype, device=logits.device)
    vals = logits[ids]
    vals = torch.where(vals > 0, vals / repetition_penalty, vals * repetition_penalty)
    logits[ids] = vals - frequency_penalty * freq
    banned = _banned_by_ngram(text_hist, no_repeat_ngram)
    looping = _loop_token(text_hist, loop_window)
    if looping is not None:
        banned.add(looping)
    if banned:
        logits[torch.tensor(sorted(banned), device=logits.device)] = float("-inf")
    return logits


@torch.no_grad()
def guarded_generate_tokens(
    model,
    prompt_ids: torch.Tensor,
    max_new_tokens: int,
    temperature: float = 1.0,
    top_k: int | None = None,
    top_p: float | None = None,
    eos_id: int | None = None,
    forced_ids: list[int | None] | None = None,
    allowed_ranges: list[tuple[int, int] | None] | None = None,
    stop_ids: set[int] | None = None,
    repetition_penalty: float = 1.3,
    frequency_penalty: float = 0.4,
    no_repeat_ngram: int = 3,
    guard: bool = True,
    extra_allowed: tuple[int, ...] = (),
) -> torch.Tensor:
    """Drop-in replacement for generate.generate_tokens (same arguments,
    same return shape) with the text penalties above. Penalties look only
    at GENERATED tokens, never the prompt — repeating the user's own words
    in an answer is fine. guard=False keeps only the <EOS> fix (used by
    sham_eval.py to measure the model's OWN tendency to loop)."""
    model.eval()
    batch = prompt_ids.shape[0]
    device = prompt_ids.device
    generated = prompt_ids
    past = None
    finished = torch.zeros(batch, dtype=torch.bool, device=device)
    new_tokens: list[list[int]] = [[] for _ in range(batch)]
    next_input = prompt_ids
    for step in range(max_new_tokens):
        logits, _, past = model(next_input, past_key_values=past, use_cache=True)
        last = logits[:, -1, :].float()
        forced = forced_ids[step] if forced_ids is not None else None
        if forced is not None:
            next_token = torch.full((batch, 1), forced, dtype=torch.long, device=device)
        else:
            allowed = allowed_ranges[step] if allowed_ranges is not None else None
            if guard:
                last = torch.stack([
                    penalize_text_logits(last[b], new_tokens[b], repetition_penalty, frequency_penalty, no_repeat_ngram)
                    for b in range(batch)
                ])
            keep = [i for i in ((eos_id,) if eos_id is not None else ()) + tuple(extra_allowed)
                    if allowed is not None and not (allowed[0] <= i < allowed[1])]
            if keep:
                # generate.generate_tokens masks <EOS> out whenever sampling is
                # limited to the text range — so a text reply could NEVER end
                # and ran on as noise to max_new_tokens. Keep <EOS> (and any
                # extra control ids, e.g. the search markers) allowed.
                mask = torch.full_like(last, float("-inf"))
                mask[:, allowed[0]:allowed[1]] = 0.0
                mask[:, keep] = 0.0
                last, allowed = last + mask, None
            next_token = _generate._sample_from_logits(
                last, temperature=temperature, top_k=top_k, top_p=top_p, allowed_range=allowed
            )
        if eos_id is not None:
            next_token = torch.where(finished.unsqueeze(1), torch.full_like(next_token, eos_id), next_token)
            finished = finished | (next_token.squeeze(1) == eos_id)
        if stop_ids:
            finished = finished | torch.isin(next_token.squeeze(1), torch.tensor(sorted(stop_ids), device=device))
        for b in range(batch):
            new_tokens[b].append(int(next_token[b, 0]))
        generated = torch.cat([generated, next_token], dim=1)
        next_input = next_token
        if (eos_id is not None or stop_ids) and bool(finished.all()):
            break
    return generated


def chat_prompt_ids(prompt_ids: list[int], history: list[tuple[list[int], list[int]]] | None = None) -> list[int]:
    """<BOS> [<USER> q <SHAM> a <EOS>]* <USER> prompt <SHAM> — the same
    layout sham_chat.build_chat_example() trains on."""
    ids = [SpecialTokens.BOS]
    for q, a in history or []:
        ids += [USER_TURN] + q + [SHAM_TURN] + a + [SpecialTokens.EOS]
    return ids + [USER_TURN] + prompt_ids + [SHAM_TURN]


# ------------------------------------------------------------ self-guidance for media
# Classifier-free guidance, applied to Sham's own two ways of seeing a picture:
# stage 2 / the chat stage train BOTH "caption -> image" (conditional) and
# "image -> caption", whose prefix <BOS><IMAGE_START> image... is exactly the
# UNconditional distribution of images. So without any retraining, each image
# token can be sampled from  uncond + s·(cond − uncond): the caption's pull is
# amplified, which in autoregressive image models turns muddy/gray averages
# into images that actually follow the description.

def _media_plan(kind: str, n: int, per_frame: int = 0):
    """(start_id, forced_ids, allowed_ranges) for the span after <start>."""
    img = (IMAGE_VOCAB_BASE, IMAGE_VOCAB_BASE + IMAGE_VOCAB_SIZE)
    aud = (AUDIO_VOCAB_BASE, AUDIO_VOCAB_BASE + AUDIO_VOCAB_SIZE)
    if kind == "image":
        return SpecialTokens.IMAGE_START, [None] * n + [SpecialTokens.IMAGE_END], [img] * n + [None]
    if kind == "audio":
        return SpecialTokens.AUDIO_START, [None] * n + [SpecialTokens.AUDIO_END], [aud] * n + [None]
    forced, allowed = [], []
    for _ in range(n):  # video: n frames of per_frame image tokens
        forced += [SpecialTokens.IMAGE_START] + [None] * per_frame + [SpecialTokens.IMAGE_END]
        allowed += [None] + [img] * per_frame + [None]
    return SpecialTokens.VIDEO_START, forced + [SpecialTokens.VIDEO_END], allowed + [None]


@torch.no_grad()
def guided_span(model, cond_ids: torch.Tensor, uncond_ids: torch.Tensor, forced_ids, allowed_ranges,
                scale: float = 3.0, temperature: float = 1.0, top_k: int | None = 40) -> torch.Tensor:
    """cond_ids/uncond_ids: (1, len), both already ending in the span's start
    token. Returns the generated span (1, len(forced_ids))."""
    model.eval()
    past_c = past_u = None
    nc, nu = cond_ids, uncond_ids
    out = []
    for step, forced in enumerate(forced_ids):
        lc, _, past_c = model(nc, past_key_values=past_c, use_cache=True)
        lu, _, past_u = model(nu, past_key_values=past_u, use_cache=True)
        if forced is not None:
            tok = forced
        else:
            c, u = lc[:, -1].float(), lu[:, -1].float()
            logits = u + scale * (c - u)
            tok = int(_generate._sample_from_logits(logits, temperature=temperature, top_k=top_k,
                                                   allowed_range=allowed_ranges[step])[0, 0])
        out.append(tok)
        nc = nu = torch.tensor([[tok]], dtype=torch.long, device=cond_ids.device)
    return torch.tensor([out], dtype=torch.long, device=cond_ids.device)


DRAW_PROMPT = {"image": "ارسم: {}", "audio": "انطق: {}", "video": "أنشئ فيديو: {}"}


def media_prompts(kind: str, caption_ids: list[int], tokenizer, chat: bool) -> tuple[list[int], list[int]]:
    """(conditional, unconditional) prefixes, each WITHOUT the span start id —
    the exact shapes the model was trained on."""
    if chat:
        head, tail = tokenizer.encode(DRAW_PROMPT[kind].split("{}")[0]), tokenizer.encode(DRAW_PROMPT[kind].split("{}")[1])
        return ([SpecialTokens.BOS, USER_TURN] + head + caption_ids + tail + [SHAM_TURN],
                [SpecialTokens.BOS, USER_TURN])
    return [SpecialTokens.BOS] + caption_ids, [SpecialTokens.BOS]


# ------------------------------------------------------------ learned search
def web_search_text(query: str, max_results: int = 3, max_chars: int = 600) -> str:
    """Short snippets for a query (DuckDuckGo, same provider web_access.py uses)."""
    try:
        from ddgs import DDGS
        with DDGS() as d:
            hits = list(d.text(query, region="xa-ar", max_results=max_results))
    except Exception as exc:
        print(f"search failed ({exc})")
        return ""
    return " ".join(h.get("body", "") for h in hits)[:max_chars]


@torch.no_grad()
def chat_generate_with_search(model, wrapped: torch.Tensor, max_new_tokens: int, tokenizer, search_fn=web_search_text,
                              max_calls: int = 2, **kw) -> tuple[list[int], list[str]]:
    """The model itself decides to search: it writes <SEARCH_START> query
    <SEARCH_END>; generation pauses, the real search runs, its text comes back
    inside <RESULT_START>…<RESULT_END>, and the model continues its answer.
    Returns (answer ids after the last result, queries made)."""
    kw = dict(kw)
    kw.pop("allowed_ranges", None)
    ids, queries, produced = wrapped, [], 0
    extras = (SpecialTokens.SEARCH_START, SpecialTokens.SEARCH_END) if search_fn else ()
    while produced < max_new_tokens:
        remaining = max_new_tokens - produced
        out = guarded_generate_tokens(model, ids, remaining, allowed_ranges=[(0, tokenizer.vocab_size)] * remaining,
                                      stop_ids={SpecialTokens.SEARCH_END}, extra_allowed=extras, **kw)
        new = out[0, ids.shape[1]:].tolist()
        produced += len(new)
        seq = out[0].tolist()
        if search_fn and new and new[-1] == SpecialTokens.SEARCH_END and len(queries) < max_calls \
                and SpecialTokens.SEARCH_START in seq[wrapped.shape[1]:]:
            start = len(seq) - 1 - seq[::-1].index(SpecialTokens.SEARCH_START)
            q = tokenizer.decode([t for t in seq[start + 1:-1] if t < TEXT_VOCAB_SIZE]).strip()
            queries.append(q)
            result = tokenizer.encode(search_fn(q) or "لا توجد نتائج.")[:200]
            ids = torch.cat([out, torch.tensor([[SpecialTokens.RESULT_START] + result + [SpecialTokens.RESULT_END]],
                                               dtype=torch.long, device=out.device)], dim=1)
            continue
        ids = out
        break
    seq = ids[0, wrapped.shape[1]:].tolist()
    if SpecialTokens.RESULT_END in seq:
        seq = seq[len(seq) - seq[::-1].index(SpecialTokens.RESULT_END):]
    return [t for t in seq if t < TEXT_VOCAB_SIZE], queries


def install_on_serve(serve_module, chat: bool, max_prompt_tokens: int = 384, search: bool = False,
                     guidance: float = 3.0) -> None:
    """Runtime wrap of serve.py's generation names (serve.py itself is not
    edited). chat=True only when the served checkpoint went through the
    chat stage — an older checkpoint never saw the turn markers. search=True
    lets a chat-trained Sham run its own learned web searches."""
    def tokenizer():
        return serve_module._state["text_tokenizer"]

    def text_gen(model, prompt_ids, max_new_tokens, **kw):
        ids = prompt_ids[0].tolist()
        is_plain_text = prompt_ids.shape[0] == 1 and ids and all(i < TEXT_VOCAB_SIZE for i in ids)
        if chat and is_plain_text:
            wrapped = torch.tensor([chat_prompt_ids(ids[-max_prompt_tokens:])], dtype=torch.long, device=prompt_ids.device)
            answer, queries = chat_generate_with_search(model, wrapped, max_new_tokens, tokenizer(),
                                                        search_fn=web_search_text if search else None, **kw)
            if queries:
                answer = tokenizer().encode("[بحث: " + " | ".join(queries) + "] ") + answer
            return torch.cat([prompt_ids, torch.tensor([answer], dtype=torch.long, device=prompt_ids.device)], dim=1)
        return guarded_generate_tokens(model, prompt_ids, max_new_tokens, **kw)

    def media(kind):
        def gen(model, prompt_ids, *a, num_frames: int = 1, tokens_per_image: int = 0, tokens_per_segment: int = 0,
                temperature: float = 1.0, top_k: int | None = 40, **_):
            if a:  # positional tokens_per_* (serve passes keywords today)
                tokens_per_image = tokens_per_segment = a[0]
            n = {"image": tokens_per_image, "audio": tokens_per_segment, "video": num_frames}[kind]
            start, forced, allowed = _media_plan(kind, n, tokens_per_image)
            cond, uncond = media_prompts(kind, prompt_ids[0].tolist(), tokenizer(), chat)
            dev = prompt_ids.device
            cond_t = torch.tensor([cond + [start]], dtype=torch.long, device=dev)
            uncond_t = torch.tensor([uncond + [start]], dtype=torch.long, device=dev)
            span = guided_span(model, cond_t, uncond_t, forced, allowed, scale=guidance,
                               temperature=temperature, top_k=top_k)
            # Same layout generate.generate_image/_audio/_video return:
            # the caller's prompt, the start id, then the span.
            return torch.cat([prompt_ids, torch.tensor([[start]], device=dev), span], dim=1)
        return gen

    serve_module.generate_tokens = text_gen
    for kind in ("image", "audio", "video"):
        if hasattr(serve_module, f"generate_{kind}"):
            setattr(serve_module, f"generate_{kind}", media(kind))
    if hasattr(serve_module, "mel_spectrogram_to_waveform"):
        from mel_spectrogram import mel_spectrogram_to_waveform as _inv

        def mel_inverse(mel, sample_rate, n_fft=512, hop_length=160, griffin_lim_iters=32):
            # Always the training parameters (see module docstring, item 5).
            return _inv(mel, sample_rate, n_fft=512, hop_length=160, griffin_lim_iters=max(griffin_lim_iters, 32))
        serve_module.mel_spectrogram_to_waveform = mel_inverse
