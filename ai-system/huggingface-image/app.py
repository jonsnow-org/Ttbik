"""
Owner spec, 2026-09-13 ("ابتكار نظام مجاني لتوليد الوسائط صور صوت فديو
بطريقة احترافية بالامكانيات المتوفرة"): the SECOND free ZeroGPU Space
this account is entitled to. Hugging Face's own documentation is
explicit that a free account may run TWO ZeroGPU Gradio Spaces (PRO
gets 10, organisations 50) — one was already spent on video
(ai-system/huggingface-video/app.py) and the other was simply sitting
unused, which is a real free GPU going to waste.

Why this is a genuine quality jump and not a second copy of what we
already have: Cloudflare Workers AI serves flux-1-schnell, a model
DISTILLED to produce an image in about four diffusion steps. That
distillation is precisely what the owner complained about with a real
generated image — cartoon-like rendering and a deformed hand. Running
the same model ourselves would change nothing. So this Space runs a
different, undistilled model at a real step count on a real H200.

Model choice is a licensing decision as much as a quality one, because
Nova is sold as a product:
  - FLUX.1-dev produces excellent images and is NON-COMMERCIAL. Unusable
    here, no matter how good it looks.
  - FLUX.1-schnell is Apache-2.0 and fine to sell — but it IS the
    distilled model Cloudflare already gives us for free, so it buys
    nothing.
  - Stable Diffusion 3.5 Medium (used here) is covered by Stability's
    Community License: free for commercial use while annual revenue is
    under $1M, which this project is comfortably within. It is
    materially better than SDXL at anatomy — hands specifically — which
    is the actual complaint being answered.

ONE-TIME MANUAL STEP, and this Space will fail loudly without it: the
SD 3.5 repo is GATED on Hugging Face. Visit
huggingface.co/stabilityai/stable-diffusion-3.5-medium while logged in
as the account owning HF_TOKEN and accept the licence once. Until that
happens the pipeline load below raises, the Space returns nothing, and
ai-system/app/hf_image.py falls back to Cloudflare exactly as it does
when the daily GPU quota runs out — degraded, never broken.

Honest and unchanged from the video Space's own docstring: whether
server-to-server Gradio API calls from Render reliably receive real
ZeroGPU time is still NOT confirmed by live testing. Hugging Face's
docs do state that authenticated calls draw on the account's own quota
while unauthenticated ones land in a stricter shared pool, and
hf_image.py passes the token accordingly — so the design follows the
documented path, but the real-world result still needs one live test.
"""
import os
import tempfile

import gradio as gr
import spaces
import torch
from diffusers import StableDiffusion3Pipeline

_MODEL_ID = "stabilityai/stable-diffusion-3.5-medium"

# Directly answering the owner's real complaint ("وجه مشوه", a deformed
# hand): an undistilled model actually responds to a negative prompt,
# which flux-1-schnell does not support at all. Kept to genuine defects
# only — deliberately NOT "cartoon", since a cartoon is sometimes
# exactly what was asked for.
_NEGATIVE_PROMPT = (
    "deformed hands, extra fingers, missing fingers, fused fingers, malformed limbs, "
    "disfigured face, asymmetric eyes, low quality, blurry, jpeg artifacts, watermark, text"
)

# 28 steps is Stability's own documented default for this model, and
# roughly seven times what the distilled model we are replacing can use.
# ZeroGPU caps a single call at about 120 seconds, so raise this only
# after reading this Space's own real timing logs — not by guessing.
_STEPS = 28
_GUIDANCE = 4.5
_SIZE = 1024

pipe = StableDiffusion3Pipeline.from_pretrained(_MODEL_ID, torch_dtype=torch.bfloat16)


@spaces.GPU(duration=100)
def generate(prompt: str) -> str:
    """The only GPU-touching function here — ZeroGPU grants real CUDA
    access solely for this call's duration, which is why .to("cuda")
    lives inside it rather than at module import time (same structure as
    the video Space, for the same reason)."""
    pipe.to("cuda")
    image = pipe(
        prompt=prompt,
        negative_prompt=_NEGATIVE_PROMPT,
        num_inference_steps=_STEPS,
        guidance_scale=_GUIDANCE,
        width=_SIZE,
        height=_SIZE,
    ).images[0]
    out_path = os.path.join(tempfile.mkdtemp(), "output.png")
    image.save(out_path)
    return out_path


# api_name defaults to the function name ("generate") for gr.Interface —
# matches hf_image.py's client.predict(..., api_name="/generate").
demo = gr.Interface(
    fn=generate,
    inputs=[gr.Textbox(label="prompt")],
    outputs=gr.Image(label="image", type="filepath"),
    title="Nova AI — Real Image (SD 3.5 Medium, ZeroGPU)",
)

if __name__ == "__main__":
    demo.launch()
