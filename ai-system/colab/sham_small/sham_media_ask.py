"""
Sham reads a picture, a sound or a video and answers a question about it — one function shared by serve.py (/ask/audio, and the
optional `teach` on /ask/image, /ask/video) and the ModelScope Studio (app.py: understand_media), so both paths behave identically.

  media_ids(kind, raw, image_tokenizer, audio_tokenizer, num_frames) -> {"media": ids} | {"frames": [ids...], "audio": ids}
        offset vocabulary ids WITHOUT delimiters, read with the owner's "accept anything" loaders (sham_media_load) and the trained
        tokenizers — the exact ids the chat stage trains on.
  understand(model, tokenizer, image_tokenizer, audio_tokenizer, kind, raw, question, teach=None, ...) -> dict
        the answer is the model's own generation, in the chat stage's layout: <BOS><USER>[media span] question<SHAM> answer.
        `teach` is the USER's own description of what they sent: when given, the pair is kept as a self-learning experience
        (self_learn.record_media_experience → the same guarded queue as /ask/web). Without it, the upload is used once and not kept.

Nothing here changes weights. Offline self-test: python sham_media_ask.py
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import torch

from model import SpecialTokens, image_token_id_to_vocab_id

DEFAULT_QUESTION = {"image": "صف هذه الصورة.", "audio": "اكتب ما يقال في هذا المقطع.", "video": "صف هذا الفيديو."}
KINDS = tuple(DEFAULT_QUESTION)


def max_upload_bytes() -> int:
    return int(float(os.environ.get("SHAM_MEDIA_MAX_UPLOAD_MB", "8")) * 1024 * 1024)


@torch.no_grad()
def _image_ids(image_tokenizer, img: torch.Tensor) -> list[int]:
    grid = image_tokenizer.encode(img.unsqueeze(0) if img.dim() == 3 else img)
    return image_token_id_to_vocab_id(grid.reshape(1, -1))[0].tolist()


def _audio_ids(audio_tokenizer, raw: bytes, max_segments: int) -> list[int]:
    from sham_media_codec import audio_vocab_ids
    from sham_media_load import TARGET_SR, load_audio_any
    wave = load_audio_any(raw)
    if wave is None or wave.size < 1600:
        return []
    return audio_vocab_ids(audio_tokenizer, torch.from_numpy(wave), TARGET_SR, max_segments=max_segments)


def _video_frames(raw: bytes, n: int, size: int) -> torch.Tensor | None:
    from sham_media_load import video_frames_any
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "clip.mp4"
        path.write_bytes(raw)
        frames = video_frames_any(path, n, size)
        if frames is not None:
            return frames
        try:                                          # no PyAV: the bundled ffmpeg (multimodal_media_analysis, as serve.py's /ask/video)
            from multimodal_media_analysis import extract_video_frames
            from sham_media_load import load_image_any
            paths = extract_video_frames(str(path), td, num_frames=n)
            return torch.stack([load_image_any(Path(p).read_bytes(), size) for p in paths]) if paths else None
        except Exception:
            return None


def media_ids(kind: str, raw: bytes, image_tokenizer, audio_tokenizer, num_frames: int = 2) -> dict:
    if kind == "image":
        from sham_media_load import load_image_any
        return {"media": _image_ids(image_tokenizer, load_image_any(raw, image_tokenizer.cfg.image_size))}
    if kind == "audio":
        return {"media": _audio_ids(audio_tokenizer, raw, int(os.environ.get("SHAM_MEDIA_AUDIO_SEGMENTS", "3")))}
    if kind == "video":
        n = max(1, min(int(num_frames), int(os.environ.get("SHAM_MEDIA_VIDEO_MAX_FRAMES", "4"))))
        frames = _video_frames(raw, n, image_tokenizer.cfg.image_size)
        if frames is None:
            return {"frames": [], "audio": []}
        sound = _audio_ids(audio_tokenizer, raw, 1) if audio_tokenizer is not None else []      # the clip's sound, one segment
        return {"frames": [_image_ids(image_tokenizer, f) for f in frames], "audio": sound}
    raise ValueError(f"unknown media kind: {kind}")


def media_span(kind: str, ids: dict) -> list[int]:
    """The span layout of sham_chat.build_media_chat_examples / build_video_chat_examples."""
    if kind == "video":
        span = [SpecialTokens.VIDEO_START]
        for f in ids["frames"]:
            span += [SpecialTokens.IMAGE_START] + f + [SpecialTokens.IMAGE_END]
        if ids.get("audio"):
            span += [SpecialTokens.AUDIO_START] + ids["audio"] + [SpecialTokens.AUDIO_END]
        return span + [SpecialTokens.VIDEO_END]
    start, end = (SpecialTokens.IMAGE_START, SpecialTokens.IMAGE_END) if kind == "image" else (SpecialTokens.AUDIO_START, SpecialTokens.AUDIO_END)
    return [start] + ids["media"] + [end]


@torch.no_grad()
def answer_about(model, tokenizer, span: list[int], question: str, max_new_tokens: int = 60) -> str:
    from generate import generate_tokens
    from sham_decoding import SHAM_TURN, USER_TURN
    prompt = [SpecialTokens.BOS, USER_TURN] + span + tokenizer.encode(question)[:160] + [SHAM_TURN]
    limit = int(getattr(getattr(model, "cfg", None), "max_seq_len", 2048))
    prompt = prompt[-max(8, limit - max_new_tokens - 1):]
    ids = torch.tensor([prompt], dtype=torch.long)
    out = generate_tokens(model, ids, max_new_tokens=max_new_tokens, temperature=0.7, top_k=40, top_p=0.9, eos_id=SpecialTokens.EOS,
                          repetition_penalty=1.3, allowed_ranges=[(0, tokenizer.vocab_size)] * max_new_tokens)
    return tokenizer.decode([i for i in out[0, ids.shape[1]:].tolist() if i != SpecialTokens.EOS and i < tokenizer.vocab_size])


def keep_experience(kind: str, ids: dict, teach: str | None, state: dict | None = None) -> dict:
    """Queue the user's (media, description) pair; start the guarded learning round when a batch waits (exactly as /ask/web does)."""
    out: dict = {"queued": False}
    if not (teach or "").strip():
        return out
    from self_learn import learn_in_background, pending, record_media_experience
    if kind == "video":
        rec = record_media_experience("video", teach, frame_ids=ids.get("frames"), audio_ids=ids.get("audio"))
    else:
        rec = record_media_experience(kind, teach, ids.get("media"))
    out.update(queued=rec["queued"], pending=rec.get("pending", pending()))
    if not rec["queued"]:
        out["reason"] = rec.get("reason", "")
    elif state is not None and state.get("model") is not None and learn_in_background(state):
        out["learning_started"] = True
    return out


def understand(model, tokenizer, image_tokenizer, audio_tokenizer, kind: str, raw: bytes, question: str | None = None,
               teach: str | None = None, num_frames: int = 2, max_new_tokens: int = 60, state: dict | None = None) -> dict:
    kind = (kind or "").strip().lower()
    if kind not in KINDS:
        return {"type": "notice", "text": f"نوع غير معروف: {kind}"}
    if not raw or len(raw) > max_upload_bytes():
        return {"type": "notice", "text": "الملف فارغ أو أكبر من الحد المسموح."}
    ids = media_ids(kind, raw, image_tokenizer, audio_tokenizer, num_frames)
    if not (ids.get("media") or ids.get("frames")):
        return {"type": "notice", "text": "تعذّرت قراءة الملف."}
    q = (question or "").strip() or DEFAULT_QUESTION[kind]
    answer = answer_about(model, tokenizer, media_span(kind, ids), q, max_new_tokens)
    return {"type": "text", "text": answer, "answer": answer, **keep_experience(kind, ids, teach, state)}


if __name__ == "__main__":
    import io

    import numpy as np
    import soundfile as sf
    from PIL import Image

    from audio_tokenizer import AudioTokenizer, AudioTokenizerConfig
    from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
    from model import AUDIO_VOCAB_SIZE, IMAGE_VOCAB_SIZE, ShamSmall, ShamSmallConfig, TOTAL_VOCAB_SIZE

    class Tok:
        vocab_size = 400

        def encode(self, t):
            return [3 + (ord(c) % 390) for c in t]

        def decode(self, ids):
            return "".join(chr(0x0621 + (i % 40)) for i in ids)

    torch.manual_seed(0)
    model = ShamSmall(ShamSmallConfig(vocab_size=TOTAL_VOCAB_SIZE, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64,
                                      max_seq_len=2048)).train(False)
    img_tok = ImageTokenizer(ImageTokenizerConfig(image_size=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32,
                                                  num_codes=IMAGE_VOCAB_SIZE)).train(False)
    aud_tok = AudioTokenizer(AudioTokenizerConfig(n_mels=16, segment_frames=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32,
                                                  num_codes=AUDIO_VOCAB_SIZE)).train(False)
    with tempfile.TemporaryDirectory() as td:
        os.environ["SHAM_SELF_LEARN_DIR"] = str(Path(td) / "sl")
        os.environ["SHAM_SELF_LEARN_BATCH"] = "999"
        b = io.BytesIO()
        Image.new("RGB", (64, 40), (200, 30, 30)).save(b, format="PNG")
        png = b.getvalue()
        b = io.BytesIO()
        sf.write(b, (0.3 * np.sin(np.linspace(0, 2000, 16000))).astype("float32"), 16000, format="WAV")
        wav = b.getvalue()
        r = understand(model, Tok(), img_tok, aud_tok, "image", png, "ما هذا؟")
        assert r["type"] == "text" and not r["queued"], r                       # no description → used once, not kept
        r = understand(model, Tok(), img_tok, aud_tok, "image", png, None, teach="مربع أحمر على خلفية حمراء")
        assert r["queued"] and r["pending"] == 1, r
        r = understand(model, Tok(), img_tok, aud_tok, "audio", wav, None, teach="نغمة ثابتة لثانية واحدة")
        assert r["type"] == "text" and r["queued"], r
        assert understand(model, Tok(), img_tok, aud_tok, "image", b"not an image" * 0, "x")["type"] == "notice"
        assert understand(model, Tok(), img_tok, aud_tok, "gif", png)["type"] == "notice"
        # a real video (bundled ffmpeg), frames + its sound
        import subprocess

        import imageio_ffmpeg
        clip = Path(td) / "c.mp4"
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=4:duration=2", "-f", "lavfi",
                        "-i", "sine=frequency=440:duration=2", "-shortest", "-pix_fmt", "yuv420p", str(clip)], check=True, capture_output=True)
        ids = media_ids("video", clip.read_bytes(), img_tok, aud_tok, 2)
        assert len(ids["frames"]) == 2 and all(len(f) == img_tok.cfg.tokens_per_image for f in ids["frames"]), ids.keys()
        r = understand(model, Tok(), img_tok, aud_tok, "video", clip.read_bytes(), "ماذا يحدث؟", teach="شاشة اختبار ملوّنة مع نغمة")
        assert r["type"] == "text" and r["queued"] and r["pending"] == 3, r
        span = media_span("video", ids)
        assert span[0] == SpecialTokens.VIDEO_START and span[-1] == SpecialTokens.VIDEO_END
    print("sham_media_ask self-test OK")
