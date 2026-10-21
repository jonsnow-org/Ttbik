#!/usr/bin/env bash
# Starts the coder runner in this codespace and makes its port public (the site reaches it with its own key on every request;
# a private port would need a sign-in the site cannot do).
cd "$(dirname "$0")/.." || exit 1
if ! pgrep -f "node runner.mjs" >/dev/null; then
  RUNNER_SECRET="$CODER_SANDBOX_SECRET" RUNNER_MODE=local RUNNER_HOST=0.0.0.0 RUNNER_PORT=8790 RUNNER_MAX_BOXES=1 RUNNER_MIN_FREE_MB=0 \
    setsid nohup node runner.mjs > /tmp/runner.log 2>&1 < /dev/null &
fi
# the port exists for gh only once it is forwarded: retry for up to 2 minutes, in the background
( for _ in $(seq 1 24); do
    gh codespace ports visibility 8790:public -c "$CODESPACE_NAME" >/tmp/port-visibility.log 2>&1 && exit 0
    sleep 5
  done ) </dev/null >/dev/null 2>&1 &
disown -a 2>/dev/null || true
