#!/usr/bin/env bash
# One Nova 1 training session on AMD Radeon Cloud through its official CLI (rcc, PyPI package amd-oneclick-sdk):
# check credits -> create the instance -> run training over SSH (resumes from the private HF checkpoint repo, stops itself
# after MINUTES) -> delete the instance so no credit is spent idle. Safe to call again and again (cron on the Oracle runner).
#
#   python3 -m pip install amd-oneclick-sdk && rcc auth login --no-browser && rcc instance add-key   # once
#   rcc catalog list            # once: pick the IDs below
#   export RCC_ENV=... RCC_POOL=... RCC_TEMPLATE=... HF_TOKEN=... HF_USER=...
#   bash train/launch_radeon.sh [MINUTES]
set -euo pipefail
MINUTES=${1:-180}
: "${RCC_ENV:?}" "${RCC_POOL:?}" "${RCC_TEMPLATE:?}" "${HF_TOKEN:?}" "${HF_USER:?}"
NEED=$(( (MINUTES + 30) / 60 + 1 ))     # credits = GPU-hours (1 credit per GPU per hour)
HAVE=$(rcc --quiet --output json credits status | python3 -c "import sys,json; d=json.load(sys.stdin); print(int(float(d.get('balance', d.get('credits', 0)))))" || echo 0)   # unreadable balance -> treated as 0, nothing starts
if [ "$HAVE" -lt "$NEED" ]; then echo "stop: $HAVE credits, this session needs $NEED"; exit 0; fi

cleanup() { rcc instance delete --yes >/dev/null 2>&1 || true; }
trap cleanup EXIT
rcc --quiet instance create --env "$RCC_ENV" --pod-type "$RCC_POOL" --resource-template "$RCC_TEMPLATE" \
    --idempotency-key "nova1-$(date +%Y%m%d%H%M)" --timeout 1800
SSH=$(rcc --quiet instance ssh --print)

# The image's ROCm PyTorch must stay: never pip install torch here (it would replace it with a CUDA build).
# HF_TOKEN goes over stdin, never on a command line (process lists / shell history).
printf '%s\n' "$HF_TOKEN" | $SSH "bash -lc 'set -e
  read -r HF_TOKEN; export HF_TOKEN
  python -c \"import torch; assert torch.cuda.is_available(), torch.__version__\"
  pip install -q \"transformers>=5.0.0\" \"trl>=0.24\" \"peft>=0.17\" datasets pyyaml huggingface_hub accelerate
  python -c \"from huggingface_hub import snapshot_download as s; s(\\\"$HF_USER/nova1-data\\\", repo_type=\\\"dataset\\\", local_dir=\\\"/workspace/nova1\\\")\"
  cd /workspace/nova1
  python train/train.py --config train/config.radeon.yaml --out out/nova1-lora --hub-repo $HF_USER/nova1-lora-ckpt --max-minutes $MINUTES --resume
'"
echo "session done; checkpoint is in $HF_USER/nova1-lora-ckpt (last-checkpoint)"
