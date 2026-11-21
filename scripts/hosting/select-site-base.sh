#!/usr/bin/env bash
# Select exactly one public origin before a scheduled API call.
# Read-only GETs may probe Gate and then Oracle; the caller must make at most one mutation request.
set -euo pipefail

CONFIG="${1:-deploy/hosting/site.json}"
if [[ ! -f "$CONFIG" ]]; then
  echo "::error::site config not found: $CONFIG" >&2
  exit 1
fi

GATE_BASE="$(jq -r '.gateUrl // .engineUrl // empty' "$CONFIG")"
ORACLE_BASE="$(jq -r '.oracleUrl // empty' "$CONFIG")"

probe() {
  local base="${1%/}" status
  [[ -n "$base" ]] || return 1
  status="$(curl -sS -L --connect-timeout 8 --max-time 20 -o /dev/null -w '%{http_code}' "$base/" 2>/dev/null || true)"
  [[ "$status" =~ ^[23][0-9]{2}$ ]]
}

if probe "$GATE_BASE"; then
  printf 'SITE_BASE=%s\nSITE_BASE_SOURCE=gate\n' "${GATE_BASE%/}"
elif probe "$ORACLE_BASE"; then
  printf 'SITE_BASE=%s\nSITE_BASE_SOURCE=oracle\n' "${ORACLE_BASE%/}"
else
  echo "::error::Neither configured public origin (Gate or Oracle) passed the read-only availability probe." >&2
  exit 1
fi
