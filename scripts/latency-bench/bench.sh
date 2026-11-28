#!/usr/bin/env bash
# Response-latency benchmark for Nova and Sham Pro — one command, no Studio, no token, no network.
# Imports the real policy from src/lib/coderSections.ts and prints the before/after numbers in ms.
#
#   bash scripts/latency-bench/bench.sh
#
# Needs the repo's root dependencies once (npm ci) for @prisma/client and the app modules, plus athar's jest/ts-jest.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ ! -x athar/node_modules/.bin/jest ] || [ ! -d athar/node_modules/ts-jest ]; then
  echo "installing the test runner (jest + ts-jest) from athar's lockfile…"
  (cd athar && npm ci --ignore-scripts --no-audit --no-fund)
fi
if [ ! -d node_modules/@prisma/client ] || [ ! -d node_modules/.prisma/client ]; then
  echo "root dependencies are missing: run  npm ci  once at the repo root (it generates the Prisma client)." >&2
  exit 1
fi
cd athar
exec npx jest --config ../jest.latency.config.js --rootDir .. --runInBand "$@"
