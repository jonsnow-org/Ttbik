#!/usr/bin/env bash
# Nova tool-payload benchmark — one command, no Studio, no token, no network.
# Calls the real tool functions in src/lib/coderAgent.ts on a fixed fixture (big files, node_modules, .next,
# dist, media, binaries) twice: once with the earlier behaviour and once with the current one, and prints the table.
#
#   bash scripts/nova-speed/bench.sh
#
# Optional: CODER_TOOL_RESULT_MAX (default 9000, the cap the bot uses) and NOVA_BENCH_TOK (chars per token, default 3.5).
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ ! -x athar/node_modules/.bin/jest ] || [ ! -d athar/node_modules/ts-jest ]; then
  echo "installing the test runner (jest + ts-jest) from athar's lockfile…"
  (cd athar && npm ci --ignore-scripts --no-audit --no-fund)
fi
cd athar
exec npx jest --config ../jest.nova-bench.config.js --rootDir .. --runInBand "$@"
