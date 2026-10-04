#!/usr/bin/env bash
# Shared helpers for the Oracle agent scripts (updater / backup / watchdog / restore).
OR=/opt/ttbik/deploy/oracle
STATE=/var/lib/ttbik
BK=/var/backups/ttbik
mkdir -p "$STATE" "$BK"

# Read single KEY=value lines without sourcing (media.env holds multi-line cookies).
getkv() { # getkv FILE KEY
  [ -f "$1" ] || return 0
  grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- | sed -E 's/^"//; s/"$//' || true
}
BOT_TOKEN="$(getkv "$OR/media.env" BOT_TOKEN)"
OWNER_ID="$(getkv "$OR/media.env" OWNER_ID)"
SITE_URL="$(getkv "$OR/media.env" FEED_API_URL | sed -E 's#(https?://[^/]+).*#\1#')"
SITE_URL="${SITE_URL:-https://ttbik.vercel.app}"
DATABASE_URL="$(getkv "$OR/backup.env" DATABASE_URL)"
AUTO_RESTORE="$(getkv "$OR/backup.env" AUTO_RESTORE)"
# Owner enabled guarded auto-restore (2026-10-03). Delete agent/AUTO_RESTORE_ON to go back to backup.env control.
[ -f "$OR/agent/AUTO_RESTORE_ON" ] && AUTO_RESTORE=on
# Prisma URLs carry pgbouncer params and often the transaction-pooler port; pg_dump needs neither.
PGURL="${DATABASE_URL%%\?*}"; PGURL="${PGURL/:6543\//:5432/}"

mask() { sed -E 's#bot[0-9]+:[A-Za-z0-9_-]+#bot***#g; s#(TOKEN|SECRET|KEY|PASSWORD)=[^ ]+#\1=***#g; s#postgres(ql)?://[^ ]+#postgres://***#g'; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
epoch() { date -u +%s; }

tg_notify() { # tg_notify "text"
  [ -n "$BOT_TOKEN" ] && [ -n "$OWNER_ID" ] || return 0
  curl -s -m 15 "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=$OWNER_ID" --data-urlencode "text=🛰 Oracle: $1" >/dev/null 2>&1 || true
}

pg() { docker run --rm -i --network host postgres:17-alpine "$@"; }

# fingerprint "<tables> <rows>" of the public schema (exact counts); empty output = unreachable.
db_fingerprint() {
  [ -n "$PGURL" ] || return 1
  local q tables rows
  tables=$(pg psql "$PGURL" -At -c "select count(*) from pg_tables where schemaname='public'" 2>/dev/null) || return 1
  q=$(pg psql "$PGURL" -At -c "select coalesce(string_agg(format('select count(*) c from public.%I', tablename),' union all '),'select 0 c') from pg_tables where schemaname='public'" 2>/dev/null) || return 1
  rows=$(pg psql "$PGURL" -At -c "select coalesce(sum(c),0) from ($q) t" 2>/dev/null) || return 1
  echo "${tables:-0} ${rows:-0}"
}

report() { # report  -> POST a masked health summary to the site (read by the supervisor)
  [ -n "$BOT_TOKEN" ] || return 0
  local key; key=$(printf %s "$BOT_TOKEN" | sha256sum | cut -c1-48)
  python3 - "$OR" "$STATE" "$BK" <<'PY' 2>/dev/null | curl -s -m 20 -o /dev/null -X POST "$SITE_URL/api/ops/oracle-status" -H "x-ops-key: $key" -H 'content-type: application/json' --data-binary @- || true
import json,subprocess,sys,os,re,time
OR,STATE,BK=sys.argv[1:4]
def sh(c):
    try: return subprocess.run(c,shell=True,capture_output=True,text=True,timeout=20).stdout.strip()
    except Exception: return ""
def rd(p,n=0):
    try:
        t=open(p).read()
        return t if not n else "\n".join(t.splitlines()[-n:])
    except Exception: return ""
def mask(s):
    s=re.sub(r'bot[0-9]+:[A-Za-z0-9_-]+','bot***',s)
    s=re.sub(r'(TOKEN|SECRET|KEY|PASSWORD)=\S+',r'\1=***',s)
    return re.sub(r'postgres(ql)?://\S+','postgres://***',s)
bk=os.path.join(BK,"latest.dump")
out={
 "commit": sh(f"git -C {OR}/../.. rev-parse --short HEAD"),
 "containers": sh("docker ps --format '{{.Names}}|{{.Status}}'").splitlines(),
 "mem": sh("free -m | awk 'NR==2{print $3\"/\"$2\" MB\"}'"),
 "disk": sh("df -h / | awk 'NR==2{print $3\"/\"$2\" (\"$5\")\"}'"),
 "load": sh("cut -d' ' -f1-3 /proc/loadavg"),
 "update": {"last": rd(f"{STATE}/last_update").strip(), "tail": mask(rd(f"{STATE}/update.log",12))},
 "backup": {"exists": os.path.exists(bk), "age_h": round((time.time()-os.path.getmtime(bk))/3600,1) if os.path.exists(bk) else None,
            "size_mb": round(os.path.getsize(bk)/1048576,1) if os.path.exists(bk) else None, "note": rd(f"{STATE}/backup_note").strip()},
 "watchdog": rd(f"{STATE}/watchdog_note").strip(),
 "sweeper": rd(f"{STATE}/sweeper_note").strip(),
 "athar": rd(f"{STATE}/athar_status").strip(),
 "athar_test": rd(f"{STATE}/athar_test_status").strip(),
 "bots_health": (lambda t: (json.loads(t) if t.strip().startswith("{") else t[:200]))(rd(f"{STATE}/bots_health.json")),
 "restore_selftest": rd(f"{STATE}/restore_selftest").strip(),
 "auto_restore": os.path.exists(f"{OR}/agent/AUTO_RESTORE_ON"),
 "sent_at": time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
}
print(json.dumps(out))
PY
}
