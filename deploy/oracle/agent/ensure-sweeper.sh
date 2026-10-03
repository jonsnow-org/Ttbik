#!/usr/bin/env bash
# Installs the 1-minute sweeper timer if missing (called by install-agent.sh and by the updater). Idempotent.
set -euo pipefail
OR=/opt/ttbik/deploy/oracle
[ -f /etc/systemd/system/ttbik-sweeper.timer ] && exit 0
cat > /etc/systemd/system/ttbik-sweeper.service <<UNIT
[Unit]
Description=Ttbik sweeper
After=network-online.target
[Service]
Type=oneshot
ExecStart=/bin/bash $OR/agent/sweeper.sh
TimeoutStartSec=60
UNIT
cat > /etc/systemd/system/ttbik-sweeper.timer <<UNIT
[Unit]
Description=Ttbik sweeper timer
[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now ttbik-sweeper.timer
