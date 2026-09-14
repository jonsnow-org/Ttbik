FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
# --extra-index-url (in requirements.txt) pulls the CPU-only torch
# build instead of the default CUDA one — Render's free tier has no
# GPU, and the CUDA wheel is several GB larger for nothing this
# service would ever use.
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

# Render (Docker web services) injects a $PORT env var and routes
# external traffic to whatever port the container actually listens on
# — shell form CMD, not exec form, so the env var actually expands
# (the same real pattern already proven in ai-system/Dockerfile for
# the live production Nova service).
EXPOSE 10000
CMD uvicorn serve:app --host 0.0.0.0 --port ${PORT:-10000}
