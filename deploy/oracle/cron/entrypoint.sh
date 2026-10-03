#!/bin/sh
# Turns vercel.json "crons" into a crontab that calls the self-hosted site (UTC, same as Vercel).
set -eu
apk add --no-cache curl jq tzdata >/dev/null
: "${CRON_SECRET:?CRON_SECRET is required}"
jq -r --arg s "$CRON_SECRET" \
  '.crons[] | "\(.schedule) curl -fsS -m 290 -H \"Authorization: Bearer \($s)\" \"http://site:3000\(.path)\" >/proc/1/fd/1 2>&1"' \
  /app/vercel.json > /etc/crontabs/root
chmod 600 /etc/crontabs/root
echo "cron: $(wc -l < /etc/crontabs/root) jobs scheduled (UTC)"
exec crond -f -l 8
