#!/usr/bin/env bash
# Zenobia ledger wallet: a small container that publishes each closed season's result fingerprint on TON.
# Enabled by the file agent/ZENOBIA_ON (the updater runs this once per version of the files below). Owner-approved 2026-10-12.
#   isolation : its own folder /var/lib/zenobia (root only, 700) mounted into this one container; it never touches /var/lib/ttbik (Athar's keys),
#               the media engine, the Athar app or the database. 256 MB RAM, no ports, no docker socket.
#   the key   : generated inside the container on first run, mode 600, never printed or sent. Only the public address is shown to the owner.
#   spending  : the program can only send 0.001 TON from its own wallet to its own address with the season fingerprint as the comment.
#   remove    : delete agent/ZENOBIA_ON and run `docker rm -f zenobia-ledger` (the key stays in /var/lib/zenobia).
set -euo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
ZDIR=/var/lib/zenobia
mkdir -p "$ZDIR"; chmod 700 "$ZDIR"

docker build -q -t zenobia-ledger "$OR/zenobia-ledger"
docker rm -f zenobia-ledger >/dev/null 2>&1 || true
TC_KEY="$(getkv "$OR/.env" TONCENTER_API_KEY)"
docker run -d --name zenobia-ledger --restart unless-stopped --memory 256m \
  -v "$ZDIR":/state -e ZNB_DIR=/state -e ZNB_NETWORK=mainnet -e ZNB_SITE="$SITE_URL" ${TC_KEY:+-e TONCENTER_API_KEY="$TC_KEY"} \
  zenobia-ledger >/dev/null

# tell the owner the PUBLIC address once, so he can fund it with a little TON (0.2 is enough for years of weekly posts)
for _ in $(seq 1 30); do [ -s "$ZDIR/address" ] && break; sleep 1; done
if [ -s "$ZDIR/address" ] && [ ! -f "$ZDIR/notified" ]; then
  tg_notify "محفظة سجل زنوبيا جاهزة. عنوانها العام (أرسل إليها نحو 0.2 TON فقط، وهي لا تنفق إلا على نشر بصمة الموسم الأسبوعية):
$(cat "$ZDIR/address")"
  touch "$ZDIR/notified"
fi
