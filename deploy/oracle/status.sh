#!/usr/bin/env bash
# Quick health report for the Oracle host.
DIR="${DIR:-/opt/ttbik}"
cd "$DIR/deploy/oracle" || exit 1
HOST="$(grep -E '^PUBLIC_HOST=' .env | cut -d= -f2)"
echo "== containers";   docker compose ps
echo; echo "== memory / disk"; free -h | sed -n 1,2p; df -h / | tail -1
echo; echo "== HTTPS ($HOST)"; curl -sS -o /dev/null -m 10 -w 'HTTP %{http_code}\n' "https://$HOST/" || echo "unreachable (DNS, ports 80/443 or certificate)"
echo; echo "== media engine log (last 25 lines)"; docker compose logs --tail=25 media-engine
