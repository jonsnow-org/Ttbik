#!/usr/bin/env bash
# Every minute: asks the site to end idle fake chats. While this runs, Vercel skips its 280-second per-chat functions.
set -uo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
[ -n "$BOT_TOKEN" ] || exit 0
key=$(printf %s "$BOT_TOKEN" | sha256sum | cut -c1-48)
out=$(curl -s -m 50 -X POST "$SITE_URL/api/internal/fake-chat-sweep" -H "x-ops-key: $key" 2>&1 | mask | cut -c1-160)
echo "$(now) $out" > "$STATE/sweeper_note"
