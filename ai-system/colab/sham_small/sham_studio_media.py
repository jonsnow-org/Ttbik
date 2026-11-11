"""
Sham answers with a picture or a sound, from its OWN tokens (owner, 2026-10-12: "why doesn't it respond to image / video / audio requests").

Two ways in, neither a patch:

  generate_any(prompt)      the MODEL decides. The first token it writes after the user's turn is sampled from the text range plus the three media
                            starts (<IMAGE_START>, <AUDIO_START>, <VIDEO_START>); if it writes a media start it goes on to write that span, and the
                            span is decoded by the image / audio tokenizer's decoder. The chat stage trains «ask → <IMAGE_START> tokens» in many phrasings
                            (sham_chat.DRAW_IMAGE / SPEAK_AUDIO / MAKE_VIDEO), so this is the learned behaviour, nothing routes the request for it.
  make_media(kind, caption) the USER decides (a command such as /image): the server begins the span, exactly like serve.py's /generate/image.

What comes out is whatever the model's tokens decode to — at this stage of training mostly noise; that is the honest state, and it is measured by the
tokenizers' and the model's own training, never dressed up. Video IS made from the model's own tokens: it writes one keyframe image span plus a motion
span (motion_tokenizer.py's flow tokens) inside <VIDEO_START>...<VIDEO_END>, and the clip is decoded frame by frame through that motion — real temporal
content, not two stitched stills. NO_VIDEO is returned only when no motion tokenizer is available (an older checkpoint with no motion rows trained), and it
says plainly that this checkpoint has no motion rows (never a slideshow, never an outside generator).

The result is a dict {"type": "text|image|audio|video|notice", "text": ..., "mime": ..., "b64": ...}. This file lives in sham_small, so it reaches the Studio
through the signed hot copy (app.py loads it from there).
"""
from __future__ import annotations

import base64
import io

import os
import torch


# modules that hold the Studio's LIVE state (the loaded model, caches, background jobs): never re-imported from the hot copy
_KEEP_LOADED = frozenset({"serve", "web_access", "sham_general_text", "sham_auto_config", "sham_cell_sync",
                          "sham_trigger_restarter", "sham_bank", "sham_kb", "sham_gguf", "sham_encoder_np"})


def _prefer_own_copies() -> None:
    """When this file runs as the SIGNED hot copy (Studio _hot/sham_small), its sibling modules (model, sham_stream, …) must come from the
    same folder. Live 2026-11-11: ModelScope's build runner kept shipping a cached Oct 29 build, whose deployed model.py was already
    imported by the app, so the hot chat died with "cannot import name 'MOTION_VOCAB_BASE' from 'model'". Drop every already-imported
    module that has a newer sibling here, and put this folder first, so the deployed (possibly stale) copies never shadow the hot ones."""
    import sys as _sys
    here = os.path.dirname(os.path.abspath(__file__))
    if not _sys.path or os.path.abspath(_sys.path[0]) != here:
        _sys.path.insert(0, here)
    for name, mod in list(_sys.modules.items()):
        f = getattr(mod, "__file__", None)
        if not f or "." in name:
            continue
        d = os.path.dirname(os.path.abspath(f))
        if name in _KEEP_LOADED or hasattr(mod, "_state"):
            continue     # live 2026-11-11: dropping `serve` emptied serve._state, so chat failed with KeyError 'model'. Runtime state stays.
        if d != here and os.path.basename(d) == "sham_small" and os.path.isfile(os.path.join(here, name + ".py")):
            _sys.modules.pop(name, None)


_prefer_own_copies()


from model import (
    AUDIO_VOCAB_SIZE,
    IMAGE_VOCAB_BASE,
    IMAGE_VOCAB_SIZE,
    MOTION_VOCAB_BASE,
    MOTION_VOCAB_SIZE,
    SpecialTokens,
    vocab_id_to_motion_token_id,
)

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


def _mp4(frames: torch.Tensor, fps: int = 8) -> bytes:
    """Real MP4 from (num_frames, 3, H, W) frames in [-1, 1] — the model's own
    motion-token output, written by ffmpeg through imageio. This is the same
    encoding path the media-quality gate checks (media_quality.check_mp4), so a
    clip that is a still repeated N times or has a wrong duration is caught
    downstream instead of being shipped."""
    import imageio.v2 as imageio
    import numpy as np
    arr = ((frames.clamp(-1, 1) + 1) * 127.5).byte().permute(0, 2, 3, 1).numpy()
    buf = io.BytesIO()
    with imageio.get_writer(buf, format="mp4", fps=fps, macro_block_size=1) as w:
        for f in arr:
            w.append_data(np.asarray(f))
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


def _video_frames() -> int:
    """Frames per clip. 8 fps, so the 48-frame default is a 6 s clip — the
    owner's floor ("clips from ~6 s up to 5 minutes"); SHAM_VIDEO_FRAMES raises
    it up to the 2400-frame (5 min) ceiling. Each extra frame costs only
    vectors_per_frame motion tokens, not a whole 256-token keyframe."""
    import os
    try:
        return max(48, min(2400, int(os.environ.get("SHAM_VIDEO_FRAMES", "48"))))
    except ValueError:
        return 48


# A video request with no motion tokenizer available (an older checkpoint that
# never trained the motion rows) is the ONE case where this path cannot produce
# a clip. It returns an honest notice — never stitched stills, never a
# fabricated file, never silent. The model's OWN motion-token video is the
# normal path above (_video_result), and the separate video Studio is the
# alternative for a checkpoint with no motion rows.
NO_VIDEO = {"type": "notice", "text": "لا يمكن توليد فيديو من هذه النقطة: لا تحتوي صفوف الحركة (motion) المدرّبة. شام يصنع فيديوه بمولّده وحده، فيلزم تدريب مُرمِّز الحركة (motion_tokenizer) أولًا. لن يُعاد إليك فيديو مُفبرك."}


def _video_chunk_frames() -> int:
    """Frames generated per model pass. One pass writes a keyframe plus this
    many motion frames; longer clips are generated as consecutive passes with a
    sliding motion window, so total duration is bounded by compute, not by the
    model's context length (SHAM_VIDEO_CHUNK, default 12)."""
    import os
    try:
        return max(2, min(64, int(os.environ.get("SHAM_VIDEO_CHUNK", "12"))))
    except ValueError:
        return 12


def _motion_span(model, prefix: list[int], n_frames: int, vpf: int, scale: float):
    """Generate ONE motion block (n_frames frames' worth of flow tokens) after
    `prefix` (which already ends at <MOTION_START>)."""
    from sham_decoding import guided_span
    mot = (MOTION_VOCAB_BASE, MOTION_VOCAB_BASE + MOTION_VOCAB_SIZE)
    forced = [None] * (vpf * n_frames) + [SpecialTokens.MOTION_END]
    allowed = [mot] * (vpf * n_frames) + [None]
    cond = torch.tensor([prefix], dtype=torch.long)
    uncond = torch.tensor([prefix[:2]], dtype=torch.long)
    return guided_span(model, cond, uncond, forced, allowed, scale=scale, temperature=1.0, top_k=40)[0].tolist()


def _long_video_frames(model, image_tokenizer, motion_tokenizer, cond_prefix, uncond_prefix, num_frames: int, scale: float) -> torch.Tensor:
    """A clip of any length: the model writes the first keyframe, then each pass
    writes a fresh motion block whose first frame is the last frame already
    decoded. The conditioning window slides (the last few motion blocks only),
    so a 5-minute clip is many bounded passes, not one impossible sequence —
    the standard autoregressive way long video is generated. Every frame still
    comes from the model's own tokens and is decoded through its own motion."""
    from sham_decoding import guided_span
    from video_tokenizer import decode_clip
    n = image_tokenizer.cfg.tokens_per_image
    vpf = motion_tokenizer.cfg.vectors_per_frame
    img = (IMAGE_VOCAB_BASE, IMAGE_VOCAB_BASE + IMAGE_VOCAB_SIZE)
    # Pass 1: keyframe + first motion block.
    chunk = min(_video_chunk_frames(), num_frames)
    head = cond_prefix + [SpecialTokens.VIDEO_START, SpecialTokens.IMAGE_START]
    forced = [None] * n + [SpecialTokens.IMAGE_END, SpecialTokens.MOTION_START] + [None] * (vpf * (chunk - 1)) + [SpecialTokens.MOTION_END, SpecialTokens.VIDEO_END]
    allowed = [img] * n + [None, None] + [(MOTION_VOCAB_BASE, MOTION_VOCAB_BASE + MOTION_VOCAB_SIZE)] * (vpf * (chunk - 1)) + [None, None]
    cond = torch.tensor([head], dtype=torch.long)
    uncond = torch.tensor([uncond_prefix + [SpecialTokens.VIDEO_START, SpecialTokens.IMAGE_START]], dtype=torch.long)
    span = guided_span(model, cond, uncond, forced, allowed, scale=scale, temperature=1.0, top_k=40)[0].tolist()
    seq = cond[0].tolist() + span
    frames = decode_clip(image_tokenizer, motion_tokenizer, torch.tensor([seq], dtype=torch.long), chunk)[0]
    # Passes 2..: one more motion block per pass, conditioned on the last keyframe
    # and the trailing motion tokens, starting the block at the frame just decoded.
    produced = chunk
    key_tokens = seq[2:2 + n]
    while produced < num_frames:
        step = min(_video_chunk_frames(), num_frames - produced)
        prefix = head + key_tokens + [SpecialTokens.IMAGE_END, SpecialTokens.MOTION_START]
        block = _motion_span(model, prefix, step, vpf, scale)
        flow = torch.tensor([block[:vpf * step]], dtype=torch.long)
        raw = vocab_id_to_motion_token_id(flow).view(1, step, -1)
        prev = frames[-1:].clone()
        for t in range(step):
            prev = motion_tokenizer.decode_frame(prev, raw[:, t])
            frames = torch.cat([frames, prev], dim=0)
        produced += step
    return frames[:num_frames]


def _video_result(model, image_tokenizer, motion_tokenizer, cond_prefix, uncond_prefix, num_frames: int) -> dict:
    """The model's OWN video: it writes one keyframe image span plus a motion
    span (motion_tokenizer.py's flow tokens) for every following frame, all
    inside <VIDEO_START>...<VIDEO_END>. The clip is decoded frame by frame
    through the motion flow, so it is genuinely temporal — not stills stitched.
    Clips longer than one pass are generated as consecutive sliding-window
    passes (_long_video_frames). There is no external pipeline behind this."""
    from video_tokenizer import decode_clip
    from sham_decoding import guided_span
    n = image_tokenizer.cfg.tokens_per_image
    vpf = motion_tokenizer.cfg.vectors_per_frame
    if num_frames <= _video_chunk_frames():
        img = (IMAGE_VOCAB_BASE, IMAGE_VOCAB_BASE + IMAGE_VOCAB_SIZE)
        mot = (MOTION_VOCAB_BASE, MOTION_VOCAB_BASE + MOTION_VOCAB_SIZE)
        deltas = num_frames - 1
        forced = ([SpecialTokens.IMAGE_START] + [None] * n + [SpecialTokens.IMAGE_END, SpecialTokens.MOTION_START]
                  + [None] * (vpf * deltas) + [SpecialTokens.MOTION_END, SpecialTokens.VIDEO_END])
        allowed = ([None] + [img] * n + [None, None] + [mot] * (vpf * deltas) + [None, None])
        cond = torch.tensor([cond_prefix + [SpecialTokens.VIDEO_START]], dtype=torch.long)
        uncond = torch.tensor([uncond_prefix + [SpecialTokens.VIDEO_START]], dtype=torch.long)
        span = guided_span(model, cond, uncond, forced, allowed, scale=_scale(), temperature=1.0, top_k=40)
        seq = torch.cat([cond, span], dim=1)
        frames = decode_clip(image_tokenizer, motion_tokenizer, seq, num_frames)[0]
    else:
        frames = _long_video_frames(model, image_tokenizer, motion_tokenizer, cond_prefix, uncond_prefix, num_frames, _scale())
    return {"type": "video", "mime": "video/mp4", "b64": base64.b64encode(_mp4(frames, fps=8)).decode(), "frames": int(frames.shape[0])}


def make_media(model, tokenizer, image_tokenizer, audio_tokenizer, kind: str, caption: str, motion_tokenizer=None,
               num_frames: int | None = None) -> dict:
    from sham_decoding import media_prompts
    if kind == "video":
        if motion_tokenizer is None:
            return dict(NO_VIDEO)
        cond, uncond = media_prompts("image", tokenizer.encode(caption)[:200], tokenizer, chat=True)
        return _video_result(model, image_tokenizer, motion_tokenizer, cond, uncond, num_frames or _video_frames())
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
                 choose=first_choice, motion_tokenizer=None, num_frames: int | None = None) -> dict:
    """Text unless the MODEL itself starts a picture / sound / clip: see the module docstring."""
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
        if motion_tokenizer is None:
            return dict(NO_VIDEO)
        return _video_result(model, image_tokenizer, motion_tokenizer, wrapped, [SpecialTokens.BOS, wrapped[1]],
                             num_frames or _video_frames())
    return {"type": "text", "text": studio_generate(model, tokenizer, prompt, max_new_tokens, today)}


if __name__ == "__main__":
    import datetime
    import os

    from audio_tokenizer import AudioTokenizer, AudioTokenizerConfig
    from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
    from model import MOTION_VOCAB_SIZE, TOTAL_VOCAB_SIZE, ShamSmall, ShamSmallConfig
    from motion_tokenizer import MotionTokenizer, MotionTokenizerConfig

    class Tok:
        vocab_size = 400

        def encode(self, t):
            return [3 + (ord(c) % 390) for c in t]

        def decode(self, ids):
            return "".join(chr(0x0621 + (i % 40)) for i in ids)

    torch.manual_seed(0)
    total = 400 + 0
    cfg = ShamSmallConfig(vocab_size=TOTAL_VOCAB_SIZE, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=2048)
    model = ShamSmall(cfg).train(False)
    img_tok = ImageTokenizer(ImageTokenizerConfig(image_size=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=IMAGE_VOCAB_SIZE)).train(False)
    aud_tok = AudioTokenizer(AudioTokenizerConfig(n_mels=16, segment_frames=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=AUDIO_VOCAB_SIZE)).train(False)
    mot_tok = MotionTokenizer(MotionTokenizerConfig(grid=4, num_codes=MOTION_VOCAB_SIZE)).train(False)
    os.environ["SHAM_STUDIO_MEDIA_SCALE"] = "1.5"

    r = make_media(model, Tok(), img_tok, aud_tok, "image", "أرنب")
    assert r["type"] == "image" and base64.b64decode(r["b64"])[:8] == b"\x89PNG\r\n\x1a\n", r["type"]
    a = make_media(model, Tok(), img_tok, aud_tok, "audio", "مرحبا")
    assert a["type"] == "audio" and base64.b64decode(a["b64"])[:4] == b"RIFF"
    # Without a motion tokenizer the video path is honestly unavailable (notice), never a slideshow.
    assert make_media(model, Tok(), img_tok, aud_tok, "video", "x")["type"] == "notice"
    import importlib.util
    if importlib.util.find_spec("imageio") is None:   # the Studio installs imageio(-ffmpeg); a bare CI check job may not: stand in for the encoder only
        globals()["_mp4"] = lambda frames, fps=8: b"\x00\x00\x00\x18ftypisom" + bytes(256 + int(frames.shape[0]))
        print("imageio not installed: MP4 encoder replaced by a stub in this self-test (the token/frame path is still exercised)")
    # With the motion tokenizer, the model writes its OWN clip: a real MP4.
    v = make_media(model, Tok(), img_tok, aud_tok, "video", "قطة تجري", motion_tokenizer=mot_tok, num_frames=4)
    assert v["type"] == "video" and v["mime"] == "video/mp4", v["type"]
    mp4 = base64.b64decode(v["b64"])
    assert mp4[4:8] == b"ftyp", mp4[:12]
    assert len(mp4) > 200, len(mp4)
    d = datetime.date(2026, 10, 12)
    # the model decides: when its first token is a media start, a media result comes back; when it is text, text comes back
    assert generate_any(model, Tok(), img_tok, aud_tok, "أعطني صورة أرنب", 6, d, choose=lambda *a, **k: SpecialTokens.IMAGE_START)["type"] == "image"
    assert generate_any(model, Tok(), img_tok, aud_tok, "قل مرحبا", 6, d, choose=lambda *a, **k: SpecialTokens.AUDIO_START)["type"] == "audio"
    assert generate_any(model, Tok(), img_tok, aud_tok, "فيديو", 6, d, choose=lambda *a, **k: SpecialTokens.VIDEO_START)["type"] == "notice"
    vv = generate_any(model, Tok(), img_tok, aud_tok, "فيديو قطة تجري", 6, d, choose=lambda *a, **k: SpecialTokens.VIDEO_START,
                      motion_tokenizer=mot_tok, num_frames=3)
    assert vv["type"] == "video" and base64.b64decode(vv["b64"])[4:8] == b"ftyp"
    # A clip longer than one pass: several sliding-window passes, same model.
    os.environ["SHAM_VIDEO_CHUNK"] = "3"
    long_v = make_media(model, Tok(), img_tok, aud_tok, "video", "رحلة طويلة", motion_tokenizer=mot_tok, num_frames=8)
    assert long_v["type"] == "video" and long_v["frames"] == 8, long_v.get("frames")
    assert base64.b64decode(long_v["b64"])[4:8] == b"ftyp"
    t = generate_any(model, Tok(), img_tok, aud_tok, "مرحبا", 6, d, choose=lambda *a, **k: 5)
    assert t["type"] == "text" and t["text"]
    assert "صورة" in generate_any(model, Tok(), img_tok, aud_tok, "#pmedia أعطني صورة أرنب", 6, d)["text"]
    # the real chooser stays inside text ∪ media starts and returns a valid id
    for _ in range(5):
        c = first_choice(model, [SpecialTokens.BOS, 7, 8], 400)
        assert c < 400 or c in MEDIA_STARTS, c
    print("sham_studio_media self-test OK — including the model's own motion-token video (real MP4).")
