#!/usr/bin/env bash
# Runs the Sham v2 copy on any Linux VM with >= 12 GB RAM (weights ~6 GB on disk, ~8 GB RAM at run time).
# Reads secrets from an env file the owner creates on the VM (never committed): /etc/sham-v2.env with
#   MODELSCOPE_API_TOKEN=...      SHAM_CODE_SIGNING_KEY=...
set -euo pipefail
TAG="${1:-sham-v2:cpu}"
ENVFILE="${SHAM_ENV_FILE:-/etc/sham-v2.env}"
[ -r "$ENVFILE" ] || { echo "missing $ENVFILE (see hosting/sham-v2/README.md)"; exit 1; }
mkdir -p /var/lib/sham-v2 && chown 1000:1000 /var/lib/sham-v2
"${DOCKER:-docker}" rm -f sham-v2 2>/dev/null || true
"${DOCKER:-docker}" run -d --name sham-v2 --restart unless-stopped \
  --env-file "$ENVFILE" -p 127.0.0.1:7860:7860 -v /var/lib/sham-v2:/data \
  --memory "${SHAM_MEMORY:-11g}" --cpus "${SHAM_CPUS:-2}" "$TAG"
echo "started; first start downloads the weights (~6 GB). Status: curl -s localhost:7860/ | head -c 200"
