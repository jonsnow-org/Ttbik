#!/usr/bin/env bash
# One-time install of the self-update + backup + watchdog agent (systemd timers). Safe to re-run.
set -euo pipefail
OR=/opt/ttbik/deploy/oracle
chmod +x $OR/agent/*.sh
mkdir -p /var/lib/ttbik /var/backups/ttbik
[ -f $OR/backup.env ] || { printf 'DATABASE_URL=\nAUTO_RESTORE=off\n' > $OR/backup.env; chmod 600 $OR/backup.env; }
unit() { # unit NAME SCRIPT  (service)
  cat > /etc/systemd/system/$1.service <<UNIT
[Unit]
Description=Ttbik $1
After=docker.service network-online.target
[Service]
Type=oneshot
ExecStart=/bin/bash $OR/agent/$2
TimeoutStartSec=3000
UNIT
}
timer() { # timer NAME "OnXxx lines"
  cat > /etc/systemd/system/$1.timer <<UNIT
[Unit]
Description=Ttbik $1 timer
[Timer]
$2
Persistent=true
[Install]
WantedBy=timers.target
UNIT
}
unit ttbik-updater updater.sh;   timer ttbik-updater  $'OnBootSec=1min\nOnUnitActiveSec=2min'
unit ttbik-backup backup.sh;     timer ttbik-backup   'OnCalendar=*-*-* 03:30:00 UTC'
unit ttbik-watchdog watchdog.sh; timer ttbik-watchdog $'OnBootSec=5min\nOnUnitActiveSec=5min'
systemctl daemon-reload
bash $OR/agent/ensure-sweeper.sh
systemctl enable --now ttbik-updater.timer ttbik-backup.timer ttbik-watchdog.timer
touch /var/lib/ttbik/force-update   # first run rebuilds so the compose changes take effect
systemctl start --no-block ttbik-updater.service || true
echo "agent installed. timers:"; systemctl list-timers 'ttbik-*' --no-pager | head -6
