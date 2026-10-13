#!/bin/bash
# Sham's job on the Oracle server — run by sham-run.timer (every 6 h) as the isolated `sham` user:
# 1 CPU, 4 GB RAM, lowest priority, work folder <= 40 GB, 6 h limit, no access to Athar's folders.
# Secrets (KAGGLE_USERNAME + KAGGLE_KEY, or KAGGLE_API_TOKEN) come from /etc/sham/sham.env, placed by the owner. Nothing here prints them.
#
# Jobs (each isolated: one failing never stops the next):
#   1. vault — an off-Kaggle copy of the main-line checkpoints (ai-system/vault/sham_vault.py)
#   2. live CPU trainer (2026-10-13, owner's order): sham_live trains the model on this machine's one core for up to ~5 h of each 6 h window, from the newest
#      published head, and publishes its own lineage sham-crawl-oracle (the merge job finds it by the sham-crawl-* rule and merges it through the gate).
#      It needs the Kaggle keys in /etc/sham/sham.env; without them, or if the libraries cannot be installed, this step just reports and the vault still ran.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${SHAM_WORK:-$(pwd)}"
export PYTHONUNBUFFERED=1
echo "== sham oracle job $(date -u +%FT%TZ) — work: $WORK"
python3 "$HERE/vault/sham_vault.py" --run "$WORK" || echo "vault: failed (exit $?)"

VENV="$WORK/venv"
if [ -n "${KAGGLE_USERNAME:-}${KAGGLE_API_TOKEN:-}" ]; then
  if [ ! -x "$VENV/bin/python" ] || ! "$VENV/bin/python" -c "import torch, tokenizers, kaggle" >/dev/null 2>&1; then
    echo "live: installing the CPU libraries into $VENV (once)"
    python3 -m venv "$VENV" \
      && "$VENV/bin/pip" install -q --upgrade pip \
      && "$VENV/bin/pip" install -q --index-url https://download.pytorch.org/whl/cpu torch \
      && "$VENV/bin/pip" install -q tokenizers pillow numpy requests beautifulsoup4 kaggle datasets soundfile av \
      || echo "live: could not install the libraries (exit $?) — skipped this time"
  fi
  if "$VENV/bin/python" -c "import torch, tokenizers, kaggle" >/dev/null 2>&1; then
    mkdir -p "$WORK/live"
    ( cd "$HERE/colab/sham_small" && SHAM_LIVE_WORK="$WORK/live" SHAM_NO_SHARD_DOWNLOAD=1 SHAM_STREAM_THREADS=1 SHAM_STREAM_CHUNK=128 OMP_NUM_THREADS=1 \
        timeout 5h30m "$VENV/bin/python" -c "import sham_live; print(sham_live.run(hours=5.0, name='oracle', source_set='gh', video=False, workers=2))" ) \
      || echo "live: ended with exit $?"
  fi
else
  echo "live: no Kaggle keys in the environment (/etc/sham/sham.env) — the trainer was not started"
fi
echo "== done $(date -u +%FT%TZ)"
