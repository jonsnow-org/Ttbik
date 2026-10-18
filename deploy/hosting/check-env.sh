#!/usr/bin/env bash
# Compares the variable NAMES the site reads (env-names.txt) with an env file. Values are never printed.
# Usage:  bash deploy/hosting/check-env.sh [/opt/ttbik/deploy/oracle/.env]
# SET = has a value; EMPTY = listed without a value; MISSING = not in the file. A MISSING or EMPTY name is fine ONLY when it is also unset on Vercel.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ENVF="${1:-/opt/ttbik/deploy/oracle/.env}"
[ -r "$ENVF" ] || { echo "cannot read $ENVF"; exit 1; }
set_n=0; empty_n=0; miss_n=0
while read -r name; do
  case "$name" in ''|'#'*) continue;; esac
  line="$(grep -E "^[[:space:]]*${name}=" "$ENVF" | tail -1)"
  if [ -z "$line" ]; then echo "MISSING $name"; miss_n=$((miss_n+1))
  else val="${line#*=}"; val="${val%\"}"; val="${val#\"}"
    if [ -z "$val" ]; then echo "EMPTY   $name"; empty_n=$((empty_n+1)); else set_n=$((set_n+1)); fi
  fi
done < "$HERE/env-names.txt"
echo "-- $set_n set, $empty_n empty, $miss_n missing (names only; compare the empty/missing ones with Vercel)"
# the ones that must exist for the site to start at all
for must in DATABASE_URL NEXT_PUBLIC_SITE_URL CRON_SECRET TELEGRAM_WEBHOOK_SECRET; do
  grep -qE "^[[:space:]]*${must}=.+" "$ENVF" || echo "REQUIRED and not set: $must"
done
