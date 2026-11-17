#!/usr/bin/env bash
# GPU node for the ModelScope Notebook (modelscope.ai -> My Notebook -> GPU environment, NVIDIA A10 23 GB, 16 cores).
# Usage in the notebook terminal:   bash gpu_node.sh setup     (once per fresh disk: build llama.cpp with CUDA, fetch the model)
#                                   bash gpu_node.sh bench     (llama-bench: prefill/decode speed)
#                                   bash gpu_node.sh serve     (llama-server, OpenAI API, protected by a random key printed ONLY in your terminal)
#                                   TUNNEL=1 bash gpu_node.sh serve   (also opens a temporary cloudflared URL; closes when the session stops)
# Status (2026-11-17): the setup and bench steps were run by hand in a live notebook with exactly these commands (CUDA 12.8, build ede6106,
# 35B-A3B IQ3_XXS: pp2048 3088 t/s, tg128 109 t/s). The serve/tunnel steps were NOT run end to end yet: check them before relying on them.
# No secrets here: the API key is generated at run time; never paste it into chat or commit it.
set -u
W=${W:-/mnt/workspace}
REPO=${MODEL_REPO:-unsloth/Qwen3.6-35B-A3B-GGUF}   # mirrored on modelscope.cn; huggingface.co is ~50 kB/s from this notebook, ModelScope ~7 MB/s
PAT=${MODEL_PAT:-UD-IQ3_XXS}
CTX=${CTX:-32768}
PORT=${PORT:-8080}
LL=$W/llama.cpp

model_file() { ls "$W"/m/*${PAT}*.gguf 2>/dev/null | head -1; }

case "${1:-}" in
  setup)
    nvidia-smi --query-gpu=name,memory.total --format=csv || { echo "no GPU: start the GPU environment, not the CPU one"; exit 1; }
    nvcc --version | tail -1 || exit 1
    [ -d "$LL" ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LL" || exit 1
    cd "$LL" || exit 1
    cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=86 -DLLAMA_CURL=OFF 2>&1 | tail -2
    cmake --build build --config Release -j"$(nproc)" --target llama-server llama-bench 2>&1 | tail -3
    pip -q install modelscope 2>&1 | tail -1
    python - <<PY
from modelscope import snapshot_download as s
print(s("$REPO", allow_patterns=["*$PAT*"], local_dir="$W/m"))
PY
    ls -la "$W/m"
    ;;
  bench)
    F=$(model_file); [ -n "$F" ] || { echo "run setup first"; exit 1; }
    "$LL/build/bin/llama-bench" -m "$F" -ngl 99 -p 2048 -n 128
    ;;
  serve)
    F=$(model_file); [ -n "$F" ] || { echo "run setup first"; exit 1; }
    KEY=${NODE_KEY:-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')}
    echo "API key (this terminal only): $KEY"
    if [ "${TUNNEL:-0}" = "1" ]; then
      [ -x "$W/cloudflared" ] || curl -sSL -o "$W/cloudflared" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x "$W/cloudflared"
      nohup "$W/cloudflared" tunnel --no-autoupdate --url "http://localhost:$PORT" > "$W/tunnel.log" 2>&1 &
      sleep 8; grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$W/tunnel.log" | head -1
    fi
    exec "$LL/build/bin/llama-server" -m "$F" -ngl 99 -c "$CTX" --jinja --alias nova-ai --host 0.0.0.0 --port "$PORT" --api-key "$KEY"
    ;;
  *)
    echo "usage: bash gpu_node.sh setup|bench|serve"; exit 2 ;;
esac
