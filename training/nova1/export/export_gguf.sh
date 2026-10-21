#!/usr/bin/env bash
# Merge the Nova 1 LoRA into Qwen3.5-4B, convert to GGUF (llama.cpp) and quantise.
#   bash export/export_gguf.sh out/nova1-lora out/gguf
# Produces nova1-4b-f16.gguf (kept for re-quantising), nova1-4b-q4_k_m.gguf (served) and nova1-4b-q8_0.gguf.
set -euo pipefail
LORA=${1:-out/nova1-lora}
OUT=${2:-out/gguf}
BASE=${BASE_MODEL:-Qwen/Qwen3.5-4B}
mkdir -p "$OUT"
python - "$BASE" "$LORA" "$OUT/merged" <<'PY'
import sys, torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer
base, lora, out = sys.argv[1:]
m = AutoModelForCausalLM.from_pretrained(base, dtype=torch.bfloat16, device_map="cpu")
m = PeftModel.from_pretrained(m, lora).merge_and_unload()
m.save_pretrained(out, safe_serialization=True)
AutoTokenizer.from_pretrained(base).save_pretrained(out)
print("merged ->", out)
PY
[ -d llama.cpp ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp
pip install -q -r llama.cpp/requirements/requirements-convert_hf_to_gguf.txt
python llama.cpp/convert_hf_to_gguf.py "$OUT/merged" --outtype f16 --outfile "$OUT/nova1-4b-f16.gguf"
cmake -S llama.cpp -B llama.cpp/build -DGGML_CUDA=OFF >/dev/null && cmake --build llama.cpp/build --target llama-quantize -j >/dev/null
for q in Q4_K_M Q8_0; do
  llama.cpp/build/bin/llama-quantize "$OUT/nova1-4b-f16.gguf" "$OUT/nova1-4b-$(echo $q | tr A-Z a-z).gguf" $q
done
ls -lh "$OUT"/*.gguf
