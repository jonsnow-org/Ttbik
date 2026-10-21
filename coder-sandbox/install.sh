#!/usr/bin/env bash
# Sets up the coder sandbox runner on the Oracle VM. Safe to re-run. Called by deploy/oracle/agent/install-coder-sandbox.sh (as root),
# or by hand with RUNNER_SECRET in the environment (otherwise a random one is made; it is never printed).
#   - builds the box image and the runner, writes /var/lib/coder-sandbox/runner.env (root only, 600);
#   - boxes get their own bridge without container-to-container traffic, no access to private / link-local ranges (the VM's other
#     services, the cloud metadata endpoint) nor to the host, internet egress shaped (default 20 Mbit/s).
set -euo pipefail
cd "$(dirname "$0")"
SUDO=""; [ "$(id -u)" = 0 ] || SUDO=sudo
LIB=/var/lib/coder-sandbox
$SUDO mkdir -p "$LIB/flags"; $SUDO chmod 700 "$LIB"; $SUDO chmod 755 "$LIB/flags"
SECRET="${RUNNER_SECRET:-}"
[ -n "$SECRET" ] || SECRET="$($SUDO sed -n 's/^RUNNER_SECRET=//p' "$LIB/runner.env" 2>/dev/null || true)"
[ -n "$SECRET" ] || SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
printf 'RUNNER_SECRET=%s\nRUNNER_MODE=docker\n' "$SECRET" | $SUDO tee "$LIB/runner.env.new" >/dev/null
$SUDO chmod 600 "$LIB/runner.env.new"; $SUDO mv "$LIB/runner.env.new" "$LIB/runner.env"
docker build -q -t coder-sandbox-box:latest -f Dockerfile.box . >/dev/null
docker network inspect coder-sbx-net >/dev/null 2>&1 || docker network create --driver bridge \
  --opt com.docker.network.bridge.enable_icc=false --opt com.docker.network.bridge.name=br-coder-sbx --label coder-sandbox=1 coder-sbx-net >/dev/null
docker network inspect "${CODER_SBX_SITE_NET:-ttbik_default}" >/dev/null 2>&1 || docker network create "${CODER_SBX_SITE_NET:-ttbik_default}" >/dev/null
CODER_SBX_ENV_FILE="$LIB/runner.env" docker compose -p coder-sandbox up -d --build
SUBNET=$(docker network inspect coder-sbx-net -f '{{(index .IPAM.Config 0).Subnet}}')
if command -v iptables >/dev/null; then
  for NET in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10; do
    $SUDO iptables -C DOCKER-USER -s "$SUBNET" -d "$NET" -j DROP 2>/dev/null || $SUDO iptables -I DOCKER-USER -s "$SUBNET" -d "$NET" -j DROP
  done
  $SUDO iptables -C INPUT -i br-coder-sbx -j DROP 2>/dev/null || $SUDO iptables -I INPUT -i br-coder-sbx -j DROP
fi
if command -v tc >/dev/null; then
  $SUDO tc qdisc replace dev br-coder-sbx root tbf rate "${RUNNER_EGRESS_RATE:-20mbit}" burst 64kb latency 400ms || true
fi
echo "runner up on 127.0.0.1:8790"
