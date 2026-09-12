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

# Owner report, 2026-09-07/09: Hugging Face's free Inference Providers
# system flatly refuses to serve ANY custom/private model repo for ANY
# task — confirmed live for chat_completion (both our own fine-tuned
# repo and the untouched official base model, every size tried) and
# again for text_to_image on our own Stable Diffusion repo
# ("Model not supported by provider hf-inference" both times). That
# isn't a config problem, it's HF's own free-tier policy — there is no
# HF-based env var left to configure for live serving of any kind
# (text, vision, or image generation) as a result; Hugging Face is now
# used only to archive trained weights (see
# ai-system/colab/merge_and_finetune.ipynb and
# generate_image_model.ipynb), never at request time. Real serving of
# everything — text, vision, and image generation alike — happens on
# ModelScope's free Studio hosting instead (2 vCPU / 16GB, no time
# limit): a compute box we run our own code on, not an API we rent per
# call. Point this at the public URL ModelScope's "API documentation"
# page shows for the Studio (looks like
# https://studio-<owner>-<space>.api-inference.modelscope.net/).
MODELSCOPE_SPACE_URL = os.environ.get("MODELSCOPE_SPACE_URL", "")
# ModelScope's api-inference.modelscope.net domain requires a bearer
# token even for a Studio marked public (confirmed live: a plain
# unauthenticated request gets 401 Unauthorized) — generate one from
# the ModelScope account's Access Tokens settings page (format
# "ms-xxxxx").
MODELSCOPE_API_TOKEN = os.environ.get("MODELSCOPE_API_TOKEN", "")

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

# Owner spec, 2026-09-12: second factor for "owner mode" (Telegram ID
# alone was already used for the quota exemption below; the owner
# asked for ID + a password together, checked once via a Telegram
# command — see quota.py's verify_owner_password and
# novaBotLogic.ts's "/تفعيل_المالك" handler). Same simple
# env-var-comparison style already used for NOVA_BOT_CREATOR_PASSWORD
# (src/app/api/bots/deploy/route.ts) — no new auth system invented.
NOVA_OWNER_PASSWORD = os.environ.get("NOVA_OWNER_PASSWORD", "")

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

# Owner spec, 2026-09-12 ("أداة اقتراح تعديل الكود... PR-only"): see
# ai-system/app/dev_agent.py's module docstring for the full, explicit
# safety constraints the owner set for this token. Fine-grained PAT,
# contents + pull_requests permissions ONLY, scoped to this one repo,
# no admin permissions — set here on Render only, never in
# novaBotLogic.ts/Vercel (that side never touches GitHub directly).
NOVA_DEV_AGENT_GITHUB_TOKEN = os.environ.get("NOVA_DEV_AGENT_GITHUB_TOKEN", "")
# "owner/repo" form, e.g. "jonsnow-org/Ttbik".
NOVA_DEV_AGENT_REPO = os.environ.get("NOVA_DEV_AGENT_REPO", "")
# The branch every proposal branch is forked FROM and every PR targets —
# dev_agent.py never writes to this branch directly, only reads its tip
# to fork a new branch from. Set to whatever this project's real
# current working branch is (NOT necessarily "main").
NOVA_DEV_AGENT_BASE_BRANCH = os.environ.get("NOVA_DEV_AGENT_BASE_BRANCH", "")

# Owner spec, 2026-09-12 ("ابحث حتى لو اضطررت لتغيير النموذج كله...
# حل نهائي ودائم للصوت والفديو والصور... ليس عبر ترميم"): real research
# (see cloudflare_ai.py's module docstring for the full reasoning) found
# Cloudflare Workers AI is a genuinely free ($0, no credit card, "Workers
# Free" plan — 10,000 shared "Neurons"/day, resets daily at 00:00 UTC),
# always-on, GPU-served hosted inference platform — a real fix for the
# three separate workarounds this project had been forced into by owning
# no free GPU: ModelScope's CPU-only distilled sd-turbo (poor image
# quality), the Kaggle-scheduled async video queue (real video, but up to
# ~2h late), and gTTS's unofficial, timeout-prone narration endpoint.
# Sign up free at https://dash.cloudflare.com/sign-up (email+password
# only). Account ID: Cloudflare dashboard -> Workers AI -> shown on that
# page. Token: My Profile -> API Tokens -> Create Token -> a scoped
# "Workers AI" template token (read-only against this one product).
CLOUDFLARE_ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")

# Real, documented model IDs (developers.cloudflare.com/workers-ai/models)
# as overridable env vars rather than hardcoded, since Workers AI's free
# catalog changes over time exactly like Groq's/Gemini's do (see those
# vars' own comments above) — check that page for the current exact slug
# before assuming these defaults still apply.
CLOUDFLARE_IMAGE_MODEL = os.environ.get("CLOUDFLARE_IMAGE_MODEL", "@cf/black-forest-labs/flux-1-schnell")
# UNCONFIRMED exact slug (this project's own research could not browse
# Cloudflare's live model list — its docs domain is blocked from this
# sandbox's own network egress): real web search independently confirmed
# Alibaba's "Wan" text-to-video model is live on Workers AI's free
# catalog as of 2026-09, but not the precise @cf/... id string. Verify
# the real current slug from the Workers AI dashboard's own model
# catalog (it shows a copyable exact ID per model) before relying on
# this default — override here if it differs.
CLOUDFLARE_VIDEO_MODEL = os.environ.get("CLOUDFLARE_VIDEO_MODEL", "@cf/alibaba/wan-2.1-t2v")
CLOUDFLARE_TTS_MODEL = os.environ.get("CLOUDFLARE_TTS_MODEL", "@cf/myshell-ai/melotts")

# Owner spec, 2026-09-12 ("ابحث حتى لو اضطررت لتغيير النموذج... حل
# نهائي ودائم"): real second free-GPU lane found once Cloudflare's own
# video catalog was confirmed (live, by the owner) to have no real
# free first-party model — see hf_video.py's module docstring for the
# full reasoning. A free Hugging Face account's personal access token
# (huggingface.co -> Settings -> Access Tokens -> New token, Read scope
# is enough) is all HF_TOKEN needs; HF_VIDEO_SPACE_ID is the Space's
# own id in "username/space-name" form, created once (SDK: Gradio,
# Hardware: ZeroGPU) per ai-system/huggingface-video/app.py.
HF_TOKEN = os.environ.get("HF_TOKEN", "")
HF_VIDEO_SPACE_ID = os.environ.get("HF_VIDEO_SPACE_ID", "")
