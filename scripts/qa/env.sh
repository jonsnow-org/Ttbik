# Local QA environment for the MARRIAGE_BOT mini app — never touches production.
#   bash scripts/qa/env.sh up      # postgres + schema + seed + telegram mock + next (build+start on :3100)
#   bash scripts/qa/env.sh seed    # reseed
#   bash scripts/qa/env.sh down
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
QA="${QA_DIR:-/workspace/qa}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | tail -1)}"
export PGPORT=54329 TG_MOCK_PORT=54400 PORT=3100
export DATABASE_URL="postgresql://qa@localhost:54329/matchqa"
export MATCH_ENABLE_ATHAR="${MATCH_ENABLE_ATHAR:-1}" SUPER_ADMIN_TELEGRAM_ID=9000 NEXT_PUBLIC_SITE_URL="http://localhost:3100" MATCH_REALTIME=off
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54400/sb" NEXT_PUBLIC_SUPABASE_ANON_KEY="qa-anon" SUPABASE_SERVICE_ROLE_KEY="qa-service"
export NODE_OPTIONS="--require $ROOT/scripts/qa/intercept.cjs"
mkdir -p "$QA"
case "${1:-up}" in
  up)
    [ -d "$QA/pgdata" ] || "$PGBIN/initdb" -D "$QA/pgdata" -U qa --auth=trust >/dev/null
    "$PGBIN/pg_ctl" -D "$QA/pgdata" -o "-p $PGPORT -k /tmp" -l "$QA/pg.log" status >/dev/null 2>&1 || "$PGBIN/pg_ctl" -D "$QA/pgdata" -o "-p $PGPORT -k /tmp" -l "$QA/pg.log" start
    sleep 1; createdb -h /tmp -p $PGPORT -U qa matchqa 2>/dev/null || true
    (cd "$ROOT" && NODE_OPTIONS= npx prisma db push --skip-generate --accept-data-loss >/dev/null && psql -h /tmp -p $PGPORT -U qa matchqa -q -f prisma/migration_match_app.sql >/dev/null 2>&1 || true)
    (cd "$ROOT" && NODE_OPTIONS= node scripts/qa/seed.cjs)
    pkill -f scripts/qa/tg-mock.cjs || true
    NODE_OPTIONS= setsid nohup node "$ROOT/scripts/qa/tg-mock.cjs" > "$QA/tg-mock.log" 2>&1 < /dev/null &
    if [ "${SKIP_BUILD:-0}" != 1 ]; then (cd "$ROOT" && NODE_OPTIONS= npx next build --webpack > "$QA/build.log" 2>&1); fi
    pkill -f "next start -p 3100" || true
    (cd "$ROOT" && setsid nohup npx next start -p 3100 > "$QA/next.log" 2>&1 < /dev/null &)
    echo "QA env up: http://localhost:3100/match-app/qa-bot (telegram mock :54400)";;
  seed) (cd "$ROOT" && NODE_OPTIONS= node scripts/qa/seed.cjs);;
  down) pkill -f "next start -p 3100" || true; pkill -f scripts/qa/tg-mock.cjs || true; "$PGBIN/pg_ctl" -D "$QA/pgdata" stop || true;;
esac
