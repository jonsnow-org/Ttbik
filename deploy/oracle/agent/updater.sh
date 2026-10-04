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
[ -f "$OR/agent/ATHAR_ON" ] && PATHS="$PATHS|^athar/"
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
    # Athar is built on its own so a problem there can never block the media engine or the rest.
    if [ -f "$OR/agent/ATHAR_ON" ]; then
      # public address of the management wallet (not a secret); put it in agent/ATHAR_ADMIN to switch the app from "soon" to live
      # secret address of the management panel: created once, kept on this machine, sent only to the owner on Telegram
      NEWPATH=""
      if [ ! -s "$STATE/athar_admin_path" ]; then head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-24 > "$STATE/athar_admin_path"; chmod 600 "$STATE/athar_admin_path"; NEWPATH=1; fi
      export ATHAR_ADMIN_PATH="$(cat "$STATE/athar_admin_path")"
      # throw-away key that only signs free (under 100 KiB) permanent uploads; it holds nothing
      [ -s "$STATE/athar_turbo_key" ] || { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$STATE/athar_turbo_key"; chmod 600 "$STATE/athar_turbo_key"; }
      export ATHAR_TURBO_KEY="$(cat "$STATE/athar_turbo_key")"
      [ -f "$OR/agent/ATHAR_ADMIN" ] && export ATHAR_ADMIN="$(tr -d ' \r\n' < "$OR/agent/ATHAR_ADMIN")"
      if docker compose --profile athar up -d --build athar-web > "$STATE/athar.log" 2>&1; then
        echo "$(now) OK" > "$STATE/athar_status"
        if [ -n "$NEWPATH" ]; then tg_notify "رابط إدارة أثر (سرّي، لا تشاركه): https://athar.$(getkv "$OR/.env" PUBLIC_HOST)/$ATHAR_ADMIN_PATH"; fi
        # Caddyfile is a single-file bind mount: git replaces the file, so the container keeps seeing the old one
        # until it restarts. Restart Caddy only when the file is newer than the running container (certificates persist).
        cid=$(docker compose ps -q caddy 2>/dev/null | head -1)
        cse=$(date -d "$(docker inspect -f '{{.State.StartedAt}}' "$cid" 2>/dev/null)" +%s 2>/dev/null || echo 0)
        cf=$(stat -c %Y "$OR/Caddyfile" 2>/dev/null || echo 0)
        if [ -n "$cid" ] && [ "$cf" -gt "$cse" ]; then docker compose restart caddy >> "$STATE/athar.log" 2>&1 || true; fi
      else
        echo "$(now) FAILED: $(tail -3 "$STATE/athar.log" | tr '\n' ' ' | mask | cut -c1-200)" > "$STATE/athar_status"
        tg_notify "فشل بناء تطبيق أثر. باقي الخدمات لم تتأثر."
      fi
    fi
  else
    echo "$(now) OK (no relevant changes) $(git rev-parse --short HEAD)" > "$STATE/last_update"
  fi
fi
report
