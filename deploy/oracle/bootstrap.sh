#!/usr/bin/env bash
# One-shot, re-runnable setup for an Oracle Ubuntu (arm64/amd64) VM.
#   curl -fsSL https://raw.githubusercontent.com/jonsnow-org/Ttbik/claude/free-services-marketplace-h6rwk2/deploy/oracle/bootstrap.sh | bash
set -euo pipefail
# Works both from an SSH session and from Oracle's "Run command" (no HOME/USER there).
export HOME="${HOME:-/root}"
export DEBIAN_FRONTEND=noninteractive

# Optional one-shot setup: pass the media bot settings as environment variables, e.g.
#   curl -fsSL <this script> | BOT_TOKEN=... OWNER_ID=... ARCHIVE_CHANNEL_ID=... FEED_SECRET=... bash

# Everything lives in main() so bash has read the whole script before running any of it
# (a command that reads stdin can otherwise swallow the rest of a `curl | bash`).
main() {
REPO="https://github.com/jonsnow-org/Ttbik.git"
BRANCH="${BRANCH:-claude/free-services-marketplace-h6rwk2}"
DIR="${DIR:-/opt/ttbik}"
log() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

log "1/7 system packages"
$SUDO apt-get update -y
$SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates iptables-persistent

log "2/7 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | $SUDO sh
fi
$SUDO systemctl enable --now docker
$SUDO usermod -aG docker "${SUDO_USER:-${USER:-ubuntu}}" || true

log "3/7 swap (4GB safety net, skipped if swap already exists)"
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  $SUDO fallocate -l 4G /swapfile && $SUDO chmod 600 /swapfile && $SUDO mkswap /swapfile && $SUDO swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
fi

log "4/7 open ports 80/443 in the VM firewall (also open them in the Oracle console security list)"
for p in 80 443; do
  $SUDO iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || $SUDO iptables -I INPUT 1 -p tcp --dport "$p" -j ACCEPT
done
$SUDO netfilter-persistent save >/dev/null 2>&1 || true

log "5/7 code ($BRANCH -> $DIR)"
if [ -d "$DIR/.git" ]; then
  $SUDO git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  $SUDO git -C "$DIR" reset --hard "origin/$BRANCH"
else
  $SUDO git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR/deploy/oracle"

log "6/7 settings files"
[ -f .env ] || $SUDO cp .env.example .env
[ -f media.env ] || $SUDO cp media.env.example media.env
# A media.env exported from Render (Environment -> Export) and left at /root/media.env is used as is.
if [ -f /root/media.env ]; then
  $SUDO cp /root/media.env media.env
  $SUDO chmod 600 media.env
  $SUDO rm -f /root/media.env
  echo "media.env taken from /root/media.env"
fi
set_kv() { # set_kv KEY VALUE  -> writes KEY=VALUE into media.env (only when VALUE is given)
  local k="$1" v="${2:-}"
  [ -z "$v" ] && return 0
  $SUDO sed -i "/^$k=/d" media.env
  printf '%s=%s\n' "$k" "$v" | $SUDO tee -a media.env >/dev/null
}
for k in BOT_TOKEN OWNER_ID ARCHIVE_CHANNEL_ID FORCE_SUB_CHANNEL FEED_SECRET YTDLP_COOKIES PROXY_URL COBALT_API_KEY; do
  set_kv "$k" "${!k:-}"
done
if ! grep -qE '^PUBLIC_HOST=.+' .env; then
  IP="$(curl -fsS https://api.ipify.org || true)"
  if [ -z "$IP" ]; then echo "Could not detect the public IP; set PUBLIC_HOST in $DIR/deploy/oracle/.env by hand."; exit 1; fi
  HOST="${IP//./-}.sslip.io"
  $SUDO sed -i "s|^PUBLIC_HOST=.*|PUBLIC_HOST=$HOST|" .env
  echo "PUBLIC_HOST set to $HOST (free wildcard DNS, no registration needed)"
fi
if ! grep -qE '^BOT_TOKEN=.+' media.env || ! grep -qE '^OWNER_ID=.+' media.env; then
  cat <<MSG

Fill in the media bot settings, then run this script again:
    sudo nano $DIR/deploy/oracle/media.env      (BOT_TOKEN, OWNER_ID, ARCHIVE_CHANNEL_ID, FEED_SECRET ...)
MSG
  exit 0
fi

log "7/7 build and start (media engine + HTTPS)"
$SUDO docker compose up -d --build
$SUDO docker compose ps
echo
echo "Done. Status any time:  sudo bash $DIR/deploy/oracle/status.sh"
}
main "$@"
