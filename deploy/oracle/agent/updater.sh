#!/usr/bin/env bash
# Pull-based auto-deploy for the Oracle VM (runs every 2 minutes from systemd).
# Pulls the branch; if files that matter here changed, rebuilds the containers.
# A failed build leaves the previous containers running.
set -uo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
exec 9>/var/lock/ttbik-updater.lock; flock -n 9 || exit 0
BR="${BRANCH:-claude/free-services-marketplace-h6rwk2}"
cd /opt/ttbik || exit 0
if ! git fetch -q --depth 1 origin "$BR" 2>/dev/null; then echo "$(now) fetch failed" > "$STATE/last_update"; report; exit 0; fi
NEW=$(git rev-parse FETCH_HEAD); CUR=$(git rev-parse HEAD)
PROFILES=$(cat "$OR/profiles" 2>/dev/null || true)   # e.g. "--profile site"
PATHS='^(media-bot/|deploy/oracle/)'
case "$PROFILES" in *site*) PATHS='^(media-bot/|deploy/oracle/|src/|public/|prisma/|package(-lock)?\.json|next\.config\.mjs|vercel\.json)';; esac
if [ "$NEW" != "$CUR" ] || [ -f "$STATE/force-update" ]; then
  CHANGED=$(git diff --name-only "$CUR" "$NEW" 2>/dev/null | grep -E "$PATHS" || true)
  git reset -q --hard "$NEW"
  bash "$OR/agent/ensure-sweeper.sh" >/dev/null 2>&1 || true
  if [ -n "$CHANGED" ] || [ -f "$STATE/force-update" ]; then
    rm -f "$STATE/force-update"
    cd "$OR"
    # shellcheck disable=SC2086
    if docker compose $PROFILES up -d --build > "$STATE/update.log" 2>&1; then
      echo "$(now) OK $(git -C /opt/ttbik rev-parse --short HEAD)" > "$STATE/last_update"
      docker image prune -f >/dev/null 2>&1
    else
      echo "$(now) FAILED $(git -C /opt/ttbik rev-parse --short HEAD)" > "$STATE/last_update"
      tg_notify "فشل بناء التحديث $(git -C /opt/ttbik rev-parse --short HEAD). النسخة القديمة ما زالت تعمل."
    fi
  else
    echo "$(now) OK (no relevant changes) $(git rev-parse --short HEAD)" > "$STATE/last_update"
  fi
fi
report
