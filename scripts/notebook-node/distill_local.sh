#!/usr/bin/env bash
# Sham teachers that WE host on the notebook (fast, and the live Nova Studios are not touched): Qwen3.6-35B-A3B and Nova's Qwen3.5-4B on the GPU (ports 8080 / 8081),
# Generates records with the distillation generator (agreement between the teachers for facts, the lab's verifiers where a prompt has one),
# then appends the accepted ones to the private Kaggle pool every Sham trainer reads. Run by the notebook runner (notebook-task.yml, script distill_local.sh).
# Needs the notebook GPU environment for the two GPU teachers (without a GPU the 35B and the 4B are skipped). Status: written 2026-11-17, not run yet.
set -u
W=${W:-/mnt/workspace}; LL=$W/llama.cpp; M=$W/m; mkdir -p "$M"
[ -x "$LL/build/bin/llama-server" ] || { echo "run gpu_node.sh setup first (llama.cpp with CUDA)"; exit 1; }
pip -q install modelscope kaggle 2>&1 | tail -1
fetch() {  # repo pattern -> prints the file path
  python3 - "$1" "$2" <<'PY'
import sys, glob
from modelscope import snapshot_download as s
d = s(sys.argv[1], allow_patterns=["*" + sys.argv[2] + "*"], local_dir="/mnt/workspace/m/" + sys.argv[1].split("/")[-1])
print(sorted(glob.glob(d + "/**/*" + sys.argv[2] + "*.gguf", recursive=True))[0])
PY
}
up() {     # name port ngl file ctx
  nohup "$LL/build/bin/llama-server" -m "$4" -ngl "$3" -c "$5" --jinja --host 127.0.0.1 --port "$2" > "$W/srv_$1.log" 2>&1 &
  for i in $(seq 1 90); do curl -sf "http://127.0.0.1:$2/health" >/dev/null 2>&1 && { echo "$1 up on $2"; return 0; }; sleep 5; done
  echo "$1 did not come up"; tail -n 5 "$W/srv_$1.log"; return 1
}
TEACHERS=""
if nvidia-smi >/dev/null 2>&1; then
  F=$(ls "$M"/*/*IQ3_XXS*.gguf "$M"/*IQ3_XXS*.gguf 2>/dev/null | head -1); [ -n "$F" ] || F=$(fetch unsloth/Qwen3.6-35B-A3B-GGUF UD-IQ3_XXS)
  up qwen36 8080 99 "$F" 4096 && TEACHERS="$TEACHERS,qwen36-35b-a3b"
  F=$(fetch unsloth/Qwen3.5-4B-GGUF Q4_K_M); up nova4b 8081 99 "$F" 4096 && TEACHERS="$TEACHERS,nova-qwen35-4b"
fi
TEACHERS=${TEACHERS#,}
[ -n "$TEACHERS" ] || { echo "no teacher came up"; exit 1; }
echo "teachers: $TEACHERS"
python3 ai-system/distill/distill_gen.py --prompts ai-system/distill/prompts/pack_ar.jsonl --out "$W/new_records.jsonl" --teachers "$TEACHERS" --limit "${LIMIT:-200}" --expand "${EXPAND:-4}"
python3 ai-system/distill/publish_pool.py "$W/new_records.jsonl"
pkill -f "llama-server.*--port 80" || true
