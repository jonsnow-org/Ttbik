#!/usr/bin/env bash
# Moves the site's environment from Vercel to this machine, with no copying by hand (docs/HOSTING.md).
# Every updater cycle (only when agent/SITE_ON exists) this asks the Vercel site for its settings. The site answers ONLY inside the 15-minute window the
# owner opens from the «🌐 الاستضافة» panel, only to this machine's address, and only with the secret this machine already has (FEED_SECRET in media.env).
# Anything else gets 403 and nothing happens. A success merges the values into deploy/oracle/.env (kept: PUBLIC_HOST and other local names) and
# writes the NEXT_PUBLIC_* ones to /opt/ttbik/.env.production for the build. Values are never printed.
set -uo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
[ -f "$OR/agent/SITE_ON" ] || exit 0
SECRET="$(getkv "$OR/media.env" FEED_SECRET)"; [ -n "$SECRET" ] || exit 0
SITE="$(python3 -c "import json;print(json.load(open('/opt/ttbik/deploy/hosting/site.json'))['vercelUrl'])" 2>/dev/null)"; [ -n "$SITE" ] || exit 0
OUT="$STATE/env-sync.json"; rm -f "$OUT"
code="$(curl -sS -m 25 -o "$OUT" -w '%{http_code}' -H "x-feed-secret: $SECRET" "$SITE/api/ops/env-sync" 2>/dev/null)" || exit 0
[ "$code" = "200" ] || { rm -f "$OUT"; exit 0; }
if python3 "$OR/agent/envmerge.py" "$OUT" "$OR/.env" /opt/ttbik/.env.production > "$STATE/env-sync.log" 2>&1; then
  rm -f "$OUT"; touch "$STATE/force-update"; echo "$(now) OK $(tail -1 "$STATE/env-sync.log")" > "$STATE/env_sync_status"
  tg_notify "تم نقل إعدادات الموقع إلى Oracle ($(tail -1 "$STATE/env-sync.log")). يبدأ بناء الموقع الآن."
else
  rm -f "$OUT"; echo "$(now) FAILED" > "$STATE/env_sync_status"
  tg_notify "تعذّر دمج إعدادات الموقع على Oracle. لم يتغيّر شيء."
fi
