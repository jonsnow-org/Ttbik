#!/bin/sh
# Run by the Workers Builds job of athar-meta (cloudflare/athar-front/wrangler.jsonc, build.command) to publish the site gate as well.
# Never fails the parent deploy. Writes a short diagnostic (no values, only variable NAMES) to the D1 database ttbik-diag so a failure can be read.
LOG=/tmp/gate-deploy.log
{ echo "date: $(date -u)"; echo "pwd: $(pwd)"; echo "node: $(node -v 2>&1)"; echo "wrangler: $(npx wrangler --version 2>&1 | tail -1)"; env | grep -E '^(CLOUDFLARE|WRANGLER|WORKERS|CF_)' | sed 's/=.*/=<set>/'; } > "$LOG" 2>&1
CI=true timeout 240 npx wrangler deploy -c ../site-gate/wrangler.jsonc >> "$LOG" 2>&1
echo "exit=$?" >> "$LOG"
B=$(tail -c 3000 "$LOG" | base64 | tr -d '\n')
CI=true timeout 90 npx wrangler d1 execute DB -c ../site-gate/diag.jsonc --remote --command "CREATE TABLE IF NOT EXISTS log(t TEXT, b TEXT)" > /dev/null 2>&1
CI=true timeout 90 npx wrangler d1 execute DB -c ../site-gate/diag.jsonc --remote --command "INSERT INTO log VALUES (datetime('now'),'$B')" > /dev/null 2>&1
exit 0
