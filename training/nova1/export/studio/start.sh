#!/usr/bin/env bash
# Downloads the quantised Nova 1 GGUF from ModelScope and serves it on :7860 (OpenAI-compatible /v1/chat/completions with tools).
# Studio settings: NOVA1_REPO (default novaai2026/nova1-4b-gguf), NOVA1_FILE (default nova1-4b-q4_k_m.gguf),
# NOVA1_API_KEY (required: the same value goes into the site's NOVA1_STUDIO_KEY; requests without it get 401).
set -euo pipefail
REPO=${NOVA1_REPO:-novaai2026/nova1-4b-gguf}
FILE=${NOVA1_FILE:-nova1-4b-q4_k_m.gguf}
: "${NOVA1_API_KEY:?set NOVA1_API_KEY in the Studio settings}"
python3 -c "from modelscope import snapshot_download as s; print(s('$REPO', allow_patterns=['$FILE'], local_dir='/models'))"
exec /app/llama-server -m "/models/$FILE" --host 0.0.0.0 --port 7860 --api-key "$NOVA1_API_KEY" \
  --ctx-size 16384 --jinja --alias nova1 -t "$(nproc)" --parallel 2
