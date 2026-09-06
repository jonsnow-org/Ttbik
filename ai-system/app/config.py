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
# Our own self-hosted, open-weight image-GENERATION model (Stable
# Diffusion family) — see ai-system/colab/generate_image_model.ipynb.
# Separate from HF_SPECIALIST_MODEL_ID (Qwen2.5-VL, text+image
# UNDERSTANDING) because generation and understanding are genuinely
# different model architectures — see council.py's module docstring.
HF_IMAGE_MODEL_ID = os.environ.get("HF_IMAGE_MODEL_ID", "")

NOVA_INTERNAL_SECRET = os.environ.get("NOVA_INTERNAL_SECRET", "")

FREE_DAILY_QUOTA = int(os.environ.get("FREE_DAILY_QUOTA", "20"))

# The platform owner is never a customer of their own product — exempt
# from the same free daily cap regular NovaUsers hit (owner report,
# 2026-09-06: hit "انتهى حدك المجاني اليومي" while testing their own
# bot). Same env var novaBotLogic.ts already reads on the Vercel side
# for admin-panel recognition — set it here too on Render.
SUPER_ADMIN_TELEGRAM_ID = os.environ.get("SUPER_ADMIN_TELEGRAM_ID", "")
