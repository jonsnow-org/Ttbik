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
  3. BOS for media prompts: stage 2 trains caption->image as
     <BOS> caption <IMAGE_START>..., but serve.py's /generate/image,
     /audio and /video send the caption without <BOS>. The wrappers add it.
  4. <EOS> is kept reachable: generate.generate_tokens applies
     allowed_ranges=[(0, text_vocab)] literally, which excludes <EOS>, so
     serve.py's text replies could never stop and turned into noise after
     the real answer. guarded_generate_tokens always leaves <EOS> allowed.
  5. Audio inverse: serve.py inverts mel with n_fft=256, hop=64, while the
     trained audio tokenizer's mels use n_fft=512, hop=160
     (mel_spectrogram.waveform_to_mel_spectrogram defaults) — that
     mismatch alone turns a 2.56 s segment into ~1 s of noise. The wrapper
     forces the training parameters.
"""

from __future__ import annotations

import torch

import generate as _generate
from model import SpecialTokens, TEXT_VOCAB_SIZE

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
            if allowed is not None and eos_id is not None and not (allowed[0] <= eos_id < allowed[1]):
                # generate.generate_tokens masks <EOS> out whenever sampling is
                # limited to the text range — so a text reply could NEVER end
                # and ran on as noise to max_new_tokens. Keep <EOS> allowed.
                mask = torch.full_like(last, float("-inf"))
                mask[:, allowed[0]:allowed[1]] = 0.0
                mask[:, eos_id] = 0.0
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


def install_on_serve(serve_module, chat: bool, max_prompt_tokens: int = 384) -> None:
    """Runtime wrap of serve.py's generation names (serve.py itself is not
    edited). chat=True only when the served checkpoint went through the
    chat stage — an older checkpoint never saw the turn markers."""
    def text_gen(model, prompt_ids, max_new_tokens, **kw):
        ids = prompt_ids[0].tolist()
        is_plain_text = prompt_ids.shape[0] == 1 and ids and all(i < TEXT_VOCAB_SIZE for i in ids)
        if chat and is_plain_text:
            wrapped = torch.tensor([chat_prompt_ids(ids[-max_prompt_tokens:])], dtype=torch.long, device=prompt_ids.device)
            out = guarded_generate_tokens(model, wrapped, max_new_tokens, **kw)
            return torch.cat([prompt_ids, out[:, wrapped.shape[1]:]], dim=1)
        return guarded_generate_tokens(model, prompt_ids, max_new_tokens, **kw)

    def with_bos(fn):
        def wrapped(model, prompt_ids, *a, **kw):
            if prompt_ids.shape[1] and int(prompt_ids[0, 0]) == SpecialTokens.BOS:
                return fn(model, prompt_ids, *a, **kw)
            bos = torch.full((prompt_ids.shape[0], 1), SpecialTokens.BOS, dtype=torch.long, device=prompt_ids.device)
            # Drop the added <BOS> again so the caller's own prompt-length
            # slicing (serve.py's video endpoint) still lines up.
            return fn(model, torch.cat([bos, prompt_ids], dim=1), *a, **kw)[:, 1:]
        return wrapped

    serve_module.generate_tokens = text_gen
    for name in ("generate_image", "generate_audio", "generate_video"):
        if hasattr(serve_module, name):
            setattr(serve_module, name, with_bos(getattr(_generate, name)))
    if hasattr(serve_module, "mel_spectrogram_to_waveform"):
        from mel_spectrogram import mel_spectrogram_to_waveform as _inv

        def mel_inverse(mel, sample_rate, n_fft=512, hop_length=160, griffin_lim_iters=32):
            # Always the training parameters (see module docstring, item 5).
            return _inv(mel, sample_rate, n_fft=512, hop_length=160, griffin_lim_iters=max(griffin_lim_iters, 32))
        serve_module.mel_spectrogram_to_waveform = mel_inverse
