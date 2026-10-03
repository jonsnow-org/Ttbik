#!/usr/bin/env bash
# Restore the single good backup into Supabase WITHOUT overwriting anything that has data:
#   - missing tables are created, tables that are EMPTY get their rows back, non-empty tables are left alone.
#   - the current (possibly damaged) state is saved first as pre-restore.dump.
#   restore.sh --dry-run   shows what would be restored and changes nothing.
set -uo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
pgv() { docker run --rm -i --network host -v "$BK:/b" postgres:17-alpine "$@"; }
DUMP="$BK/latest.dump"
[ -s "$DUMP" ] || { echo "no backup at $DUMP"; exit 1; }
[ -n "$PGURL" ] || { echo "DATABASE_URL missing in backup.env"; exit 1; }
pgv pg_restore --list /b/latest.dump > "$BK/toc.txt" 2>/dev/null || { echo "backup is unreadable"; exit 1; }

TABLES=$(sed -nE 's/^[0-9]+; [0-9]+ [0-9]+ TABLE DATA public (\S+) .*/\1/p' "$BK/toc.txt")
TODO=""
for t in $TABLES; do
  reg=$(pgv psql "$PGURL" -At -c "select to_regclass('public.\"$t\"') is null" 2>/dev/null) || { echo "database unreachable"; exit 1; }
  if [ "$reg" = "t" ]; then TODO="$TODO $t"; continue; fi
  has=$(pgv psql "$PGURL" -At -c "select exists(select 1 from public.\"$t\")" 2>/dev/null)
  [ "$has" = "f" ] && TODO="$TODO $t"
done
echo "tables to restore (missing or empty):${TODO:- none}"
[ $DRY = 1 ] && exit 0
[ -n "$TODO" ] || { echo "nothing to restore"; exit 0; }

# 1) safety snapshot of the current state (kept: only the latest one)
pgv pg_dump "$PGURL" --schema=public -Fc --no-owner --no-privileges -f /b/pre-restore.tmp 2>/dev/null \
  && mv -f "$BK/pre-restore.tmp" "$BK/pre-restore.dump" || { echo "snapshot failed; aborting"; exit 1; }

# 2) restore in three passes; "already exists" errors on untouched objects are expected and ignored
ALT=$(echo $TODO | tr ' ' '|')
pgv pg_restore -d "$PGURL" --section=pre-data --no-owner --no-privileges /b/latest.dump >/dev/null 2>&1 || true
{ grep -E '^;' "$BK/toc.txt"
  grep -E "TABLE DATA public ($ALT) " "$BK/toc.txt"
  for t in $TODO; do grep -E "SEQUENCE SET public ${t}_" "$BK/toc.txt"; done
} > "$BK/plan.txt"
pgv pg_restore -d "$PGURL" --section=data -L /b/plan.txt --no-owner --no-privileges /b/latest.dump >"$STATE/restore.log" 2>&1 || true
pgv pg_restore -d "$PGURL" --section=post-data --no-owner --no-privileges /b/latest.dump >>"$STATE/restore.log" 2>&1 || true

FP=$(db_fingerprint || echo "? ?")
echo "$(now) restored:${TODO} -> now $FP" > "$STATE/watchdog_note"
tg_notify "تم الاسترجاع الآلي للجداول:${TODO}. القاعدة الآن: $FP (جداول صفوف). لقطة ما قبل الاسترجاع محفوظة."
echo "done: $FP"
