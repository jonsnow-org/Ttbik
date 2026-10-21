#!/usr/bin/env bash
# Coder sandbox runner (coder-sandbox/ at the repo root): short-lived capped containers for the coder bot. Owner-approved 2026-10-21.
# Enabled by the file agent/CODER_SANDBOX_ON; the updater runs this as root once per version of the files below. Isolated like the
# Sham runner and the Zenobia ledger: its own compose project, image, network and limits; it never touches Athar, the media engine,
# the site, the database or their data. Every box: 1 CPU, 2 GB, 256 processes, read-only root with a 1 GB tmpfs, no host folders,
# no private / metadata / host network, 45 minutes at most. It takes no new box while the Sham job runs or memory is short.
#   key    : derived from the bot token this machine already has (the site derives the same one), kept only in
#            /var/lib/coder-sandbox/runner.env (root, 600); never printed.
#   remove : delete agent/CODER_SANDBOX_ON, then `docker compose -p coder-sandbox down` and
#            `systemctl disable --now coder-sbx-shamflag.timer`.
set -euo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
[ -n "$BOT_TOKEN" ] || { echo "no bot token yet"; exit 1; }
mkdir -p /var/lib/coder-sandbox/flags
# Sham first: a host timer mirrors "the Sham job is running" into a flag the runner can see (read-only mount)
cat > /usr/local/sbin/coder-sbx-shamflag <<'SH'
#!/bin/sh
if systemctl is-active --quiet sham-run.service 2>/dev/null; then touch /var/lib/coder-sandbox/flags/SHAM_ON; else rm -f /var/lib/coder-sandbox/flags/SHAM_ON; fi
SH
chmod 755 /usr/local/sbin/coder-sbx-shamflag
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  cat > /etc/systemd/system/coder-sbx-shamflag.service <<'UNIT'
[Unit]
Description=coder sandbox: mirror whether the Sham job runs
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/coder-sbx-shamflag
UNIT
  cat > /etc/systemd/system/coder-sbx-shamflag.timer <<'UNIT'
[Unit]
Description=coder sandbox: check the Sham job every 20 seconds
[Timer]
OnBootSec=10
OnUnitActiveSec=20
AccuracySec=5
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now coder-sbx-shamflag.timer >/dev/null 2>&1 || true
fi
/usr/local/sbin/coder-sbx-shamflag || true
RUNNER_SECRET="$(printf %s "coder-sandbox:$BOT_TOKEN" | sha256sum | cut -c1-48)" bash /opt/ttbik/coder-sandbox/install.sh
# Caddy reads its file only at start: restart it once when the Caddyfile is newer than the running container (certificates persist)
cd "$OR"
cid=$(docker compose ps -q caddy 2>/dev/null | head -1)
cse=$(date -d "$(docker inspect -f '{{.State.StartedAt}}' "$cid" 2>/dev/null)" +%s 2>/dev/null || echo 0)
cf=$(stat -c %Y "$OR/Caddyfile" 2>/dev/null || echo 0)
if [ -n "$cid" ] && [ "$cf" -gt "$cse" ]; then docker compose restart caddy >/dev/null 2>&1 || true; fi
for _ in $(seq 1 20); do
  curl -sf -m 3 -o /dev/null -H "x-runner-key: $(printf %s "coder-sandbox:$BOT_TOKEN" | sha256sum | cut -c1-48)" http://127.0.0.1:8790/health && { echo "runner healthy"; exit 0; }
  sleep 2
done
echo "runner did not answer"; docker logs --tail 5 coder-sandbox-runner-1 2>&1 | mask; exit 1
