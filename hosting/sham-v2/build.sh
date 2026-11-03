#!/usr/bin/env bash
# Stages the Sham v2 Studio app (the exact files the sham-v2-server Studio gets) and builds the CPU image.
# Usage: hosting/sham-v2/build.sh [image-tag]     (default sham-v2:cpu). Needs docker (or podman via DOCKER=podman).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAG="${1:-sham-v2:cpu}"
CTX="$(mktemp -d)"
trap 'rm -rf "$CTX"' EXIT
mkdir -p "$CTX/app"
python3 "$ROOT/scripts/transplant/stage_sham_v2_studio.py" "$CTX/app"
cp "$ROOT/hosting/sham-v2/Dockerfile" "$CTX/Dockerfile"
"${DOCKER:-docker}" build -t "$TAG" "$CTX"
echo "built $TAG"
