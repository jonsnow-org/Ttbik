"""
Sham answers with a picture or a sound, from its OWN tokens (owner, 2026-10-12: "why doesn't it respond to image / video / audio requests").

Two ways in, neither a patch:

  generate_any(prompt)      the MODEL decides. The first token it writes after the user's turn is sampled from the text range plus the three media
                            starts (<IMAGE_START>, <AUDIO_START>, <VIDEO_START>); if it writes a media start it goes on to write that span, and the
                            span is decoded by the image / audio tokenizer's decoder. The chat stage trains «ask → <IMAGE_START> tokens» in many phrasings
                            (sham_chat.DRAW_IMAGE / SPEAK_AUDIO / MAKE_VIDEO), so this is the learned behaviour, nothing routes the request for it.
  make_media(kind, caption) the USER decides (a command such as /image): the server begins the span, exactly like serve.py's /generate/image.

What comes out is whatever the model's tokens decode to — at this stage of training mostly noise; that is the honest state, and it is measured by the
tokenizers' and the model's own training, never dressed up. Video is not produced on this server yet (four frames of 256 tokens each is more than a
2-core CPU can write in a Telegram request); a video request returns a plain status line, not a made-up clip.

The result is a dict {"type": "text|image|audio|notice", "text": ..., "mime": ..., "b64": ...}. This file lives in sham_small, so it reaches the Studio
through the signed hot copy (app.py loads it from there).
"""
from __future__ import annotations

import base64
import io

import torch

from model import AUDIO_VOCAB_SIZE, IMAGE_VOCAB_SIZE, SpecialTokens

MEDIA_STARTS = (SpecialTokens.IMAGE_START, SpecialTokens.AUDIO_START, SpecialTokens.VIDEO_START)
SAMPLE_RATE = 16000


def _scale() -> float:
    import os
    try:
        return float(os.environ.get("SHAM_STUDIO_MEDIA_SCALE", "2.0"))
    except ValueError:
        return 2.0


def _png(image_tokenizer, raw_tokens: torch.Tensor) -> bytes:
    from PIL import Image
    grid_size = image_tokenizer.cfg.latent_grid_size
    with torch.no_grad():
        decoded = image_tokenizer.decode(raw_tokens.view(1, grid_size, grid_size))[0]
    pixels = ((decoded.clamp(-1, 1) + 1) * 127.5).byte().permute(1, 2, 0).numpy()
    buf = io.BytesIO()
    Image.fromarray(pixels, mode="RGB").save(buf, format="PNG")
    return buf.getvalue()


def _wav(audio_tokenizer, raw_tokens: torch.Tensor) -> bytes:
    import soundfile as sf

    from mel_spectrogram import mel_spectrogram_to_waveform
    cfg = audio_tokenizer.cfg
    with torch.no_grad():
        mel = audio_tokenizer.decode(raw_tokens.view(1, cfg.latent_mel_bins, cfg.latent_time_steps))[0]
    # the parameters the tokenizer was trained with (sham_decoding.install_on_serve uses the same)
    wave = mel_spectrogram_to_waveform(mel, SAMPLE_RATE, n_fft=512, hop_length=160, griffin_lim_iters=32)
    buf = io.BytesIO()
    sf.write(buf, wave.numpy(), SAMPLE_RATE, format="WAV")
    return buf.getvalue()


def _write_span(model, cond_prefix: list[int], uncond_prefix: list[int], kind: str, n: int, scale: float) -> torch.Tensor:
    """cond/uncond prefixes WITHOUT the span's start id. Returns cond+start+span, so generate.extract_*_tokens can read it back."""
    from sham_decoding import _media_plan, guided_span
    start, forced, allowed = _media_plan(kind, n)
    cond = torch.tensor([cond_prefix + [start]], dtype=torch.long)
    uncond = torch.tensor([uncond_prefix + [start]], dtype=torch.long)
    span = guided_span(model, cond, uncond, forced, allowed, scale=scale, temperature=1.0, top_k=40)
    return torch.cat([cond, span], dim=1)


def _image_result(model, image_tokenizer, cond_prefix, uncond_prefix) -> dict:
    from generate import extract_image_tokens
    n = image_tokenizer.cfg.tokens_per_image
    seq = _write_span(model, cond_prefix, uncond_prefix, "image", n, _scale())
    return {"type": "image", "mime": "image/png", "b64": base64.b64encode(_png(image_tokenizer, extract_image_tokens(seq, n))).decode()}


def _audio_result(model, audio_tokenizer, cond_prefix, uncond_prefix) -> dict:
    from generate import extract_audio_tokens
    n = audio_tokenizer.cfg.tokens_per_segment
    seq = _write_span(model, cond_prefix, uncond_prefix, "audio", n, _scale())
    return {"type": "audio", "mime": "audio/wav", "b64": base64.b64encode(_wav(audio_tokenizer, extract_audio_tokens(seq, n))).decode()}


NO_VIDEO = {"type": "notice", "text": "طلب فيديو: توليد الفيديو لم يصبح متاحاً بعد على هذا الخادم."}


def make_media(model, tokenizer, image_tokenizer, audio_tokenizer, kind: str, caption: str) -> dict:
    """The user chose the kind (a command): begin that span with the dialogue prompt the model was trained on."""
    from sham_decoding import media_prompts
    if kind == "video":
        return dict(NO_VIDEO)
    cond, uncond = media_prompts(kind, tokenizer.encode(caption)[:200], tokenizer, chat=True)
    if kind == "image":
        return _image_result(model, image_tokenizer, cond, uncond)
    if kind == "audio":
        return _audio_result(model, audio_tokenizer, cond, uncond)
    raise ValueError(kind)


@torch.no_grad()
def first_choice(model, wrapped: list[int], text_vocab: int, temperature: float = 0.6, top_k: int = 40, generator=None) -> int:
    """The model's own first token after the user's turn, sampled from text ∪ {the three media starts}."""
    logits = model(torch.tensor([wrapped], dtype=torch.long))[0][0, -1].float()
    allowed = torch.zeros_like(logits, dtype=torch.bool)
    allowed[:text_vocab] = True
    for t in MEDIA_STARTS:
        allowed[t] = True
    logits = logits.masked_fill(~allowed, float("-inf")) / max(temperature, 1e-5)
    k = min(top_k, int(allowed.sum()))
    # top-k over the allowed ids, but a media start is never cut by it when the model really prefers it (it is kept if it is in the top-k)
    top = torch.topk(logits, k)
    probs = torch.softmax(top.values, dim=-1)
    pick = torch.multinomial(probs, 1, generator=generator)
    return int(top.indices[pick])


@torch.no_grad()
def media_preference(model, tokenizer, prompt: str, today=None) -> str:
    """The model's own probability (over text ∪ media starts) that its first token is a picture / sound / video start, for this request."""
    from sham_decoding import chat_prompt_ids
    from sham_studio_chat import build_user_text
    wrapped = chat_prompt_ids(tokenizer.encode(build_user_text(prompt, today))[-384:])
    logits = model(torch.tensor([wrapped], dtype=torch.long))[0][0, -1].float()
    allowed = torch.zeros_like(logits, dtype=torch.bool)
    allowed[:tokenizer.vocab_size] = True
    for t in MEDIA_STARTS:
        allowed[t] = True
    probs = torch.softmax(logits.masked_fill(~allowed, float("-inf")), dim=-1)
    names = {SpecialTokens.IMAGE_START: "صورة", SpecialTokens.AUDIO_START: "صوت", SpecialTokens.VIDEO_START: "فيديو"}
    return " | ".join(f"{names[t]}: {float(probs[t]) * 100:.4f}%" for t in MEDIA_STARTS) + f" | نص: {float(probs[:tokenizer.vocab_size].sum()) * 100:.2f}%"


def generate_any(model, tokenizer, image_tokenizer, audio_tokenizer, prompt: str, max_new_tokens: int = 60, today=None,
                 choose=first_choice) -> dict:
    """Text unless the MODEL itself starts a picture / sound: see the module docstring."""
    from sham_decoding import chat_prompt_ids
    from sham_studio_chat import build_user_text, studio_generate
    stripped = prompt.strip()
    if stripped.startswith("#pmedia "):      # diagnostic for the owner: how likely is it that the model, by itself, starts a picture / sound / clip for this text?
        return {"type": "text", "text": media_preference(model, tokenizer, stripped[8:], today)}
    if stripped == "#info" or stripped.startswith("#raw "):
        return {"type": "text", "text": studio_generate(model, tokenizer, prompt, max_new_tokens, today)}
    ids = tokenizer.encode(build_user_text(prompt, today))[-384:]
    wrapped = chat_prompt_ids(ids)
    first = choose(model, wrapped, tokenizer.vocab_size)
    if first == SpecialTokens.IMAGE_START:
        return _image_result(model, image_tokenizer, wrapped, [SpecialTokens.BOS, wrapped[1]])
    if first == SpecialTokens.AUDIO_START:
        return _audio_result(model, audio_tokenizer, wrapped, [SpecialTokens.BOS, wrapped[1]])
    if first == SpecialTokens.VIDEO_START:
        return dict(NO_VIDEO)
    return {"type": "text", "text": studio_generate(model, tokenizer, prompt, max_new_tokens, today)}


if __name__ == "__main__":
    import datetime
    import os

    from audio_tokenizer import AudioTokenizer, AudioTokenizerConfig
    from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
    from model import ShamSmall, ShamSmallConfig

    class Tok:
        vocab_size = 400

        def encode(self, t):
            return [3 + (ord(c) % 390) for c in t]

        def decode(self, ids):
            return "".join(chr(0x0621 + (i % 40)) for i in ids)

    torch.manual_seed(0)
    total = 400 + 0
    cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=2048)
    model = ShamSmall(cfg).train(False)
    img_tok = ImageTokenizer(ImageTokenizerConfig(image_size=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=IMAGE_VOCAB_SIZE)).train(False)
    aud_tok = AudioTokenizer(AudioTokenizerConfig(n_mels=16, segment_frames=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=AUDIO_VOCAB_SIZE)).train(False)
    os.environ["SHAM_STUDIO_MEDIA_SCALE"] = "1.5"

    r = make_media(model, Tok(), img_tok, aud_tok, "image", "أرنب")
    assert r["type"] == "image" and base64.b64decode(r["b64"])[:8] == b"\x89PNG\r\n\x1a\n", r["type"]
    a = make_media(model, Tok(), img_tok, aud_tok, "audio", "مرحبا")
    assert a["type"] == "audio" and base64.b64decode(a["b64"])[:4] == b"RIFF"
    assert make_media(model, Tok(), img_tok, aud_tok, "video", "x")["type"] == "notice"
    d = datetime.date(2026, 10, 12)
    # the model decides: when its first token is a media start, a media result comes back; when it is text, text comes back
    assert generate_any(model, Tok(), img_tok, aud_tok, "أعطني صورة أرنب", 6, d, choose=lambda *a, **k: SpecialTokens.IMAGE_START)["type"] == "image"
    assert generate_any(model, Tok(), img_tok, aud_tok, "قل مرحبا", 6, d, choose=lambda *a, **k: SpecialTokens.AUDIO_START)["type"] == "audio"
    assert generate_any(model, Tok(), img_tok, aud_tok, "فيديو", 6, d, choose=lambda *a, **k: SpecialTokens.VIDEO_START)["type"] == "notice"
    t = generate_any(model, Tok(), img_tok, aud_tok, "مرحبا", 6, d, choose=lambda *a, **k: 5)
    assert t["type"] == "text" and t["text"]
    assert "صورة" in generate_any(model, Tok(), img_tok, aud_tok, "#pmedia أعطني صورة أرنب", 6, d)["text"]
    # the real chooser stays inside text ∪ media starts and returns a valid id
    for _ in range(5):
        c = first_choice(model, [SpecialTokens.BOS, 7, 8], 400)
        assert c < 400 or c in MEDIA_STARTS, c
    print("sham_studio_media self-test OK")
