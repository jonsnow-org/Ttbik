FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Owner report, 2026-09-13/14 (real, TWICE-reproduced evidence in Render's
# own logs): every cold start — a redeploy, or the free tier's own
# "spin down after inactivity" — wipes the container's disk, including
# chromadb's onnxruntime embedding-model cache (~/.cache/chroma/...).
# The very first real message after each restart then triggers a fresh
# ~79MB network download of that model IN THE MIDDLE of handling that
# live message (confirmed live: a `GET .../all-MiniLM-L6-v2/onnx.tar.gz`
# followed by its download progress bar, both sitting between that
# message's own Groq/Supabase calls in the log) — real added memory and
# latency stacked on top of whatever else that same request already
# needed, and in both captured incidents the process was OOM-killed
# during or right after this exact sequence. Baking the model into the
# image at BUILD time (a separate environment, uncounted against
# Render's runtime memory limit) means no container ever needs that
# network download again, and removes it from the live request path
# entirely.
RUN python -c "from chromadb.utils import embedding_functions; embedding_functions.DefaultEmbeddingFunction()(['warmup'])"

# Render (Docker web services) injects a $PORT env var and routes
# external traffic to whatever port the container actually listens on
# — there's no fixed platform-required port like Hugging Face Spaces'
# 7860, so this must read $PORT at container start (shell form CMD,
# not exec form, so the env var actually expands). 10000 is just a
# sane local-run fallback.
EXPOSE 10000
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}
