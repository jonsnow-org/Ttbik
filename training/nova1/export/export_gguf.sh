#!/usr/bin/env bash
# Merge the Nova 1 LoRA into Qwen3.5-4B, convert to GGUF (llama.cpp) and quantise.
#   bash export/export_gguf.sh out/nova1-lora out/gguf
# Produces nova1-4b-f16.gguf (kept for re-quantising), nova1-4b-q4_k_m.gguf (served) and nova1-4b-q8_0.gguf.
# Each GGUF carries the SHAM AI identity in its metadata and chat template (export/sham_identity.py).
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
python - "$OUT/merged" <<'PY'
import sys
sys.path.insert(0, "export")
from sham_identity import clean_tokenizer_dir
print("chat template cleaned:", clean_tokenizer_dir(sys.argv[1]))
PY
[ -d llama.cpp ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp
pip install -q -r llama.cpp/requirements/requirements-convert_hf_to_gguf.txt
python llama.cpp/convert_hf_to_gguf.py "$OUT/merged" --outtype f16 --outfile "$OUT/nova1-4b-f16.gguf"
cmake -S llama.cpp -B llama.cpp/build -DGGML_CUDA=OFF >/dev/null && cmake --build llama.cpp/build --target llama-quantize -j >/dev/null
for q in Q4_K_M Q8_0; do
  llama.cpp/build/bin/llama-quantize "$OUT/nova1-4b-f16.gguf" "$OUT/nova1-4b-$(echo $q | tr A-Z a-z).gguf" $q
done
pip install -q ./llama.cpp/gguf-py      # the same gguf-py the converter above uses
for f in "$OUT"/nova1-4b-*.gguf; do
  python - "$f" <<'PY'
import os, sys
sys.path.insert(0, "export")
from sham_identity import rebrand_gguf
src = sys.argv[1]
print(os.path.basename(src), rebrand_gguf(src, src + ".tmp"))
os.replace(src + ".tmp", src)
PY
done
ls -lh "$OUT"/*.gguf
