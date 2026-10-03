#!/usr/bin/env bash
# Every 5 min: tells an OUTAGE (database unreachable -> do nothing) from DATA LOSS (reachable but emptied).
# Automatic restore happens only after the loss has persisted 24h and every safety condition holds.
set -uo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
exec 9>/var/lock/ttbik-watchdog.lock; flock -n 9 || exit 0
wd() { echo "$(now) $1" > "$STATE/watchdog_note"; }
[ -n "$PGURL" ] || { wd "not configured"; exit 0; }
[ -f "$STATE/good_fingerprint" ] || { wd "waiting for the first good backup"; exit 0; }
FP=$(db_fingerprint) || { wd "database unreachable (outage: no action)"; exit 0; }
set -- $FP; T=$1; R=$2; set -- $(cat "$STATE/good_fingerprint"); GT=$1; GR=$2
if ! { [ "$GR" -ge 50 ] && { [ $((R*100)) -lt $((GR*20)) ] || [ $((T*100)) -lt $((GT*50)) ]; }; }; then
  rm -f "$STATE/loss_since" "$STATE/loss_n12" "$STATE/loss_n23"; wd "healthy ($T tables, $R rows)"
  # daily read-only rehearsal of the restore path (changes nothing)
  if [ -s "$BK/latest.dump" ] && [ -z "$(find "$STATE/restore_selftest" -mmin -1440 2>/dev/null)" ]; then
    if out=$(bash "$OR/agent/restore.sh" --dry-run 2>&1); then echo "$(now) dry-run OK: $(echo "$out" | head -1 | cut -c1-120)" > "$STATE/restore_selftest"
    else echo "$(now) dry-run FAILED: $(echo "$out" | tail -1 | mask | cut -c1-140)" > "$STATE/restore_selftest"; tg_notify "فشل الاختبار الذاتي للاسترجاع. راجع التقرير."; fi
    report
  fi
  exit 0
fi
[ -f "$STATE/loss_since" ] || { epoch > "$STATE/loss_since"
  tg_notify "⚠️ اشتباه بفقدان بيانات Supabase (الصفوف $GR ← $R). سأنتظر 24 ساعة قبل أي استرجاع. للإيقاف أرسل /restore_cancel لبوت الوسائط."; }
H=$(( ($(epoch) - $(cat "$STATE/loss_since")) / 3600 ))
[ "$H" -ge 12 ] && [ ! -f "$STATE/loss_n12" ] && { touch "$STATE/loss_n12"; tg_notify "مضت 12 ساعة والبيانات ما زالت مفقودة. الاسترجاع الآلي بعد 12 ساعة أخرى (/restore_cancel للإيقاف)."; }
[ "$H" -ge 23 ] && [ ! -f "$STATE/loss_n23" ] && { touch "$STATE/loss_n23"; tg_notify "⏰ بعد ساعة سيبدأ الاسترجاع الآلي (/restore_cancel للإيقاف)."; }
wd "DATA LOSS suspected for ${H}h (rows $GR -> $R)"
[ "$H" -ge 24 ] || exit 0
why=""
[ "$AUTO_RESTORE" = "on" ] || why="AUTO_RESTORE is off"
[ -f "$STATE/restore_cancel" ] && why="cancelled by owner"
[ -s "$BK/latest.dump" ] || why="no backup"
[ -n "$(find "$BK/latest.dump" -mtime -7 2>/dev/null)" ] || why="backup older than 7 days"
docker run --rm -i postgres:17-alpine pg_restore --list < "$BK/latest.dump" >/dev/null 2>&1 || why="backup unreadable"
[ "$GR" -gt "$R" ] || why="backup has no more data than the database"
LR=$(cat "$STATE/last_restore" 2>/dev/null || echo 0)
[ $(( $(epoch) - LR )) -ge 604800 ] || why="restored less than 7 days ago"
if [ -n "$why" ]; then wd "restore blocked: $why"; exit 0; fi
epoch > "$STATE/last_restore"
bash "$OR/agent/restore.sh" > "$STATE/restore_run.log" 2>&1
rm -f "$STATE/loss_since" "$STATE/loss_n12" "$STATE/loss_n23"
report
