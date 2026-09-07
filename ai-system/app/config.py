"""
Central env-var config for the Nova AI FastAPI backend. Every value has
a genuinely free tier — see ai-system/README.md for where to get each
key. Mirrors this project's existing convention (Next.js side) of
reading everything from the environment, no hardcoded secrets.
"""
import os

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
# gemini-2.0-flash was retired 2026-03-03; its replacement gemini-2.5-flash
# was itself retired for new callers by 2026-09-06 (error message pointed
# directly at gemini-3.6-flash as the successor) — Gemini's free-tier
# catalog changes over time like Groq's does, so check
# https://ai.google.dev/gemini-api/docs/models for what's currently live
# before assuming this default still applies.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")

HF_TOKEN = os.environ.get("HF_TOKEN", "")
HF_SPECIALIST_MODEL_ID = os.environ.get("HF_SPECIALIST_MODEL_ID", "")

# Owner report, 2026-09-07: Hugging Face's free Inference Providers
# system flatly refuses to serve ANY custom/private model repo for
# chat_completion — confirmed live with both our own fine-tuned repo
# and the untouched official base model, at every size we tried (7B
# and 0.5B alike) — "Model not supported by provider hf-inference".
# That isn't a config problem, it's HF's own free-tier policy, so
# HF_SPECIALIST_MODEL_ID above is no longer usable as a live answer
# path (see council.py). Real serving now happens on ModelScope's free
# Studio hosting (2 vCPU / 16GB, no time limit) instead — a compute
# box we run our own code on, not an API we rent per call. Point this
# at the public URL ModelScope's "API documentation" page shows for
# the Studio (looks like
# https://studio-<owner>-<space>.api-inference.modelscope.net/).
MODELSCOPE_SPACE_URL = os.environ.get("MODELSCOPE_SPACE_URL", "")
# ModelScope's api-inference.modelscope.net domain requires a bearer
# token even for a Studio marked public (confirmed live: a plain
# unauthenticated request gets 401 Unauthorized) — generate one from
# the ModelScope account's Access Tokens settings page (format
# "ms-xxxxx").
MODELSCOPE_API_TOKEN = os.environ.get("MODELSCOPE_API_TOKEN", "")
# Our own self-hosted, open-weight image-GENERATION model (Stable
# Diffusion family) — see ai-system/colab/generate_image_model.ipynb.
# Separate from HF_SPECIALIST_MODEL_ID (Qwen2.5-VL, text+image
# UNDERSTANDING) because generation and understanding are genuinely
# different model architectures — see council.py's module docstring.
HF_IMAGE_MODEL_ID = os.environ.get("HF_IMAGE_MODEL_ID", "")
# Our own self-hosted, open-weight video-GENERATION model (CogVideoX-2B
# or the lighter damo-vilab/text-to-video-ms-1.7b fallback) — see
# ai-system/colab/generate_image_model.ipynb's video-gen cells and
# council.py's generate_video() for the real, honestly-documented
# uncertainty around whether HF's free tier actually serves this task
# for a custom repo (unconfirmed, unlike HF_IMAGE_MODEL_ID above).
HF_VIDEO_MODEL_ID = os.environ.get("HF_VIDEO_MODEL_ID", "")

NOVA_INTERNAL_SECRET = os.environ.get("NOVA_INTERNAL_SECRET", "")

# Owner spec, 2026-09-08: replaced by the tiered PLANS dict in quota.py
# (FREE/PRO_BASIC/PRO_PLUS/PRO_ULTRA, each with its own daily+weekly
# text/image caps) — a single flat env var couldn't express that, so
# this no longer exists as a config knob; edit quota.py's PLANS dict
# directly to change any plan's numbers.

# The platform owner is never a customer of their own product — exempt
# from the same free daily cap regular NovaUsers hit (owner report,
# 2026-09-06: hit "انتهى حدك المجاني اليومي" while testing their own
# bot). Same env var novaBotLogic.ts already reads on the Vercel side
# for admin-panel recognition — set it here too on Render.
SUPER_ADMIN_TELEGRAM_ID = os.environ.get("SUPER_ADMIN_TELEGRAM_ID", "")

# Owner report, 2026-09-07: real vision inference on the free ModelScope
# box (CPU-only, no GPU) took ~4-5 minutes measured live for one photo —
# far past anything a single Vercel function invocation (60s ceiling) can
# wait for. /image in main.py now answers Telegram directly from here,
# in a background task, once the model is actually done, instead of
# routing the answer back through the original webhook's response — so
# this service needs the bot's own token to call Telegram's sendMessage
# API itself. Same NOVA_BOT token novaBotLogic.ts already holds on the
# Vercel side; set it here too on Render (same pattern as
# SUPER_ADMIN_TELEGRAM_ID above).
NOVA_BOT_TOKEN = os.environ.get("NOVA_BOT_TOKEN", "")
