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
chown 1000:1000 "$ZDIR"   # the container runs as the image's "node" user (uid 1000) and must be able to write its key here

docker build -q -t zenobia-ledger "$OR/zenobia-ledger"
docker rm -f zenobia-ledger >/dev/null 2>&1 || true
TC_KEY="$(getkv "$OR/.env" TONCENTER_API_KEY)"
# The Caravan Passport collection is deployed (once) only when the owner committed agent/ZENOBIA_COLLECTION_ON; the trial passport goes only to the
# public address committed in agent/ZENOBIA_MINT_TO. The ledger program enforces a hard ceiling on this spending (0.12 in total).
# The URLs below are written into the contract for good (the owner can change them later), so they are fixed here, not taken from the environment.
EXTRA=()
if [ -f "$OR/agent/ZENOBIA_COLLECTION_ON" ]; then
  EXTRA+=(-e ZNB_DEPLOY_COLLECTION=1 -e ZNB_PASSPORT_BASE="https://ttbik.vercel.app/api/zenobia/passport/" -e ZNB_COLLECTION_JSON="https://ttbik.vercel.app/zenobia/collection.json")
  # the key the Oracle health report already uses to talk to the site (never printed); lets the ledger read the passport queue
  [ -n "${BOT_TOKEN:-}" ] && EXTRA+=(-e ZNB_OPS_KEY="$(printf %s "$BOT_TOKEN" | sha256sum | cut -c1-48)")
  [ -s "$OR/agent/ZENOBIA_MINT_TO" ] && EXTRA+=(-e ZNB_TRIAL_MINT_TO="$(tr -d ' \r\n' < "$OR/agent/ZENOBIA_MINT_TO")")
fi
# Silk Road Passports (the paid, tradable passport): switched on only when the owner commits agent/ZENOBIA_SILK_ON. The ledger deploys the collection ONCE (0.04)
# and mints only passports whose payment it has checked on the chain itself. Royalty (7% on resales) goes to the address in agent/ZENOBIA_MINT_TO.
if [ -f "$OR/agent/ZENOBIA_SILK_ON" ]; then
  EXTRA+=(-e ZNB_SILK_ON=1 -e ZNB_SILK_BASE="https://ttbik.vercel.app/api/zenobia/silk/" -e ZNB_SILK_COLLECTION_JSON="https://ttbik.vercel.app/zenobia/silk-collection.json")
  [ -n "${BOT_TOKEN:-}" ] && ! printf '%s\n' "${EXTRA[@]}" | grep -q ZNB_OPS_KEY && EXTRA+=(-e ZNB_OPS_KEY="$(printf %s "$BOT_TOKEN" | sha256sum | cut -c1-48)")
  [ -s "$OR/agent/ZENOBIA_MINT_TO" ] && EXTRA+=(-e ZNB_SILK_ROYALTY_TO="$(tr -d ' \r\n' < "$OR/agent/ZENOBIA_MINT_TO")")
fi
docker run -d --name zenobia-ledger --restart unless-stopped --memory 256m \
  -v "$ZDIR":/state -e ZNB_DIR=/state -e ZNB_NETWORK=mainnet -e ZNB_SITE="$SITE_URL" ${TC_KEY:+-e TONCENTER_API_KEY="$TC_KEY"} \
  ${EXTRA[@]+"${EXTRA[@]}"} zenobia-ledger >/dev/null

# tell the owner the PUBLIC address once, so he can fund it with a little TON (0.2 is enough for years of weekly posts)
for _ in $(seq 1 30); do [ -s "$ZDIR/address" ] && break; sleep 1; done
if [ ! -s "$ZDIR/address" ]; then
  # the container did not come up: say why (its log never contains the key), and let the updater retry later
  echo "zenobia-ledger did not write its address; last log lines:"; docker logs --tail 5 zenobia-ledger 2>&1 | mask
  tg_notify "محفظة سجل زنوبيا لم تبدأ: $(docker logs --tail 3 zenobia-ledger 2>&1 | mask | tr '\n' ' ' | cut -c1-240)"
  exit 1
fi
if [ ! -f "$ZDIR/notified" ]; then
  tg_notify "محفظة سجل زنوبيا جاهزة. عنوانها العام (أرسل إليها نحو 0.2 TON فقط، وهي لا تنفق إلا على نشر بصمة الموسم الأسبوعية):
$(cat "$ZDIR/address")"
  touch "$ZDIR/notified"
fi
