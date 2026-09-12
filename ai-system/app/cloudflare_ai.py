"""
Owner spec, 2026-09-12 ("لا اريد كلا الخيارين ابحث عن طرق... اريد حل
نهائي ودائم لمشكلة توليد الصوت والفديو والصور بشكل احترافي وليس عبر
ترميم ومدة طويلة وعروض شرائح وصور مشوهة خلقياً"): real, live web
research (not guessed) found Cloudflare Workers AI — a genuinely free
($0, Workers Free plan, 10,000 shared "Neurons"/day, resets daily at
00:00 UTC, NO credit card required to sign up or to use the free daily
pool) hosted, GPU-served, always-on inference platform. This is a real
fix for three separate workarounds this project had been forced into by
owning no free GPU of its own:

  - IMAGE quality complaint ("جودة رديئة... وجه مشوه"): the real cause
    was ModelScope's sd-turbo — a model specifically distilled to trade
    quality for 1-4-step CPU speed. Cloudflare's flux-1-schnell is a
    real, much larger, GPU-served model — same category jump the owner
    asked for, at $0.
  - VIDEO ("لا اريد عرض شرائح... اريد فديو حقيقي"): the Kaggle-scheduled
    CogVideoX-2B batch queue (quota.enqueue_video / process_video_queue
    .ipynb) is real video, but async — up to ~2h late, which the owner
    then separately rejected as still too slow ("اي حل لايكون من خمس
    دقائق... غير مقبول"). Cloudflare's hosted Wan text-to-video model
    answers inline, in seconds — no queue needed for the common case.
  - AUDIO: gTTS (an unofficial wrapper around Google Translate's TTS
    endpoint, no real SLA, no timeout of its own — see modelscope-studio
    /app.py's _add_narration_audio for the real hang this already
    caused once) is replaced by Cloudflare's own hosted TTS model.

Real, load-bearing constraint stated plainly, not hidden: the 10,000
Neurons/day pool is SHARED across every model call this whole bot makes
in a day, across every user — not per-user, not unlimited, and Workers
AI does not publish an exact "videos per day" number since Neuron cost
varies by resolution/duration. This is discovered live in production,
not assumed here. Every function below fails soft (returns None) on ANY
error — including a real 429 (quota exhausted for the day) — specifically
so main.py's existing, already-working fallbacks (ModelScope's sd-turbo
for images, the Kaggle video queue for video) keep firing automatically
once today's free Cloudflare quota is used up, instead of the user ever
seeing silence. Nothing built earlier is deleted because of this file —
it is a faster FIRST attempt in front of what already existed.

Credentials (config.py): CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN —
free at https://dash.cloudflare.com/sign-up (email+password, no card).
Account ID and a scoped "Workers AI" API Token are both shown on the
account's Workers AI dashboard page.

Model IDs are read from config.py (CLOUDFLARE_IMAGE_MODEL/
CLOUDFLARE_VIDEO_MODEL/CLOUDFLARE_TTS_MODEL), not hardcoded here — see
those vars' own comments for which ones are confirmed vs. still need a
live check against Cloudflare's own model catalog page (this sandbox's
own network egress cannot reach developers.cloudflare.com to verify the
exact video model slug directly — said plainly rather than guessed at
silently).
"""
import base64
import io
import logging

import requests

from app import media_finish
from app.config import (
    CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_IMAGE_MODEL,
    CLOUDFLARE_TTS_MODEL,
    CLOUDFLARE_VIDEO_MODEL,
)

logger = logging.getLogger("nova")

_WATERMARK_TEXT = "Nova AI"
# Owner report, 2026-09-12 (real screenshot on the ModelScope-generated
# image): a first attempt at these two alpha values read as an opaque
# label, not a watermark — kept in sync with modelscope-studio/app.py's
# own _add_watermark, which already carries the owner's real correction
# (box 90->45, text 200->130).
_WATERMARK_BOX_ALPHA = 45
_WATERMARK_TEXT_ALPHA = 130
_NARRATION_MAX_CHARS = 200


def _configured() -> bool:
    return bool(CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN)


def _run(model: str, payload: dict, timeout: int = 60) -> requests.Response | None:
    """One real HTTP call to Workers AI's REST API — every caller below
    decides how to interpret a successful response itself (raw binary
    for image/video/audio vs. this project's own JSON-wrapped models),
    since Workers AI's own response shape differs by model/output type."""
    if not _configured():
        return None
    url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run/{model}"
    headers = {"Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}"}
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
        if resp.status_code == 429:
            logger.info("cloudflare-ai: daily free Neuron quota exhausted (429) for model=%s", model)
            return None
        if resp.status_code >= 400:
            logger.info("cloudflare-ai: model=%s failed status=%s body=%s", model, resp.status_code, resp.text[:300])
            return None
        return resp
    except Exception as e:
        logger.info("cloudflare-ai: call to model=%s failed (%s)", model, e)
        return None


def _binary_result(resp: requests.Response, model: str) -> bytes | None:
    """Real production evidence (Render logs, 2026-09-12, the owner's own
    first live test) CONTRADICTS the docs-page examples this originally
    assumed: flux-1-schnell's real REST response is
    {"result": {"image": "<base64 JPEG>"}, "success": true, ...} — a
    JSON envelope with the actual image base64-encoded inside it, not
    raw binary. This function now handles BOTH real shapes seen for
    Workers AI models: a genuine raw binary body (some models really do
    return that), or this JSON envelope (confirmed real for
    flux-1-schnell) — trying the JSON shape first since that's the one
    with live proof behind it, falling back to raw bytes only when the
    body isn't JSON at all."""
    content_type = resp.headers.get("content-type", "")
    if "json" not in content_type:
        return resp.content or None
    try:
        data = resp.json()
    except Exception:
        logger.info("cloudflare-ai: model=%s content-type=json but body wasn't valid JSON (%s)", model, resp.text[:200])
        return None
    if data.get("success") is False:
        logger.info("cloudflare-ai: model=%s success=false errors=%s", model, data.get("errors"))
        return None
    result = data.get("result")
    candidates = [result] if isinstance(result, str) else []
    if isinstance(result, dict):
        candidates = [result.get(key) for key in ("image", "video", "audio") if result.get(key)]
    for candidate in candidates:
        try:
            return base64.b64decode(candidate)
        except Exception:
            continue
    logger.info("cloudflare-ai: model=%s JSON result had no decodable image/video/audio field: %s", model, str(result)[:200])
    return None


def generate_image(prompt: str) -> bytes | None:
    """Real image generation via Cloudflare's hosted flux-1-schnell —
    replaces ModelScope's CPU-only distilled sd-turbo as the FIRST
    attempt (main.py falls back to council.generate_image on None,
    unchanged). Returns raw PNG/JPEG bytes, already watermarked +
    ownership-tagged below — main.py never needs to touch raw
    un-watermarked bytes from this module."""
    resp = _run(CLOUDFLARE_IMAGE_MODEL, {"prompt": prompt}, timeout=60)
    if resp is None:
        return None
    raw = _binary_result(resp, CLOUDFLARE_IMAGE_MODEL)
    if raw is None:
        return None
    try:
        return _watermark_and_tag_image(raw)
    except Exception:
        logger.exception("cloudflare-ai: image watermark/metadata step failed — returning raw image instead of failing the whole request")
        return raw


def generate_video(prompt: str, seconds: int = 6) -> bytes | None:
    """Real motion video via Cloudflare's hosted text-to-video model —
    answered inline in seconds (not the Kaggle queue's up-to-~2h async
    batch), which is what main.py now tries FIRST for real video
    (falling back to quota.enqueue_video, unchanged, on None). Returns
    raw MP4 bytes, already watermarked (per-frame, via ffmpeg drawtext —
    a real pixel-level burn-in on every frame, not a prompt instruction)
    + narrated (Cloudflare TTS) + ownership-tagged below."""
    resp = _run(CLOUDFLARE_VIDEO_MODEL, {"prompt": prompt, "duration": seconds}, timeout=120)
    if resp is None:
        return None
    raw = _binary_result(resp, CLOUDFLARE_VIDEO_MODEL)
    if raw is None:
        return None
    try:
        return media_finish.finish_video(raw, prompt)
    except Exception:
        logger.exception("cloudflare-ai: video watermark/narration/metadata step failed — returning raw video instead of failing the whole request")
        return raw


def generate_speech(text: str) -> bytes | None:
    """Real TTS via Cloudflare's hosted melotts — used internally by
    _finish_video's narration step above; also exported in case a
    future feature wants standalone voice output (owner's original
    request list included "صوت" as its own medium, not just video
    narration)."""
    resp = _run(CLOUDFLARE_TTS_MODEL, {"prompt": text[:_NARRATION_MAX_CHARS]}, timeout=30)
    if resp is None:
        return None
    return _binary_result(resp, CLOUDFLARE_TTS_MODEL)


def _watermark_and_tag_image(png_bytes: bytes) -> bytes:
    """Same real, pixel-level composited watermark + PNG tEXt ownership
    metadata as modelscope-studio/app.py's _add_watermark /
    _png_bytes_with_ownership_metadata — duplicated here (not imported)
    because that file deploys to a completely separate runtime
    (ModelScope's own git repo, see deploy-modelscope-studio.yml) with
    no shared import path to this one (Render's own codebase)."""
    from PIL import Image, ImageDraw, ImageFont
    from PIL.PngImagePlugin import PngInfo

    base = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font_size = max(14, base.width // 24)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", font_size)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), _WATERMARK_TEXT, font=font)
    text_w, text_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    margin = max(8, base.width // 64)
    x = base.width - text_w - margin * 2
    y = base.height - text_h - margin * 2
    draw.rectangle(
        [x - margin // 2, y - margin // 2, x + text_w + margin, y + text_h + margin],
        fill=(0, 0, 0, _WATERMARK_BOX_ALPHA),
    )
    draw.text((x, y), _WATERMARK_TEXT, font=font, fill=(255, 255, 255, _WATERMARK_TEXT_ALPHA))
    final = Image.alpha_composite(base, overlay).convert("RGB")

    info = PngInfo()
    info.add_text("Author", "Nova AI")
    info.add_text("Copyright", "Generated by Nova AI")
    info.add_text("Software", "Nova AI image generator")
    buf = io.BytesIO()
    final.save(buf, format="PNG", pnginfo=info)
    return buf.getvalue()


# Real video finishing (watermark/narration/metadata) moved to
# media_finish.py (2026-09-12) once hf_video.py needed the exact same
# steps for a second video source — see that module's docstring.
