"""
Nova Small — real HTTP serving backend. Owner spec: "الخطوة الحالية هي
الربط والدفع والاختبار... الاختبار يحتاج ان يكون نموذجنا مبني ومجهز
للاختبار على تطبيق ويب او بوت" (the current step is linking, pushing,
and testing — testing needs the model built and ready to test via a
web app or a bot).

Mirrors the exact architecture the CURRENT live Nova already uses
(see ai-system/app/main.py + ai-system/streamlit_app.py): ONE backend
that does all the real work, thin clients (a web UI, later a bot) that
only call it over HTTP — so every interface always behaves identically,
and adding a Telegram bot later needs zero changes here, just another
thin client hitting these same endpoints. Deliberately a SEPARATE
service from ai-system/app/main.py (the live, deployed production
Nova) rather than added into it — NovaSmall is a wholly different,
still-untrained model tree; nothing here should be able to affect the
live production bot in any way.

HONEST, stated up front rather than discovered by surprise: no real
large-scale training run has happened yet (that remains the
deliberately separate final stage — see this project's own history).
Every endpoint below is REAL — a real forward pass through a real
NovaSmall model, real KV-cache generation, real tokenizer round trips,
real image/audio/video decoding — but the model's weights are either
freshly randomly initialized or loaded from whatever checkpoint exists
so far, so generated CONTENT will look like structured noise (a real
PNG/WAV/MP4 file, valid and playable, just not meaningful) until real
training happens. This service tests the PLUMBING (does a prompt
really turn into a real image/audio/video file, end to end, with no
crashes) — not output quality, which is a training-data question, not
a serving-code one.
"""

import io
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
from model import AUDIO_VOCAB_SIZE, IMAGE_VOCAB_SIZE, NovaSmall, SpecialTokens
from text_tokenizer import NovaTextTokenizer, train_text_tokenizer
from video_tokenizer import decode_video

_FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
_SAMPLE_RATE = 16000

app = FastAPI(title="Nova Small — serving backend (pre-training smoke test)")

# Real, small, CPU-friendly configs for this smoke-test service — real
# training will produce a real checkpoint.pt this same load_model()
# function already knows how to load instead (see its own docstring);
# swapping to it is a config change, not a code change.
_state: dict = {}


def load_model(checkpoint_path: str | None = None) -> None:
    """Loads a real trained checkpoint if one is given and exists;
    otherwise builds a fresh, randomly-initialized model at a small,
    fast-on-CPU config purely so this service's PLUMBING (every
    endpoint, every tensor shape, every file format) can be tested for
    real right now, without waiting for the actual training stage."""
    if checkpoint_path and Path(checkpoint_path).exists():
        model, step, _ = load_checkpoint(checkpoint_path)
        print(f"loaded a REAL trained checkpoint from {checkpoint_path} (step {step})")
    else:
        from model import NovaSmallConfig

        cfg = NovaSmallConfig(
            vocab_size=42256, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=512
        )
        model = NovaSmall(cfg)
        print("no trained checkpoint given/found — serving a FRESH, RANDOMLY-INITIALIZED small model "
              "(real plumbing test only; output content will look like structured noise until real "
              "training happens)")
    model.eval()

    # num_codes MUST equal model.py's IMAGE_VOCAB_SIZE/AUDIO_VOCAB_SIZE
    # exactly (see model.py's own inline comment on those constants) —
    # generate_image()/generate_audio() restrict sampling to the full
    # architectural [0, IMAGE_VOCAB_SIZE)/[0, AUDIO_VOCAB_SIZE) range
    # regardless of what a particular tokenizer instance's codebook
    # actually holds, so a smaller codebook here would let the model
    # legitimately sample an id past the end of this instance's real
    # codebook table — exactly the IndexError caught by running this
    # server for real. Every OTHER dimension (image_size, base_channels,
    # code_dim) is still shrunk for CPU speed; only num_codes is fixed.
    image_cfg = ImageTokenizerConfig(image_size=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=IMAGE_VOCAB_SIZE)
    audio_cfg = AudioTokenizerConfig(n_mels=16, segment_frames=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=AUDIO_VOCAB_SIZE)

    bootstrap_corpus = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8")
    bootstrap_corpus.write(
        "Nova Small is a real from scratch multimodal model. مرحباً هذا اختبار حقيقي للنموذج. " * 100
    )
    bootstrap_corpus.close()

    _state["model"] = model
    _state["text_tokenizer"] = train_text_tokenizer([bootstrap_corpus.name], vocab_size=800)
    _state["image_tokenizer"] = ImageTokenizer(image_cfg).eval()
    _state["audio_tokenizer"] = AudioTokenizer(audio_cfg).eval()
    Path(bootstrap_corpus.name).unlink()


@app.on_event("startup")
def _startup() -> None:
    load_model()


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
    model: NovaSmall = _state["model"]
    return {
        "status": "ok",
        "model_params": model.count_parameters(),
        "note": "pre-training smoke test — real plumbing, not yet real trained weights",
    }


@app.post("/generate/text")
def generate_text_endpoint(req: TextRequest) -> dict:
    model: NovaSmall = _state["model"]
    tokenizer: NovaTextTokenizer = _state["text_tokenizer"]
    prompt_ids = torch.tensor([tokenizer.encode(req.prompt)], dtype=torch.long)

    # Real, stated caveat for THIS pre-training smoke-test server only:
    # the bootstrap tokenizer here only has real merges for the ~800
    # ids it was actually trained on, far fewer than the model's full
    # architectural 32,000-slot text range — sampling outside that
    # range produces ids this specific tokenizer instance has no real
    # mapping for. Restricting sampling to [0, tokenizer.vocab_size)
    # keeps every generated id decodable. Once the real, full
    # 32,000-entry production tokenizer is trained (a data-gathering
    # task, not a code one — see text_tokenizer.py's own docstring),
    # this restriction becomes a no-op, since the two ranges will match.
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
    model: NovaSmall = _state["model"]
    tokenizer: NovaTextTokenizer = _state["text_tokenizer"]
    image_tokenizer: ImageTokenizer = _state["image_tokenizer"]

    prompt_ids = torch.tensor([tokenizer.encode(req.prompt)], dtype=torch.long)
    tokens_per_image = image_tokenizer.cfg.tokens_per_image
    sequence = generate_image(model, prompt_ids, tokens_per_image=tokens_per_image, top_k=40)
    raw_tokens = extract_image_tokens(sequence, tokens_per_image)
    grid_size = image_tokenizer.cfg.latent_grid_size
    grid = raw_tokens.view(1, grid_size, grid_size)

    with torch.no_grad():
        decoded = image_tokenizer.decode(grid)[0]  # (3, H, W) in [-1, 1]
    pixels = ((decoded.clamp(-1, 1) + 1) * 127.5).byte().permute(1, 2, 0).numpy()
    image = Image.fromarray(pixels, mode="RGB")

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return Response(content=buffer.getvalue(), media_type="image/png")


@app.post("/generate/audio")
def generate_audio_endpoint(req: MediaRequest) -> Response:
    model: NovaSmall = _state["model"]
    tokenizer: NovaTextTokenizer = _state["text_tokenizer"]
    audio_tokenizer: AudioTokenizer = _state["audio_tokenizer"]

    prompt_ids = torch.tensor([tokenizer.encode(req.prompt)], dtype=torch.long)
    tokens_per_segment = audio_tokenizer.cfg.tokens_per_segment
    sequence = generate_audio(model, prompt_ids, tokens_per_segment=tokens_per_segment, top_k=40)
    raw_tokens = extract_audio_tokens(sequence, tokens_per_segment)
    grid = raw_tokens.view(1, audio_tokenizer.cfg.latent_mel_bins, audio_tokenizer.cfg.latent_time_steps)

    with torch.no_grad():
        mel = audio_tokenizer.decode(grid)[0]  # (1, n_mels, segment_frames) in [-1, 1]
    waveform = mel_spectrogram_to_waveform(mel, _SAMPLE_RATE, n_fft=256, hop_length=64, griffin_lim_iters=16)

    buffer = io.BytesIO()
    sf.write(buffer, waveform.numpy(), _SAMPLE_RATE, format="WAV")
    return Response(content=buffer.getvalue(), media_type="audio/wav")


@app.post("/generate/video")
def generate_video_endpoint(req: VideoRequest) -> Response:
    model: NovaSmall = _state["model"]
    tokenizer: NovaTextTokenizer = _state["text_tokenizer"]
    image_tokenizer: ImageTokenizer = _state["image_tokenizer"]

    prompt_ids = torch.tensor([tokenizer.encode(req.prompt)], dtype=torch.long)
    tokens_per_image = image_tokenizer.cfg.tokens_per_image
    sequence = generate_video(model, prompt_ids, num_frames=req.num_frames, tokens_per_image=tokens_per_image, top_k=40)

    video_span = sequence[:, prompt_ids.shape[1]:]
    with torch.no_grad():
        frames = decode_video(image_tokenizer, video_span, num_frames=req.num_frames)[0]  # (num_frames, 3, H, W)

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
