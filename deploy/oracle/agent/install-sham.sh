#!/usr/bin/env bash
# Runner for the Sham AI periodic notebooks on this machine, fully separate from Athar and the media engine. Safe to re-run.
# Enabled by the file agent/SHAM_ON (the updater calls this script as root each time it updates). Owner-approved design, 2026-10-10.
#   code   : /opt/sham, a sparse clone of branch `sham-main` ONLY (folder ai-system/), owned by the system user `sham`
#   secrets: /etc/sham/sham.env (root:sham 0640): Kaggle / GitHub keys go here, put there by the owner; nobody else reads it
#   job    : ai-system/oracle_job.sh from sham-main is run by the timer; if that file does not exist the run does nothing
#   limits : 1 CPU, 4 GB RAM, lowest CPU/IO priority, a 30 GB work folder, no access to /opt/ttbik, /var/lib/ttbik or /var/backups/ttbik
#            (Athar's keys live there) and no Docker. The runner below belongs to root, so job code can never change it.
#   specs  : once, the machine's size (cores, memory, disk, architecture, GPU; no secrets) is sent to the owner on Telegram and kept in
#            /var/lib/ttbik/server_specs.txt, to size the Sham jobs.
set -euo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
SHAM_DIR="${SHAM_DIR:-/opt/sham}"; ENV_DIR="${ENV_DIR:-/etc/sham}"; WORK="${SHAM_WORK:-/var/lib/sham}"

if [ ! -s "$STATE/server_specs.txt" ]; then
  {
    echo "cores: $(nproc)"; echo "cpu: $(lscpu 2>/dev/null | sed -n 's/^Model name:[[:space:]]*//p' | head -1)"; echo "arch: $(uname -m)"
    free -h | sed -n 1,2p; echo "disk /:"; df -h / | tail -1
    if command -v nvidia-smi >/dev/null 2>&1; then echo "gpu: $(nvidia-smi -L 2>/dev/null | head -1)"; else echo "gpu: none found"; fi
    echo "os: $(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-?}")"
  } > "$STATE/server_specs.txt" 2>&1 || true
  tg_notify "مواصفات خادم Oracle (لتحديد حصة دفاتر شام):
$(cat "$STATE/server_specs.txt")" || true
fi

id sham >/dev/null 2>&1 || useradd --system --home-dir "$WORK" --create-home --shell /usr/sbin/nologin sham
install -d -o sham -g sham -m 750 "$SHAM_DIR" "$WORK" "$WORK/work"
install -d -o root -g sham -m 750 "$ENV_DIR"
if [ ! -f "$ENV_DIR/sham.env" ]; then
  printf '# Secrets for the Sham jobs, read only by user sham. One KEY=value per line, no quotes. Example:\n# KAGGLE_USERNAME=\n# KAGGLE_KEY=\n# GITHUB_TOKEN=\n' > "$ENV_DIR/sham.env"
  chown root:sham "$ENV_DIR/sham.env"; chmod 640 "$ENV_DIR/sham.env"
fi

# The runner follows sham-main only (never main), and only the ai-system/ folder of it.
cat > /usr/local/sbin/sham-run <<'RUN'
#!/usr/bin/env bash
set -uo pipefail
SHAM_DIR="${SHAM_DIR:-/opt/sham}"; WORK="${SHAM_WORK:-/var/lib/sham}"; REPO="${SHAM_REPO:-https://github.com/jonsnow-org/Ttbik.git}"; BRANCH=sham-main
if [ "$(du -sxk "$WORK" 2>/dev/null | cut -f1)" -gt $((30*1024*1024)) ]; then echo "sham: $WORK is over 30 GB, skipping this run (clean it)"; exit 0; fi
cd "$SHAM_DIR" || exit 1
if [ ! -d .git ]; then git init -q && git remote add origin "$REPO" && git config core.sparseCheckout true && git sparse-checkout init --cone && git sparse-checkout set ai-system; fi
git fetch -q --depth 1 origin "$BRANCH" || { echo "sham: fetch of $BRANCH failed"; exit 0; }
git checkout -q -f -B "$BRANCH" FETCH_HEAD && git reset -q --hard FETCH_HEAD
JOB="$SHAM_DIR/ai-system/oracle_job.sh"
[ -f "$JOB" ] || { echo "sham: $JOB does not exist on $BRANCH yet, nothing to run"; exit 0; }
cd "$WORK/work" && exec bash "$JOB"
RUN
chmod 755 /usr/local/sbin/sham-run

cat > /etc/systemd/system/sham-run.service <<UNIT
[Unit]
Description=Sham AI periodic job (isolated from Athar)
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=sham
Group=sham
EnvironmentFile=-$ENV_DIR/sham.env
Environment=HOME=$WORK
ExecStart=/usr/local/sbin/sham-run
TimeoutStartSec=6h
Nice=19
IOSchedulingClass=idle
CPUQuota=100%
MemoryMax=4G
MemorySwapMax=0
TasksMax=512
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$SHAM_DIR $WORK
InaccessiblePaths=/opt/ttbik /var/lib/ttbik /var/backups/ttbik /var/lib/docker /run/docker.sock
UNIT
cat > /etc/systemd/system/sham-run.timer <<UNIT
[Unit]
Description=Sham AI periodic job timer
[Timer]
OnCalendar=*-*-* 00,06,12,18:17:00 UTC
RandomizedDelaySec=600
Persistent=true
[Install]
WantedBy=timers.target
UNIT
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  systemctl daemon-reload
  systemctl enable --now sham-run.timer >/dev/null 2>&1 || true
fi
echo "sham runner installed"
