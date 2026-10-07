"""
Sham — real HTTP serving backend.
"""

import io
import os
import subprocess
import tempfile
from pathlib import Path

import soundfile as sf
import torch
from fastapi import FastAPI
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel

import imageio_ffmpeg

from audio_tokenizer import AudioTokenizer, AudioTokenizerConfig
from checkpoint import load_checkpoint
from generate import (
    extract_audio_tokens,
    extract_image_tokens,
    generate_audio,
    generate_image,
    generate_tokens,
    generate_video,
)
from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
from mel_spectrogram import mel_spectrogram_to_waveform
from model import AUDIO_VOCAB_SIZE, IMAGE_VOCAB_SIZE, ShamSmall, SpecialTokens
from text_tokenizer import ShamTextTokenizer, train_text_tokenizer
from video_tokenizer import decode_video

_FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
_SAMPLE_RATE = 16000

app = FastAPI(title="Sham — serving backend")
_state: dict = {}


def _trained_media_tokenizer(kind: str, checkpoint_path: str):
    from tokenizer_select import select_pretrained_tokenizer
    explicit = os.environ.get(f"SHAM_{kind.upper()}_TOKENIZER_PATH")
    root = Path(explicit).parent if explicit else Path(checkpoint_path).parent
    picked = select_pretrained_tokenizer(kind, root)
    return picked[0].to("cpu").eval() if picked else None


def load_model(checkpoint_path: str | None = None, tokenizer_path: str | None = None) -> None:
    diagnostic = os.environ.get("SHAM_DIAGNOSTIC_UNTRAINED") == "1"
    real = bool(checkpoint_path and Path(checkpoint_path).exists())
    if not real and not diagnostic:
        raise RuntimeError(f"لا توجد نقطة حفظ مدرّبة لشام في {checkpoint_path!r} — الخادم يعمل بنموذج مدرّب فقط.")

    if real:
        model, step, _ = load_checkpoint(checkpoint_path)
        _state["source"] = f"{Path(checkpoint_path).name} — الخطوة {step:,}"
        print(f"loaded the trained checkpoint {checkpoint_path} (step {step})")
    else:
        from model import ShamSmallConfig
        cfg = ShamSmallConfig(
            vocab_size=42256, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=512
        )
        model = ShamSmall(cfg)
        _state["source"] = "تشخيص فقط: نموذج غير مدرّب (SHAM_DIAGNOSTIC_UNTRAINED=1)"
        print("DIAGNOSTIC MODE: serving an untrained model to test plumbing only")
    model.eval()

    if tokenizer_path and Path(tokenizer_path).exists():
        text_tokenizer = ShamTextTokenizer.load(tokenizer_path)
        print(f"loaded the saved text tokenizer from {tokenizer_path} (vocab={text_tokenizer.vocab_size})")
    elif not diagnostic:
        raise RuntimeError(f"أداة تقسيم النص المحفوظة مع النقطة غير موجودة ({tokenizer_path!r}).")
    else:
        bootstrap_corpus = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8")
        bootstrap_corpus.write("Sham plumbing diagnostic. مرحباً هذا فحص للتوصيل فقط. " * 100)
        bootstrap_corpus.close()
        text_tokenizer = train_text_tokenizer([bootstrap_corpus.name], vocab_size=800)
        Path(bootstrap_corpus.name).unlink()

    image_tokenizer = _trained_media_tokenizer("image", checkpoint_path) if real else None
    audio_tokenizer = _trained_media_tokenizer("audio", checkpoint_path) if real else None
    if (image_tokenizer is None or audio_tokenizer is None) and not diagnostic:
        missing = [k for k, t in (("image", image_tokenizer), ("audio", audio_tokenizer)) if t is None]
        raise RuntimeError(f"أداة ترميز {'/'.join(missing)} المدرّبة غير موجودة بجانب النقطة — الخادم يعمل بأدوات شام المدرّبة فقط.")
    if image_tokenizer is None:
        image_tokenizer = ImageTokenizer(ImageTokenizerConfig(
            image_size=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=IMAGE_VOCAB_SIZE)).eval()
    if audio_tokenizer is None:
        audio_tokenizer = AudioTokenizer(AudioTokenizerConfig(
            n_mels=16, segment_frames=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32,
            num_codes=AUDIO_VOCAB_SIZE)).eval()

    _state["model"] = model
    _state["text_tokenizer"] = text_tokenizer
    _state["image_tokenizer"] = image_tokenizer
    _state["audio_tokenizer"] = audio_tokenizer


@app.on_event("startup")
def _startup() -> None:
    load_model(
        checkpoint_path=os.environ.get("SHAM_SMALL_CHECKPOINT_PATH"),
        tokenizer_path=os.environ.get("SHAM_SMALL_TOKENIZER_PATH"),
    )


class TextRequest(BaseModel):
    prompt: str
    max_new_tokens: int = 40


class MediaRequest(BaseModel):
    prompt: str


class VideoRequest(BaseModel):
    prompt: str
    num_frames: int = 2


@app.get("/health")
def health() -> dict:
    model: ShamSmall = _state["model"]
    return {
        "status": "ok",
        "model_params": model.count_parameters(),
        "note": f"شام: {_state.get('source', '')}",
    }


@app.post("/generate/text")
def generate_text_endpoint(req: TextRequest) -> dict:
    model: ShamSmall = _state["model"]
    tokenizer: ShamTextTokenizer = _state["text_tokenizer"]
    prompt_ids = torch.tensor([tokenizer.encode(req.prompt)], dtype=torch.long)
    out = generate_tokens(
        model, prompt_ids, max_new_tokens=req.max_new_tokens,
        temperature=0.8, top_k=50, top_p=0.95, eos_id=SpecialTokens.EOS,
        allowed_ranges=[(0, tokenizer.vocab_size)] * req.max_new_tokens,
    )
    generated_ids = out[0, prompt_ids.shape[1]:].tolist()
    generated_ids = [i for i in generated_ids if i != SpecialTokens.EOS]
    text = tokenizer.decode(generated_ids)
    return {"text": text}


@app.post("/generate/image")
def generate_image_endpoint(req: MediaRequest) -> Response:
    model: ShamSmall = _state["model"]
    tokenizer: ShamTextTokenizer = _state["text_tokenizer"]
    image_tokenizer: ImageTokenizer = _state["image_tokenizer"]
    prompt_ids = torch.tensor([tokenizer.encode(req.prompt)], dtype=torch.long)
    tokens_per_image = image_tokenizer.cfg.tokens_per_image
    sequence = generate_image(model, prompt_ids, tokens_per_image=tokens_per_image, top_k=40)
    raw_tokens = extract_image_tokens(sequence, tokens_per_image)
    grid_size = image_tokenizer.cfg.latent_grid_size
    grid = raw_tokens.view(1, grid_size, grid_size)
    with torch.no_grad():
        decoded = image_tokenizer.decode(grid)[0]
    pixels = ((decoded.clamp(-1, 1) + 1) * 127.5).byte().permute(1, 2, 0).numpy()
    image = Image.fromarray(pixels, mode="RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return Response(content=buffer.getvalue(), media_type="image/png")


@app.post("/generate/audio")
def generate_audio_endpoint(req: MediaRequest) -> Response:
    model: ShamSmall = _state["model"]
    tokenizer: ShamTextTokenizer = _state["text_tokenizer"]
    audio_tokenizer: AudioTokenizer = _state["audio_tokenizer"]
    prompt_ids = torch.tensor([tokenizer.encode(req.prompt)], dtype=torch.long)
    tokens_per_segment = audio_tokenizer.cfg.tokens_per_segment
    sequence = generate_audio(model, prompt_ids, tokens_per_segment=tokens_per_segment, top_k=40)
    raw_tokens = extract_audio_tokens(sequence, tokens_per_segment)
    grid = raw_tokens.view(1, audio_tokenizer.cfg.latent_mel_bins, audio_tokenizer.cfg.latent_time_steps)
    with torch.no_grad():
        mel = audio_tokenizer.decode(grid)[0]
    waveform = mel_spectrogram_to_waveform(mel, _SAMPLE_RATE, n_fft=256, hop_length=64, griffin_lim_iters=16)
    buffer = io.BytesIO()
    sf.write(buffer, waveform.numpy(), _SAMPLE_RATE, format="WAV")
    return Response(content=buffer.getvalue(), media_type="audio/wav")


@app.post("/generate/video")
def generate_video_endpoint(req: VideoRequest) -> Response:
    model: ShamSmall = _state["model"]
    tokenizer: ShamTextTokenizer = _state["text_tokenizer"]
    image_tokenizer: ImageTokenizer = _state["image_tokenizer"]
    prompt_ids = torch.tensor([tokenizer.encode(req.prompt)], dtype=torch.long)
    tokens_per_image = image_tokenizer.cfg.tokens_per_image
    sequence = generate_video(model, prompt_ids, num_frames=req.num_frames, tokens_per_image=tokens_per_image, top_k=40)
    video_span = sequence[:, prompt_ids.shape[1]:]
    with torch.no_grad():
        frames = decode_video(image_tokenizer, video_span, num_frames=req.num_frames)[0]
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        for i, frame in enumerate(frames):
            pixels = ((frame.clamp(-1, 1) + 1) * 127.5).byte().permute(1, 2, 0).numpy()
            Image.fromarray(pixels, mode="RGB").save(tmp / f"frame_{i:04d}.png")
        output_path = tmp / "out.mp4"
        subprocess.run(
            [_FFMPEG, "-y", "-framerate", "2", "-i", str(tmp / "frame_%04d.png"),
             "-c:v", "libx264", "-pix_fmt", "yuv420p", str(output_path)],
            check=True, capture_output=True,
        )
        video_bytes = output_path.read_bytes()
    return Response(content=video_bytes, media_type="video/mp4")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
