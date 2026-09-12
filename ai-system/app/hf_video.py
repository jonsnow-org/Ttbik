"""
Owner spec, 2026-09-12 ("ابحث حتى لو اضطررت لتغيير النموذج... حل نهائي
ودائم"): continuing the same research that found Cloudflare Workers AI
(see cloudflare_ai.py) — that platform turned out to have NO real free
first-party video model (every "video" result in its own catalog is
"Third-party", billed separately, confirmed live by the owner scrolling
all 34 results). Real research kept going and found a second, different
free-GPU lane: Hugging Face Spaces' "ZeroGPU" hardware tier — real
NVIDIA H200 time, genuinely free for a personal account (2 free Gradio
Spaces, a real but modest daily quota — public reporting puts the free
tier around ~5 minutes of GPU-seconds/day, PRO around 25 minutes/day;
neither number is published as an exact permanent guarantee by Hugging
Face itself, so treat this as an order-of-magnitude estimate, not a
contract).

Real math this makes possible: ai-system/huggingface-video/app.py runs
LTX-Video-2B (Lightricks, Apache 2.0, the first DiT video model built
for real-time generation — genuinely fast, not just "small") inside a
single @spaces.GPU-decorated call, which ZeroGPU caps at roughly ~120s
per call regardless of plan. A short, modest-resolution clip with this
model plausibly finishes in well under that ceiling — meaning perhaps
10-25 REAL, fast (seconds, not hours) videos/day at $0 before this
path's daily quota is used up, at which point quota.enqueue_video's
Kaggle queue (unchanged, still real, still free, just async) takes
back over exactly as it already does today.

Honest, UNVERIFIED part, stated plainly rather than guessed away: real
forum reports (not fabricated) describe friction calling a ZeroGPU
Space's GPU-decorated function via the Gradio API client specifically
(server-to-server, as this backend does) rather than a human visiting
the Space's own page in a browser — whether calls from Render reliably
get real GPU time, or get throttled/rejected as non-interactive
traffic, is NOT confirmed here and can only be settled by actually
deploying ai-system/huggingface-video/app.py and testing live. Every
function below fails soft (returns None) for exactly that reason.

Setup (one-time, same shape as ModelScope Studio's own setup): create a
free Hugging Face account + a new Space (SDK: Gradio, Hardware:
ZeroGPU) — see ai-system/huggingface-video/app.py for what gets
deployed there (same git-push CI pattern as ModelScope Studio, see
.github/workflows/deploy-hf-video-space.yml). Needs HF_TOKEN (a
personal access token, Read scope is enough since this only calls the
Space's own public API — Settings -> Access Tokens on huggingface.co)
and HF_VIDEO_SPACE_ID ("username/space-name") in config.py/Render.
"""
import logging

from app import media_finish
from app.config import HF_TOKEN, HF_VIDEO_SPACE_ID

logger = logging.getLogger("nova")


def generate_video(prompt: str, seconds: int = 6) -> bytes | None:
    """Tried by main.py BEFORE quota.enqueue_video's Kaggle queue (same
    "fast free path first, slow free path as real fallback" shape
    already used for images: Cloudflare first, ModelScope second).
    Returns raw watermarked/narrated/tagged MP4 bytes on success, None
    on ANY failure — a Space that's asleep/rebuilding, today's ZeroGPU
    quota already spent, or the Gradio API friction described in this
    module's own docstring above all look the same from here: "not
    available right now, let the real fallback handle it."""
    if not HF_TOKEN or not HF_VIDEO_SPACE_ID:
        return None
    try:
        from gradio_client import Client
    except Exception:
        logger.info("hf-video: gradio_client not installed on this server")
        return None

    try:
        client = Client(HF_VIDEO_SPACE_ID, hf_token=HF_TOKEN)
        result_path = client.predict(prompt, seconds, api_name="/generate")
    except Exception as e:
        logger.info(
            "hf-video: ZeroGPU Space call failed (%s) — likely today's free GPU-minutes quota "
            "already used, or the Space is asleep/rebuilding", e,
        )
        return None

    try:
        with open(result_path, "rb") as f:
            raw = f.read()
    except Exception as e:
        logger.info("hf-video: could not read the video file the Space returned (%s)", e)
        return None

    try:
        return media_finish.finish_video(raw, prompt)
    except Exception:
        logger.exception("hf-video: watermark/narration/metadata step failed — returning raw video instead of failing the whole request")
        return raw
