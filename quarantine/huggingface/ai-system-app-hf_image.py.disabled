"""
Owner spec, 2026-09-13: the client side of ai-system/huggingface-image/
app.py — see that file's docstring for why this second free ZeroGPU
Space exists, which model it runs and why that specific model was the
only defensible choice for a product that gets sold.

Position in the real chain, deliberately FIRST for images:
    hf_image (this)  -> best quality, our own GPU lane, hard daily cap
    cloudflare_ai    -> good quality, 10k shared Neurons/day, fast
    council          -> ModelScope CPU sd-turbo, slow, always there

That order looks backwards for a "free tier first" system, so the
reasoning matters: the ZeroGPU allowance is about five GPU-minutes a
day and CANNOT be topped up on a free account, while Cloudflare's pool
is far larger and resets daily. Spending the scarce, highest-quality
lane first and degrading to the plentiful one is the right way round —
the alternative would leave the good GPU minutes permanently unused,
which is exactly the waste this was built to fix.

Shares HF_TOKEN and the daily ZeroGPU allowance with hf_video, so heavy
video use really does eat into image quality on the same day. That is a
real trade-off of the free tier, not a bug, and it degrades silently
and safely: every failure here returns None and the next lane answers.

Real constraint found live, 2026-09-13 (see hf_video.py's own docstring
for the fuller account of it, discovered while setting THIS Space up):
Hugging Face's web UI only offers the Gradio SDK — the one this Space
needs — to accounts older than 30 days; a newer account sees only
`Static`. Nothing to fix here: the account just needs to age past that
mark, then the exact same manual setup steps work unchanged. Until
then, HF_IMAGE_SPACE_ID simply stays unset and this whole lane is
skipped, exactly like any other unconfigured/unavailable case below.
"""
import logging

from app import cloudflare_ai
from app.config import HF_IMAGE_SPACE_ID, HF_TOKEN

logger = logging.getLogger("nova")


def generate_image(prompt: str) -> bytes | None:
    """Returns raw PNG bytes, or None on ANY failure — the Space being
    asleep or rebuilding, today's ZeroGPU minutes being spent, the SD
    3.5 licence not yet accepted on the account (see the Space's own
    docstring), or the unverified server-to-server Gradio API friction
    documented in hf_video.py. All of those mean the same thing to the
    caller: "not available right now, use the next lane."

    Watermarking happens HERE, before returning. That is not an
    arbitrary choice: main.py applies no watermark of its own, because
    every existing lane already tags its own output (cloudflare_ai in
    its own module, ModelScope inside the Studio itself). A lane that
    skipped it would silently ship untagged, unattributed images while
    every other lane tagged them — so this reuses cloudflare_ai's exact
    implementation rather than growing a third copy of the same
    Pillow code."""
    if not HF_TOKEN or not HF_IMAGE_SPACE_ID:
        return None
    try:
        from gradio_client import Client
    except Exception:
        logger.info("hf-image: gradio_client not installed on this server")
        return None

    try:
        client = Client(HF_IMAGE_SPACE_ID, hf_token=HF_TOKEN)
        result_path = client.predict(prompt, api_name="/generate")
    except Exception as e:
        logger.info(
            "hf-image: ZeroGPU Space call failed (%s) — likely today's free GPU minutes are spent, "
            "the Space is asleep/rebuilding, or the SD 3.5 licence has not been accepted yet", e,
        )
        return None

    try:
        with open(result_path, "rb") as f:
            raw = f.read()
    except Exception as e:
        logger.info("hf-image: could not read the image file the Space returned (%s)", e)
        return None

    try:
        return cloudflare_ai.watermark_and_tag_image(raw)
    except Exception:
        logger.exception("hf-image: watermark/metadata step failed — returning the raw image rather than failing the whole request")
        return raw
