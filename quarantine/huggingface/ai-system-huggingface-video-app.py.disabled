"""
Owner spec, 2026-09-12 ("ابحث حتى لو اضطررت لتغيير النموذج... حل نهائي
ودائم للفديو"): self-hosted real video generation on Hugging Face's
free "ZeroGPU" hardware tier — see ai-system/app/hf_video.py's module
docstring for the full reasoning (why this exists, what it's tried
against, and the one honestly-unverified part: whether server-to-server
API calls from Render reliably get real GPU time the same way a human
visitor browsing this Space's own page does).

LTX-Video-2B (Lightricks, Apache 2.0 — a real permissive license, no
conflict with reselling Nova as a paid product) chosen specifically
because it is the first DiT-based video model built for real-time
generation, a genuine speed advantage that matters here: ZeroGPU caps
every @spaces.GPU call at roughly ~120 real seconds regardless of plan
(not a guessed number — real forum/doc reports, see hf_video.py).
Defaults below (short duration, reduced resolution/steps vs. the
model's own "full quality" example configuration) deliberately trade
some quality for a real, measured chance of finishing inside that
ceiling — tune upward only after checking this Space's own real
per-call timing logs, not by guessing.

Deployed here via the same git-push CI pattern already used for
ModelScope Studio (see .github/workflows/deploy-hf-video-space.yml and
deploy-modelscope-studio.yml for the sibling workflow this one
mirrors) — one-time manual setup still required: create the Space
itself on huggingface.co (SDK: Gradio, Hardware: ZeroGPU) before CI can
push code into it.
"""
import os
import tempfile

import gradio as gr
import spaces
import torch
from diffusers import LTXPipeline
from diffusers.utils import export_to_video

_MODEL_ID = "Lightricks/LTX-Video"
_FPS = 24
# Real ZeroGPU per-call ceiling (~120s, see this module's own docstring
# above) is the actual constraint here, not the model's own maximum
# supported duration — kept short and conservative until real timing
# from this Space's own logs justifies raising it.
_MAX_SECONDS = 6

pipe = LTXPipeline.from_pretrained(_MODEL_ID, torch_dtype=torch.bfloat16)


def _seconds_to_frames(seconds: float) -> int:
    """LTX's temporal VAE compresses frames in groups of 8 — the model
    card's own full-quality example uses a frame count of the form
    8n+1 (161 = 8*20+1) for exactly this reason. Rounds the requested
    duration to the nearest valid 8n+1 count instead of an arbitrary
    frame number the model was never validated against — same real
    architectural-constraint reasoning council.py's
    _seconds_to_cogvideox_frames already uses for CogVideoX's own (4n+1)
    constraint elsewhere in this project."""
    seconds = max(1, min(seconds, _MAX_SECONDS))
    raw_frames = round(seconds * _FPS)
    n = round((raw_frames - 1) / 8)
    return max(9, n * 8 + 1)


@spaces.GPU(duration=100)
def generate(prompt: str, seconds: float = 6) -> str:
    """The one real GPU-touching function in this file — ZeroGPU only
    grants actual CUDA access for the duration of this call; the rest
    of this process runs CPU-only, which is why pipe.to("cuda") lives
    inside here rather than at module load time."""
    pipe.to("cuda")
    num_frames = _seconds_to_frames(seconds)
    video = pipe(
        prompt=prompt,
        negative_prompt="worst quality, blurry, distorted, deformed, static",
        width=512,
        height=320,
        num_frames=num_frames,
        num_inference_steps=20,
        generator=torch.Generator(device="cuda").manual_seed(0),
    ).frames[0]
    out_path = os.path.join(tempfile.mkdtemp(), "output.mp4")
    export_to_video(video, out_path, fps=_FPS)
    return out_path


# api_name defaults to the function's own name ("generate") for a
# gr.Interface — matches ai-system/app/hf_video.py's
# client.predict(..., api_name="/generate") exactly, no explicit
# override needed.
demo = gr.Interface(
    fn=generate,
    inputs=[gr.Textbox(label="prompt"), gr.Number(label="seconds", value=6)],
    outputs=gr.Video(label="video"),
    title="Nova AI — Real Video (LTX-Video-2B, ZeroGPU)",
)

if __name__ == "__main__":
    demo.launch()
