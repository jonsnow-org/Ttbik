"""
Sham — real HTTP serving backend. Owner spec: the current step is linking,
pushing, and testing — testing needs the model built and ready to test via a
web app or a bot.

Mirrors the exact architecture the CURRENT live Nova already uses
(see ai-system/app/main.py + ai-system/streamlit_app.py): ONE backend
that does all the real work, thin clients (a web UI, later a bot) that
only call it over HTTP — so every interface always behaves identically,
and adding a Telegram bot later needs zero changes here, just another
thin client hitting these same endpoints. Deliberately a SEPARATE
service from ai-system/app/main.py (the live, deployed production
Nova) rather than added into it — ShamSmall is a wholly different,
still-untrained model tree; nothing here should be able to affect the
live production bot in any way.

What is served (owner directive 2026-09-28): only a real trained Sham — the
checkpoint named by SHAM_SMALL_CHECKPOINT_PATH, the text tokenizer saved with
it, and the image/audio tokenizers it was trained with (found next to the
checkpoint). If any of them is missing the server refuses to start instead of
falling back to random weights. An untrained model is available for plumbing
diagnostics only, behind SHAM_DIAGNOSTIC_UNTRAINED=1 (verify_serve.py).

/generate/medical/image, /ask/image, /ask/video, and /ask/web are open endpoints
(no organization API key, no fixed medical category gate). Callers send a
free-form prompt or question; uploaded ask media is used once for one answer
and is not stored or trained on. /ask/web may optionally run one self-learn
weight step when SHAM_SELF_LEARN=1 and learn=true (saves a NEW checkpoint,
never overwrites final_chat.pt).
"""

import io
import os
import subprocess
import tempfile
from pathlib import Path

import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel

import imageio_ffmpeg

from audio_tokenizer import AudioTokenizer, AudioTokenizerConfig
from checkpoint import load_checkpoint
from generate import (
    build_image_understanding_prompt,
    build_video_understanding_prompt,
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
from multimodal_media_analysis import extract_video_frames
from text_tokenizer import ShamTextTokenizer, train_text_tokenizer
from video_tokenizer import decode_video

_FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
_SAMPLE_RATE = 16000

app = FastAPI(title="Sham — serving backend")

# Filled by load_model(): the trained model, its tokenizers, and a short
# description of which checkpoint is being served (shown by /health).
_state: dict = {}


def _load_image_tensor(raw_bytes: bytes, image_size: int) -> torch.Tensor:
    image = Image.open(io.BytesIO(raw_bytes)).convert("RGB").resize((image_size, image_size))
    tensor = torch.tensor(list(image.getdata()), dtype=torch.float32).view(image_size, image_size, 3)
    return (tensor.permute(2, 0, 1) / 127.5 - 1.0).unsqueeze(0)


def _trained_media_tokenizer(kind: str, checkpoint_path: str):
    """The image/audio tokenizer the served model was trained with: an explicit
    SHAM_{KIND}_TOKENIZER_PATH, else the one saved next to the checkpoint
    (every Sham stage publishes its tokenizers with its checkpoint)."""
    from tokenizer_select import select_pretrained_tokenizer

    explicit = os.environ.get(f"SHAM_{kind.upper()}_TOKENIZER_PATH")
    root = Path(explicit).parent if explicit else Path(checkpoint_path).parent
    picked = select_pretrained_tokenizer(kind, root)
    return picked[0].to("cpu").eval() if picked else None


def load_model(checkpoint_path: str | None = None, tokenizer_path: str | None = None) -> None:
    """Serves ONLY a real trained Sham: the checkpoint, the text tokenizer saved
    with it, and the image/audio tokenizers it was trained with. Owner directive
    (2026-09-28): no silent random fallback in the real service — if anything is
    missing the server refuses to start and says what is missing. A random
    untrained model exists only for plumbing diagnostics, and only when
    SHAM_DIAGNOSTIC_UNTRAINED=1 is set explicitly (verify_serve.py does that)."""
    diagnostic = os.environ.get("SHAM_DIAGNOSTIC_UNTRAINED") == "1"
    real = bool(checkpoint_path and Path(checkpoint_path).exists())
    if not real and not diagnostic:
        raise RuntimeError(f"لا توجد نقطة حفظ مدرّبة لشام في {checkpoint_path!r} — الخادم يعمل بنموذج مدرّب فقط.")

    step = 0
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
        # num_codes MUST equal model.py's IMAGE_VOCAB_SIZE/AUDIO_VOCAB_SIZE — see model.py.
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
    _state["checkpoint_path"] = checkpoint_path
    _state["tokenizer_path"] = tokenizer_path
    _state["train_step"] = step if real else 0


@app.on_event("startup")
def _startup() -> None:
    # Real forward-compatibility: once real training produces an
    # actual checkpoint, pointing this exact same deployment at it is
    # an env var change, not a code change or a redeploy of different
    # code — load_model() already knows how to load a real checkpoint
    # (see its own docstring); this is just wiring that up to the
    # outside world.
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


class MedicalGenerationRequest(BaseModel):
    """Free-form medical image generation: no fixed category gate."""
    prompt: str
    notes: str | None = None


@app.get("/health")
def health() -> dict:
    model: ShamSmall = _state["model"]
    from self_learn import pending, self_learn_enabled

    return {
        "status": "ok",
        "model_params": model.count_parameters(),
        "note": f"شام: {_state.get('source', '')}",
        "train_step": _state.get("train_step", 0),
        "self_learn": self_learn_enabled(),
        "self_learn_pending": pending(),
        "self_learn_last": _state.get("last_self_learn"),
    }


@app.post("/generate/text")
def generate_text_endpoint(req: TextRequest) -> dict:
    model: ShamSmall = _state["model"]
    tokenizer: ShamTextTokenizer = _state["text_tokenizer"]
    prompt_ids = torch.tensor([tokenizer.encode(req.prompt)], dtype=torch.long)

    # Sampling stays inside [0, tokenizer.vocab_size) so every generated id
    # is decodable by the tokenizer the checkpoint was trained with.
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
        decoded = image_tokenizer.decode(grid)[0]  # (3, H, W) in [-1, 1]
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
        mel = audio_tokenizer.decode(grid)[0]  # (1, n_mels, segment_frames) in [-1, 1]
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


@app.post("/generate/medical/image")
def generate_medical_image_endpoint(req: MedicalGenerationRequest) -> Response:
    model: ShamSmall = _state["model"]
    tokenizer: ShamTextTokenizer = _state["text_tokenizer"]
    image_tokenizer: ImageTokenizer = _state["image_tokenizer"]

    prompt_text = req.prompt
    if req.notes:
        prompt_text = f"{prompt_text} {req.notes}"

    prompt_ids = torch.tensor([tokenizer.encode(prompt_text)], dtype=torch.long)
    tokens_per_image = image_tokenizer.cfg.tokens_per_image
    sequence = generate_image(model, prompt_ids, tokens_per_image=tokens_per_image, top_k=40)
    raw_tokens = extract_image_tokens(sequence, tokens_per_image)
    grid = raw_tokens.view(1, image_tokenizer.cfg.latent_grid_size, image_tokenizer.cfg.latent_grid_size)

    with torch.no_grad():
        decoded = image_tokenizer.decode(grid)[0]
    pixels = ((decoded.clamp(-1, 1) + 1) * 127.5).byte().permute(1, 2, 0).numpy()
    image = Image.fromarray(pixels, mode="RGB")

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return Response(content=buffer.getvalue(), media_type="image/png")


@app.post("/ask/image")
async def ask_image_endpoint(
    file: UploadFile = File(...),
    question: str = Form(...),
) -> dict:
    model: ShamSmall = _state["model"]
    tokenizer: ShamTextTokenizer = _state["text_tokenizer"]
    image_tokenizer: ImageTokenizer = _state["image_tokenizer"]

    raw_bytes = await file.read()
    image_tensor = _load_image_tensor(raw_bytes, image_tokenizer.cfg.image_size)
    question_ids = tokenizer.encode(question)
    prompt = build_image_understanding_prompt(image_tokenizer, image_tensor, question_ids)

    max_new_tokens = 60
    # Same real, stated caveat as /generate/text: constrain sampling to
    # this bootstrap tokenizer's own real vocab range until the actual
    # production tokenizer is trained (see that endpoint's own comment).
    out = generate_tokens(
        model, prompt, max_new_tokens=max_new_tokens,
        temperature=0.8, top_k=50, top_p=0.95, eos_id=SpecialTokens.EOS,
        allowed_ranges=[(0, tokenizer.vocab_size)] * max_new_tokens,
    )
    answer_ids = [i for i in out[0, prompt.shape[1]:].tolist() if i != SpecialTokens.EOS]
    answer = tokenizer.decode(answer_ids)

    return {"answer": answer}


@app.post("/ask/video")
async def ask_video_endpoint(
    file: UploadFile = File(...),
    question: str = Form(...),
    num_frames: int = Form(2),
) -> dict:
    model: ShamSmall = _state["model"]
    tokenizer: ShamTextTokenizer = _state["text_tokenizer"]
    image_tokenizer: ImageTokenizer = _state["image_tokenizer"]

    raw_bytes = await file.read()
    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = Path(tmpdir) / "upload.mp4"
        video_path.write_bytes(raw_bytes)
        # Frames only — this endpoint never uses the audio track, and
        # requiring one would reject a real, valid silent video for no
        # reason (a real case caught by testing with an actual silent
        # clip, not a hypothetical). Reuses the exact real ffmpeg
        # extraction already built and verified in
        # multimodal_media_analysis.py.
        frame_paths = extract_video_frames(str(video_path), tmpdir, num_frames=num_frames)
        frames = [
            _load_image_tensor(Path(p).read_bytes(), image_tokenizer.cfg.image_size)[0]
            for p in frame_paths
        ]
        video_tensor = torch.stack(frames, dim=0).unsqueeze(0)  # (1, num_frames, 3, H, W)

    question_ids = tokenizer.encode(question)
    prompt = build_video_understanding_prompt(image_tokenizer, video_tensor, question_ids)

    max_new_tokens = 60
    out = generate_tokens(
        model, prompt, max_new_tokens=max_new_tokens,
        temperature=0.8, top_k=50, top_p=0.95, eos_id=SpecialTokens.EOS,
        allowed_ranges=[(0, tokenizer.vocab_size)] * max_new_tokens,
    )
    answer_ids = [i for i in out[0, prompt.shape[1]:].tolist() if i != SpecialTokens.EOS]
    answer = tokenizer.decode(answer_ids)

    return {"answer": answer}



# Self-learn live web ask (POST /ask/web) — see ask_web_api.py / self_learn.py
from ask_web_api import register_ask_web

register_ask_web(app, _state)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
