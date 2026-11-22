#!/usr/bin/env bash
# Nova inference measurements (phase 6 of the SHAM T-LDM project book): does KV-cache quantization and speculative decoding make Nova (Qwen3.5-4B Q4_K_M, llama.cpp) faster?
# Runs on the notebook through notebook-task.yml (script=infer_bench.sh). THREADS=2 reproduces a Nova Studio (2 cores); THREADS=8 is the notebook CPU. NGL=0 is CPU (the Studios), NGL=99 uses the GPU.
# Nothing here needs a secret. Output: tables in the job log (read them from the log; no number is quoted anywhere before it has been read there).
set -u
for kv in "$@"; do case "$kv" in THREADS=*|NGL=*|PORT=*) export "$kv";; esac; done   # args of notebook-task.yml, e.g. "THREADS=2 NGL=0"
W=${W:-/mnt/workspace}
LL=$W/llama.cpp
THREADS=${THREADS:-2}
NGL=${NGL:-0}
M=$W/m_bench
PORT=${PORT:-8099}
mkdir -p "$M"

echo "== machine: $(nproc) cores, threads=$THREADS, ngl=$NGL"; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "no GPU"

if [ ! -x "$LL/build/bin/llama-bench" ] || [ ! -x "$LL/build/bin/llama-server" ]; then
  [ -d "$LL" ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LL" || { echo "clone failed"; exit 1; }
  cd "$LL" || exit 1
  if nvidia-smi >/dev/null 2>&1 && [ "$NGL" != "0" ]; then CUDA="-DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=86"; else CUDA=""; fi
  cmake -B build $CUDA -DLLAMA_CURL=OFF 2>&1 | tail -2
  cmake --build build --config Release -j"$(nproc)" --target llama-server llama-bench 2>&1 | tail -3
fi
BIN=$LL/build/bin
[ -x "$BIN/llama-bench" ] || { echo "build failed"; exit 1; }
"$BIN/llama-bench" --version 2>&1 | head -1 || true

pip -q install modelscope 2>&1 | tail -1
python3 - <<PY
from modelscope import snapshot_download as s
for repo, pat in (("unsloth/Qwen3.5-4B-GGUF", "*Qwen3.5-4B-Q4_K_M.gguf"), ("unsloth/Qwen3.5-0.8B-GGUF", "*Qwen3.5-0.8B-Q4_K_M.gguf")):
    try:
        print("downloaded", s(repo, allow_patterns=[pat], local_dir="$M"))
    except Exception as e:
        print("DOWNLOAD FAILED", repo, str(e)[:200])
PY
T=$(ls "$M"/*Qwen3.5-4B-Q4_K_M.gguf 2>/dev/null | head -1)
DRAFT=$(ls "$M"/*Qwen3.5-0.8B-Q4_K_M.gguf 2>/dev/null | head -1)
[ -n "$T" ] || { echo "no target model"; exit 1; }
ls -la "$M"

echo; echo "== 1) KV cache type (llama-bench): prompt 512, generate 64, at context depth 0 and 4096; f16 = today's setting"
run_bench() { "$BIN/llama-bench" -m "$T" -t "$THREADS" -ngl "$NGL" -p 512 -n 64 -r 2 "$@" 2>&1 | grep -v -i "^load_\|^ggml_" ; }
if ! run_bench -d 0,4096 -ctk f16,q8_0 -ctv f16,q8_0 -fa 1; then echo "(retry without depth)"; run_bench -ctk f16,q8_0 -ctv f16,q8_0 -fa 1; fi

echo; echo "== 2) speculative decoding (llama-server, greedy, 128 tokens): baseline vs Qwen3.5-0.8B as the draft"
cat > "$W/spec_client.py" <<'PY'
import json, sys, time, urllib.request
port = sys.argv[1]
prompts = {
  "code": "Write a Python function that merges two sorted lists without using sort, then give three asserts.",
  "arabic": "اشرح باختصار كيف تعمل الخلية الشمسية في خمس جمل.",
  "json": "Return a JSON object describing a book with title, author, year and three tags. Output only JSON.",
}
for name, p in prompts.items():
    body = json.dumps({"prompt": p, "n_predict": 128, "temperature": 0, "cache_prompt": False}).encode()
    t0 = time.time()
    r = json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/completion", body, {"Content-Type": "application/json"}), timeout=900))
    t = r.get("timings", {})
    print(f"{name:7s} gen {t.get('predicted_per_second', 0):6.2f} tok/s | prompt {t.get('prompt_per_second', 0):6.1f} tok/s | draft_n {t.get('draft_n', '-')} accepted {t.get('draft_n_accepted', '-')} | wall {time.time()-t0:5.1f}s", flush=True)
PY
serve_and_test() {   # $1 label, rest = extra llama-server flags
  label=$1; shift
  "$BIN/llama-server" -m "$T" -t "$THREADS" -ngl "$NGL" -c 4096 --port "$PORT" --host 127.0.0.1 "$@" > "$W/spec_server.log" 2>&1 &
  pid=$!
  for _ in $(seq 1 120); do curl -s "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok"' && break; sleep 2; done
  echo "-- $label"
  if curl -s "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok"'; then python3 "$W/spec_client.py" "$PORT"; else echo "server did not become ready:"; tail -5 "$W/spec_server.log"; fi
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
}
serve_and_test "baseline (no draft)"
if [ -n "$DRAFT" ]; then
  serve_and_test "draft 0.8B, up to 8 tokens" -md "$DRAFT" --draft-max 8 --draft-min 1 -ngld "$NGL"
  serve_and_test "draft 0.8B, up to 4 tokens" -md "$DRAFT" --draft-max 4 --draft-min 1 -ngld "$NGL"
else
  echo "draft model missing: speculative tests skipped"
fi
echo "== done"
