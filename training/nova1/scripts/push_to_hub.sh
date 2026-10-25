#!/usr/bin/env bash
# Runs on a CPU box (Oracle runner or any PC): uploads the finished mix and the training code to a PRIVATE Hugging Face
# dataset repo, so a GPU notebook (Colab / Lightning) needs only that repo and an HF token — no access to this Git repo.
#   HF_TOKEN=... bash scripts/push_to_hub.sh <hf-user>/nova1-data
set -euo pipefail
REPO=${1:?usage: push_to_hub.sh <hf-user>/nova1-data}
: "${HF_TOKEN:?set HF_TOKEN (write token)}"
huggingface-cli repo create "$REPO" --repo-type dataset --private -y 2>/dev/null || true
huggingface-cli upload "$REPO" data/mix.jsonl data/mix.jsonl --repo-type dataset
huggingface-cli upload "$REPO" train train --repo-type dataset
huggingface-cli upload "$REPO" requirements.txt requirements.txt --repo-type dataset
