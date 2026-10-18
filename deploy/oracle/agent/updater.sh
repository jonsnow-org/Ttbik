#!/usr/bin/env bash
# Pull-based auto-deploy for the Oracle VM (runs every 2 minutes from systemd).
# Pulls the branch; if files that matter here changed, rebuilds the containers.
# A failed build leaves the previous containers running.
set -uo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
exec 9>/var/lock/ttbik-updater.lock; flock -n 9 || exit 0
# The production line is `main` (the same one Vercel and Cloudflare deploy), never a working branch: the file agent/BRANCH can name another
# branch for an emergency (e.g. to pin an older fix), and deleting it falls back to main.
BR="${BRANCH:-$(tr -d ' \n' < "$OR/agent/BRANCH" 2>/dev/null)}"; BR="${BR:-main}"
cd /opt/ttbik || exit 0
if ! git fetch -q --depth 1 origin "$BR" 2>/dev/null; then echo "$(now) fetch failed" > "$STATE/last_update"; report; exit 0; fi
NEW=$(git rev-parse FETCH_HEAD); CUR=$(git rev-parse HEAD)
PROFILES=$(cat "$OR/profiles" 2>/dev/null || true)   # e.g. "--profile site"
PATHS='^(media-bot/|deploy/oracle/)'
case "$PROFILES" in *site*) PATHS='^(media-bot/|deploy/oracle/|src/|public/|prisma/|package(-lock)?\.json|next\.config\.mjs|vercel\.json)';; esac
[ -f "$OR/agent/ATHAR_ON" ] && PATHS="$PATHS|^athar/"
# the site itself (agent/SITE_ON, docs/HOSTING.md): its sources count too
[ -f "$OR/agent/SITE_ON" ] && PATHS="$PATHS|^(src/|public/|prisma/|package(-lock)?\.json|next\.config\.mjs|vercel\.json|scripts/hosting/)"
if [ "$NEW" != "$CUR" ] || [ -f "$STATE/force-update" ]; then
  CHANGED=$(git diff --name-only "$CUR" "$NEW" 2>/dev/null | grep -E "$PATHS" || true)
  git reset -q --hard "$NEW"
  bash "$OR/agent/ensure-sweeper.sh" >/dev/null 2>&1 || true
  bash "$OR/agent/migrate.sh" >/dev/null 2>&1 || true      # new database scripts (deploy/oracle/migrations) are applied here, once each
  if [ -n "$CHANGED" ] || [ -f "$STATE/force-update" ]; then
    rm -f "$STATE/force-update"
    cd "$OR"
    # shellcheck disable=SC2086
    if docker compose $PROFILES up -d --build > "$STATE/update.log" 2>&1; then
      echo "$(now) OK $(git -C /opt/ttbik rev-parse --short HEAD)" > "$STATE/last_update"
      docker image prune -f >/dev/null 2>&1
      docker builder prune -f --reserved-space 12GB >/dev/null 2>&1 || docker builder prune -f --keep-storage 12GB >/dev/null 2>&1 || true   # the build cache never grows past about 12 GB
    else
      echo "$(now) FAILED $(git -C /opt/ttbik rev-parse --short HEAD)" > "$STATE/last_update"
      tg_notify "فشل بناء التحديث $(git -C /opt/ttbik rev-parse --short HEAD). النسخة القديمة ما زالت تعمل."
    fi
    # The site (Next.js: pages, API, bot webhooks, mini apps) is built on its own too (agent/SITE_ON): a failed build leaves the running site in
    # place, can never block the media engine or Athar, and the gate (cloudflare/site-gate) sends visitors to Vercel while this one is down.
    if [ -f "$OR/agent/SITE_ON" ]; then
      if docker compose --profile site up -d --build site > "$STATE/site.log" 2>&1; then
        echo "$(now) OK $(git -C /opt/ttbik rev-parse --short HEAD)" > "$STATE/site_status"
      else
        echo "$(now) FAILED: $(tail -3 "$STATE/site.log" | tr '\n' ' ' | mask | cut -c1-200)" > "$STATE/site_status"
        tg_notify "فشل بناء الموقع على Oracle. النسخة السابقة ما زالت تعمل (إن وُجدت)، والبوابة تحوّل إلى Vercel عند الحاجة."
      fi
    fi
    # Athar is built on its own so a problem there can never block the media engine or the rest.
    if [ -f "$OR/agent/ATHAR_ON" ]; then
      # public address of the management wallet (not a secret); put it in agent/ATHAR_ADMIN to switch the app from "soon" to live
      # secret address of the management panel: created once, kept on this machine, sent only to the owner on Telegram
      NEWPATH=""
      if [ ! -s "$STATE/athar_admin_path" ]; then head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-24 > "$STATE/athar_admin_path"; chmod 600 "$STATE/athar_admin_path"; NEWPATH=1; fi
      export ATHAR_ADMIN_PATH="$(cat "$STATE/athar_admin_path")"
      # throw-away key that only signs free (under 100 KiB) permanent uploads; it holds nothing
      [ -s "$STATE/athar_turbo_key" ] || { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$STATE/athar_turbo_key"; chmod 600 "$STATE/athar_turbo_key"; }
      export ATHAR_TURBO_KEY="$(cat "$STATE/athar_turbo_key")"
      # where token metadata/pictures are asked for (written into the contract at launch): the Vercel mirror in front of this server
      [ -s "$OR/agent/ATHAR_META_BASE" ] && export ATHAR_META_BASE="$(tr -d ' \r\n' < "$OR/agent/ATHAR_META_BASE")"
      [ -f "$OR/agent/ATHAR_ADMIN" ] && export ATHAR_ADMIN="$(tr -d ' \r\n' < "$OR/agent/ATHAR_ADMIN")"
      if docker compose --profile athar up -d --build athar-web > "$STATE/athar.log" 2>&1; then
        echo "$(now) OK" > "$STATE/athar_status"
        if [ -n "$NEWPATH" ]; then tg_notify "رابط إدارة أثر (سرّي، لا تشاركه): https://athar.$(getkv "$OR/.env" PUBLIC_HOST)/$ATHAR_ADMIN_PATH"; fi
        # Test-network twin of the app (same code, own hostname): rehearse and show test tokens without touching the real one.
        # Switched on by agent/ATHAR_TEST_ADMIN (the test wallet's public address). A failure here never affects the real app.
        if [ -s "$OR/agent/ATHAR_TEST_ADMIN" ]; then
          export ATHAR_TEST_ADMIN="$(tr -d ' \r\n' < "$OR/agent/ATHAR_TEST_ADMIN")"
          if docker compose --profile athar up -d --build athar-web-test > "$STATE/athar_test.log" 2>&1; then echo "$(now) OK" > "$STATE/athar_test_status"; else echo "$(now) FAILED: $(tail -3 "$STATE/athar_test.log" | tr '\n' ' ' | mask | cut -c1-200)" > "$STATE/athar_test_status"; fi
        fi
        # Caddyfile is a single-file bind mount: git replaces the file, so the container keeps seeing the old one
        # until it restarts. Restart Caddy only when the file is newer than the running container (certificates persist).
        cid=$(docker compose ps -q caddy 2>/dev/null | head -1)
        cse=$(date -d "$(docker inspect -f '{{.State.StartedAt}}' "$cid" 2>/dev/null)" +%s 2>/dev/null || echo 0)
        cf=$(stat -c %Y "$OR/Caddyfile" 2>/dev/null || echo 0)
        if [ -n "$cid" ] && [ "$cf" -gt "$cse" ]; then docker compose restart caddy >> "$STATE/athar.log" 2>&1 || true; fi
      else
        echo "$(now) FAILED: $(tail -3 "$STATE/athar.log" | tr '\n' ' ' | mask | cut -c1-200)" > "$STATE/athar_status"
        tg_notify "فشل بناء تطبيق أثر. باقي الخدمات لم تتأثر."
      fi
    fi
  else
    echo "$(now) OK (no relevant changes) $(git rev-parse --short HEAD)" > "$STATE/last_update"
  fi
fi
# Use the room of an enlarged boot volume (agent/grow-disk.sh): a read-only check unless the owner raised the size in the Oracle console.
[ -f "$OR/agent/grow-disk.sh" ] && { bash "$OR/agent/grow-disk.sh" >/dev/null 2>&1 || true; }
# The isolated runner of the Sham notebooks (agent/install-sham.sh, owner-approved; it never touches Athar or the media engine). Done outside the
# update block above, once per version of the installer: when the update that brings it arrives, the running updater is still the old file.
if [ -f "$OR/agent/SHAM_ON" ] && [ -f "$OR/agent/install-sham.sh" ]; then
  SV=$(sha1sum "$OR/agent/install-sham.sh" | cut -c1-12)
  [ -f "$STATE/sham_ok_$SV" ] || { bash "$OR/agent/install-sham.sh" > "$STATE/sham_install.log" 2>&1 && touch "$STATE/sham_ok_$SV"; }
fi
# The Zenobia ledger wallet (agent/install-zenobia.sh, owner-approved 2026-10-12; isolated like the Sham runner, never touches Athar or the media engine).
# Done once per version of its files; a failure here changes nothing else.
if [ -f "$OR/agent/ZENOBIA_ON" ] && [ -f "$OR/agent/install-zenobia.sh" ]; then
  ZV=$(cat "$OR/agent/install-zenobia.sh" "$OR/zenobia-ledger/ledger.mjs" "$OR/zenobia-ledger/sweep.mjs" "$OR/zenobia-ledger/Dockerfile" "$OR/zenobia-ledger/package.json" "$OR/zenobia-ledger/contracts/"*.b64 "$OR/agent/ZENOBIA_COLLECTION_ON" "$OR/agent/ZENOBIA_SILK_ON" "$OR/agent/ZENOBIA_MINT_TO" 2>/dev/null | sha1sum | cut -c1-12)
  # a failed version is retried at most every 6 hours, and the owner is told only the first time
  if [ ! -f "$STATE/zenobia_ok_$ZV" ] && [ -z "$(find "$STATE" -maxdepth 1 -name "zenobia_fail_$ZV" -mmin -360 2>/dev/null)" ]; then
    if bash "$OR/agent/install-zenobia.sh" > "$STATE/zenobia_install.log" 2>&1; then
      touch "$STATE/zenobia_ok_$ZV"
    else
      [ -f "$STATE/zenobia_fail_$ZV" ] || tg_notify "تعذّر تشغيل محفظة سجل زنوبيا. باقي الخدمات لم تتأثر."
      touch "$STATE/zenobia_fail_$ZV"
    fi
  fi
fi
report
