#!/usr/bin/env bash
# Applies new SQL files from deploy/oracle/migrations to the live database, once each (by name + checksum), in name order.
# Every file must be safe to repeat (create ... if not exists). Nothing for the owner to run by hand.
set -uo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
DIR="$OR/migrations"; LOG="$STATE/migrations_applied"; NOTE="$STATE/migrations_note"
[ -d "$DIR" ] || exit 0
[ -n "$PGURL" ] || { echo "$(now) skipped: no DATABASE_URL in backup.env" > "$NOTE"; exit 0; }
touch "$LOG"
APPLIED=0; FAILED=""
for f in $(ls "$DIR"/*.sql 2>/dev/null | sort); do
  name=$(basename "$f"); sum=$(sha256sum "$f" | cut -c1-16)
  grep -q "^$name $sum" "$LOG" && continue
  if pg psql "$PGURL" -v ON_ERROR_STOP=1 -q < "$f" > "$STATE/migrate_$name.out" 2>&1; then
    echo "$name $sum $(now)" >> "$LOG"; APPLIED=$((APPLIED+1))
  else
    FAILED="$name"; break
  fi
done
if [ -n "$FAILED" ]; then
  echo "$(now) FAILED $FAILED: $(tail -c 300 "$STATE/migrate_$FAILED.out" | mask | tr '\n' ' ')" > "$NOTE"
  tg_notify "فشل تطبيق ملف قاعدة البيانات $FAILED. لم يتغير شيء قبله."
elif [ "$APPLIED" -gt 0 ]; then
  echo "$(now) OK applied $APPLIED" > "$NOTE"
  tg_notify "طُبّقت $APPLIED تحديثات على قاعدة البيانات تلقائياً."
else
  echo "$(now) up to date" > "$NOTE"
fi
