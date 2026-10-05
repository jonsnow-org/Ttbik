#!/usr/bin/env bash
# Daily Supabase backup. Keeps exactly ONE good backup (latest.dump); a new one replaces it
# only after passing checks, so a wiped database can never overwrite the good copy.
set -uo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
exec 9>/var/lock/ttbik-backup.lock; flock -n 9 || exit 0
note() { echo "$(now) $1" > "$STATE/backup_note"; }
# Athar's own files (the copies of every picture and the takedown list): one tarball each, replaced only by a good one
for d in athar athar-test; do
  [ -d "/var/lib/ttbik/$d" ] && tar -czf "$BK/$d-data.tgz.tmp" -C "/var/lib/ttbik/$d" . 2>/dev/null && [ -s "$BK/$d-data.tgz.tmp" ] && mv -f "$BK/$d-data.tgz.tmp" "$BK/$d-data.tgz"
  rm -f "$BK/$d-data.tgz.tmp"
done
# Weekly: a full copy of the whole project source (every branch and tag, as one git bundle). The old copy is replaced only by a new one that verifies.
WKF="$STATE/last_full_archive"
if [ ! -f "$WKF" ] || [ $(( $(date +%s) - $(stat -c %Y "$WKF") )) -gt 604800 ]; then
  if ( cd /opt/ttbik && git fetch -q origin 2>/dev/null; [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = true ] && git fetch -q --unshallow origin 2>/dev/null; git bundle create "$BK/repo.bundle.tmp" --all >/dev/null 2>&1 && git bundle verify "$BK/repo.bundle.tmp" >/dev/null 2>&1 ); then
    mv -f "$BK/repo.bundle.tmp" "$BK/repo-latest.bundle"; now > "$WKF"; echo "$(now) OK $(du -m "$BK/repo-latest.bundle" | cut -f1) MB" > "$STATE/repo_backup_note"
    # One compressed file of ALL our work, rebuilt weekly; the old one is replaced only by a new one that reads back correctly.
    #   ttbik-full-latest.tar.gz  (stays on this machine, mode 600): the whole project history + the database dump + Athar's data
    #   ttbik-code-latest.tar.gz  (also sent to the owner on Telegram, replacing last week's message): the same WITHOUT the database,
    #                             because the database holds other people's personal data and must not leave this machine
    # Neither holds passwords or tokens; the manifest lists where those live.
    FT="$BK/full.tmp"; rm -rf "$FT"; mkdir -p "$FT/ttbik"
    cp "$BK/repo-latest.bundle" "$FT/ttbik/" 2>/dev/null
    for d in athar athar-test; do [ -f "$BK/$d-data.tgz" ] && cp "$BK/$d-data.tgz" "$FT/ttbik/"; done
    cat > "$FT/ttbik/MANIFEST.txt" <<MAN
Our whole work, saved $(now)
- repo-latest.bundle   every branch and tag of the project (restore: git clone repo-latest.bundle ttbik)
- athar*-data.tgz      Athar's own files (takedown list, copies of pictures)
- database.dump        (only in the full file on the server) restore: pg_restore --no-owner -d <database> database.dump
NOT inside (secrets, keep them in your own password manager): bot tokens, DATABASE_URL, Vercel variables (ATHAR_PRIMARY,
NEXT_PUBLIC_ATHAR_META_BASE, ATHAR_ADMIN, ...), Cloudflare account, wallet words, Telegram bot tokens.
Where things run: site on Vercel (main branch), server on Oracle (deploy/oracle), Athar front door on Cloudflare (Worker athar-meta,
deployed from cloudflare/athar-front), token pictures on Arweave.
MAN
    if tar -czf "$BK/ttbik-code.tmp.tgz" -C "$FT" ttbik 2>/dev/null && tar -tzf "$BK/ttbik-code.tmp.tgz" >/dev/null 2>&1; then
      mv -f "$BK/ttbik-code.tmp.tgz" "$BK/ttbik-code-latest.tar.gz"
      [ -f "$BK/latest.dump" ] && cp "$BK/latest.dump" "$FT/ttbik/database.dump"
      if tar -czf "$BK/ttbik-full.tmp.tgz" -C "$FT" ttbik 2>/dev/null && tar -tzf "$BK/ttbik-full.tmp.tgz" >/dev/null 2>&1; then
        mv -f "$BK/ttbik-full.tmp.tgz" "$BK/ttbik-full-latest.tar.gz"; chmod 600 "$BK/ttbik-full-latest.tar.gz"
      fi
      # the code copy goes to the owner on Telegram (limit 50 MB), and last week's message is deleted
      SZ=$(stat -c %s "$BK/ttbik-code-latest.tar.gz")
      if [ -n "$BOT_TOKEN" ] && [ -n "$OWNER_ID" ] && [ "$SZ" -lt 47000000 ]; then
        R=$(curl -s -m 120 "https://api.telegram.org/bot${BOT_TOKEN}/sendDocument" -F "chat_id=$OWNER_ID" -F "document=@$BK/ttbik-code-latest.tar.gz;filename=ttbik-code-$(date -u +%F).tar.gz" -F "caption=🗄 Weekly copy of all our work (code + Athar data). The previous one is deleted." 2>/dev/null)
        NEWID=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['result']['message_id'])" 2>/dev/null)
        if [ -n "$NEWID" ]; then
          OLDID=$(cat "$STATE/tg_backup_msg" 2>/dev/null)
          [ -n "$OLDID" ] && curl -s -m 20 "https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage" --data-urlencode "chat_id=$OWNER_ID" --data-urlencode "message_id=$OLDID" >/dev/null 2>&1
          echo "$NEWID" > "$STATE/tg_backup_msg"
          echo "$(now) OK $(du -m "$BK/ttbik-full-latest.tar.gz" | cut -f1) MB full, $((SZ/1048576)) MB code, sent to Telegram" > "$STATE/repo_backup_note"
        else echo "$(now) OK full archive made; the Telegram copy could not be sent" > "$STATE/repo_backup_note"; fi
      else echo "$(now) OK full archive made (too big or no Telegram settings: not sent)" > "$STATE/repo_backup_note"; fi
    fi
    rm -rf "$FT"
  else
    rm -f "$BK/repo.bundle.tmp"; echo "$(now) FAILED, kept the previous copy" > "$STATE/repo_backup_note"
  fi
fi
[ -n "$PGURL" ] || { note "not configured (backup.env missing DATABASE_URL)"; report; exit 0; }
FP=$(db_fingerprint) || { note "database unreachable, kept previous backup"; report; exit 0; }
set -- $FP; T=$1; R=$2
if [ -f "$STATE/good_fingerprint" ]; then
  set -- $(cat "$STATE/good_fingerprint"); GT=$1; GR=$2
  if [ "$GR" -ge 50 ] && { [ $((R*100)) -lt $((GR*80)) ] || [ $((T*100)) -lt $((GT*80)) ]; }; then
    note "REFUSED: database shrank ($GR -> $R rows); kept the good backup"
    tg_notify "رفضتُ نسخة اليوم لأن عدد صفوف القاعدة تقلّص ($GR ← $R). النسخة السليمة القديمة محفوظة."
    report; exit 0
  fi
fi
TMP="$BK/new.dump.tmp"
if ! pg pg_dump "$PGURL" --schema=public -Fc --no-owner --no-privileges > "$TMP" 2>"$STATE/backup_err.log"; then
  rm -f "$TMP"; note "dump failed: $(tail -c 200 "$STATE/backup_err.log" | mask | tr '\n' ' ')"; tg_notify "فشلت النسخة الاحتياطية اليومية."; report; exit 0
fi
if [ ! -s "$TMP" ] || ! pg pg_restore --list < "$TMP" >/dev/null 2>&1; then
  rm -f "$TMP"; note "dump failed integrity check; kept previous backup"; report; exit 0
fi
mv -f "$TMP" "$BK/latest.dump"
echo "$T $R" > "$STATE/good_fingerprint"
note "OK $T tables, $R rows"
report
