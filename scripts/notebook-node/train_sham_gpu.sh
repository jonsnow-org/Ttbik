#!/usr/bin/env bash
# Train Sham on the ModelScope Notebook (GPU A10 when the GPU environment is running, otherwise the 8-core CPU environment; the two cannot run together): the SAME trainer app that runs in the trainer Studios (ai-system/modelscope-trainer/app.py),
# fetched from the already-deployed trainer Studio repo, so no GitHub token is needed here. sham_live picks CUDA by itself when torch sees a GPU.
# It publishes its own lineage sham-crawl-<NAME> to Kaggle; the merge job finds every sham-crawl-* dataset and judges it through the same gate.
#
# Usage (notebook terminal, GPU environment):
#   bash train_sham_gpu.sh            # prompts (hidden) for the three values below; nothing is written to disk or printed
#   JOB=tools HOURS=3 NAME=gpu2 bash train_sham_gpu.sh
# Values it asks for (type them in YOUR terminal only; never in chat): ModelScope cn token (to clone the trainer Studio code), Kaggle username, Kaggle API token.
# Status (2026-11-17): written from the deploy workflow's own steps; NOT run yet. First run: send the first 30 lines of $W/train.log, not any secret.
set -u
W=${W:-/mnt/workspace}
NAME=${NAME:-nb1}           # lineage name: publishes sham-crawl-nb1 (one name per runner)
HOURS=${HOURS:-3.5}         # a session is 4 h at most: leave time to publish
JOB=${JOB:-live}            # live|images|audio|chat|tools|text|codec|motion
STUDIO=${STUDIO:-novaai2026/sham-trainer-1}   # the deployed trainer Studio repo on modelscope.cn (code only)

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo "no GPU: training on the notebook CPU ($(nproc) cores); sham_live picks the device by itself"
[ -n "${MS_TOKEN:-}" ] || read -rsp "ModelScope cn token: " MS_TOKEN; echo
[ -n "${KAGGLE_USERNAME:-}" ] || read -rp "Kaggle username: " KAGGLE_USERNAME
[ -n "${KAGGLE_API_TOKEN:-}" ] || read -rsp "Kaggle API token: " KAGGLE_API_TOKEN; echo
export KAGGLE_USERNAME KAGGLE_API_TOKEN

D=$W/sham_trainer_code
rm -rf "$D"
git clone --depth 1 "https://oauth2:${MS_TOKEN}@www.modelscope.cn/studios/${STUDIO}.git" "$D" 2>&1 | sed "s/${MS_TOKEN}/***/g" | tail -2
unset MS_TOKEN
[ -f "$D/app.py" ] || { echo "clone failed: check the token and that $STUDIO exists"; exit 1; }
cd "$D" || exit 1
# torch/numpy/pillow already ship with the image: install only what is missing, never replace torch
grep -v -i -E '^(torch|gradio)' requirements.txt > "$W/req.txt"
pip -q install -r "$W/req.txt" 2>&1 | tail -2
pip -q install "gradio==6.17.3" 2>&1 | tail -1
python - <<'PY'
import torch; print("torch", torch.__version__, "cuda", torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")
PY
export SHAM_TRAINER_WORKERS=${WORKERS:-$(( $(nproc) > 16 ? 16 : $(nproc) ))}
export SHAM_TRAINER_NAME=$NAME SHAM_TRAINER_HOURS=$HOURS SHAM_TRAINER_JOB=$JOB SHAM_LIVE_WORK=$W/sham_live_work PORT=7861
nohup python app.py > "$W/train.log" 2>&1 &
echo "started pid $! : lineage sham-crawl-$NAME, job $JOB, $HOURS h. Follow: tail -f $W/train.log"
sleep 20; tail -n 15 "$W/train.log"
