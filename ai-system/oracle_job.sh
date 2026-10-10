#!/bin/bash
# Sham's job on the Oracle server — run by sham-run.timer (every 6 h) as the isolated `sham` user:
# 1 CPU, 4 GB RAM, lowest priority, work folder <= 40 GB, 6 h limit, no access to Athar's folders.
# Secrets (KAGGLE_USERNAME + KAGGLE_KEY, or KAGGLE_API_TOKEN) come from /etc/sham/sham.env, placed by the owner. Nothing here prints them.
#
# Jobs (each isolated: one failing never stops the next):
#   1. vault — an off-Kaggle copy of the main-line checkpoints (ai-system/vault/sham_vault.py)
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${SHAM_WORK:-$(pwd)}"
export PYTHONUNBUFFERED=1
echo "== sham oracle job $(date -u +%FT%TZ) — work: $WORK"
python3 "$HERE/vault/sham_vault.py" --run "$WORK" || echo "vault: failed (exit $?)"
echo "== done $(date -u +%FT%TZ)"
