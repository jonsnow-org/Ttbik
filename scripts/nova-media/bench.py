"""Can a free 2-4 core CPU make media for Nova? Times one image (1-step distilled diffusion models) and one Arabic sentence of speech. Read-only measurement.

  python scripts/nova-media/bench.py
"""
import os
import sys
import time
import traceback

import torch

torch.set_num_threads(os.cpu_count() or 2)
print("cpus:", os.cpu_count(), flush=True)


def image(model_id: str, steps: int, size: int = 512, guidance: float = 0.0) -> None:
    from diffusers import AutoPipelineForText2Image
    t0 = time.time()
    pipe = AutoPipelineForText2Image.from_pretrained(model_id, torch_dtype=torch.float32, token=os.environ.get("HF_TOKEN") or None)
    pipe.set_progress_bar_config(disable=True)
    load = time.time() - t0
    prompt = "a clean flat illustration of a small green robot reading a book, white background"
    for i in range(2):                                           # the second run is the steady speed
        t0 = time.time()
        img = pipe(prompt, num_inference_steps=steps, guidance_scale=guidance, height=size, width=size).images[0]
        dt = time.time() - t0
    img.save(f"/tmp/{model_id.replace('/', '_')}.png")
    print(f"IMAGE {model_id}: {size}x{size}, {steps} step(s): {dt:.1f}s (load {load:.0f}s), saved", flush=True)


def speech() -> None:
    from huggingface_hub import hf_hub_download
    import wave
    from piper import PiperVoice
    base = "ar/ar_JO/kareem/medium/ar_JO-kareem-medium"
    onnx = hf_hub_download("rhasspy/piper-voices", base + ".onnx")
    hf_hub_download("rhasspy/piper-voices", base + ".onnx.json")
    voice = PiperVoice.load(onnx)
    text = "مرحباً، أنا نوفا، مساعدك في كتابة الأكواد وتشغيلها واختبارها."
    t0 = time.time()
    with wave.open("/tmp/ar.wav", "wb") as w:
        voice.synthesize_wav(text, w)
    dt = time.time() - t0
    with wave.open("/tmp/ar.wav", "rb") as w:
        sec = w.getnframes() / w.getframerate()
    print(f"SPEECH piper ar_JO-kareem: {sec:.1f}s of audio in {dt:.1f}s (real-time factor {dt / sec:.2f})", flush=True)


for fn in (lambda: image("IDKiro/sdxs-512-dreamshaper", 1), lambda: image("stabilityai/sd-turbo", 1), speech):
    try:
        fn()
    except Exception as e:                                       # noqa: BLE001
        traceback.print_exc()
        print(f"FAILED: {type(e).__name__}: {str(e)[:300]}", flush=True)
