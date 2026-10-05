#!/usr/bin/env bash
# Pull the latest code and rebuild what changed. Add --profile site when the site runs here.
set -euo pipefail
DIR="${DIR:-/opt/ttbik}"
BRANCH="${BRANCH:-main}"
cd "$DIR"
git fetch --depth 1 origin "$BRANCH"
git reset --hard "origin/$BRANCH"
cd deploy/oracle
docker compose "$@" up -d --build
docker image prune -f >/dev/null
docker compose "$@" ps
