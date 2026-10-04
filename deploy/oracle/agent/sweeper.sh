#!/usr/bin/env bash
# Every minute: asks the site to end idle fake chats. While this runs, Vercel skips its 280-second per-chat functions.
set -uo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
[ -n "$BOT_TOKEN" ] || exit 0
key=$(printf %s "$BOT_TOKEN" | sha256sum | cut -c1-48)
out=$(curl -s -m 50 -X POST "$SITE_URL/api/internal/fake-chat-sweep" -H "x-ops-key: $key" 2>&1 | mask | cut -c1-160)
echo "$(now) $out" > "$STATE/sweeper_note"
# bots health snapshot every 5th minute -> shown in the status report
if [ $(( $(date +%-M) % 5 )) -eq 0 ]; then
  curl -s -m 55 "$SITE_URL/api/ops/bots-health" -H "x-ops-key: $key" > "$STATE/bots_health.json" 2>/dev/null || true
fi
# Athar: every 5th minute (offset by 2) work through the pictures that are waiting for the permanent network.
# A token that was minted while its picture was still on its way shows its default picture until the file is confirmed, then switches by itself.
if [ -f "$OR/agent/ATHAR_ON" ] && [ -s "$STATE/athar_admin_path" ] && [ $(( $(date +%-M) % 5 )) -eq 2 ]; then
  H=$(getkv "$OR/.env" PUBLIC_HOST); P=$(cat "$STATE/athar_admin_path")
  for h in athar athar-test; do
    [ "$h" = athar-test ] && [ ! -s "$OR/agent/ATHAR_TEST_ADMIN" ] && continue
    curl -s -m 100 -X POST "https://$h.$H/api/media/retry" -H "x-athar-adm: $P" > "$STATE/athar_retry_$h" 2>/dev/null || true
  done
fi
