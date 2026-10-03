#!/usr/bin/env bash
# Daily Supabase backup. Keeps exactly ONE good backup (latest.dump); a new one replaces it
# only after passing checks, so a wiped database can never overwrite the good copy.
set -uo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
exec 9>/var/lock/ttbik-backup.lock; flock -n 9 || exit 0
note() { echo "$(now) $1" > "$STATE/backup_note"; }
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
