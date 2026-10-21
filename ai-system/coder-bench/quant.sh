#!/usr/bin/env bash
# llama-bench b11757 on 2 pinned CPU threads (the Studio has 2 vCPU): prompt processing (pp) and generation (tg) per quant / flag.
set -eu
B=b11757
curl -sSL -o l.tgz "https://github.com/ggml-org/llama.cpp/releases/download/$B/llama-$B-bin-ubuntu-x64.tar.gz"
mkdir -p l && tar xzf l.tgz -C l && BIN=$(dirname $(find l -name llama-bench | head -1)); export LD_LIBRARY_PATH=$BIN
lscpu | grep -E "Model name|Flags" | cut -c1-400
pip -q install modelscope >/dev/null 2>&1
for q in Q4_K_M Q4_0 IQ4_NL Q4_K_S; do
  python3 -c "from modelscope import snapshot_download as s;print(s('unsloth/Qwen3.5-4B-GGUF',allow_patterns=['Qwen3.5-4B-$q.gguf'],cache_dir='m'))" >/dev/null 2>&1
  f=$(find m -name "Qwen3.5-4B-$q.gguf" | head -1)
  echo "== $q"; taskset -c 0,1 $BIN/llama-bench -m "$f" -t 2 -p 512 -n 32 -r 2 -o md 2>/dev/null | grep -E "qwen|model"
  if [ "$q" = Q4_K_M ]; then
    for ub in 128 256 1024; do echo "-- ub $ub"; taskset -c 0,1 $BIN/llama-bench -m "$f" -t 2 -p 512 -n 0 -ub $ub -r 1 -o md 2>/dev/null | grep qwen; done
    echo "-- fa 1"; taskset -c 0,1 $BIN/llama-bench -m "$f" -t 2 -p 512 -n 0 -fa 1 -r 1 -o md 2>/dev/null | grep qwen
    echo "-- fa 0"; taskset -c 0,1 $BIN/llama-bench -m "$f" -t 2 -p 512 -n 0 -fa 0 -r 1 -o md 2>/dev/null | grep qwen
  fi
  rm -f "$f"
done
