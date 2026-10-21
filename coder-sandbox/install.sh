#!/usr/bin/env bash
# One-time setup on the Oracle VM (run as a user that can use docker; the firewall part needs sudo).
# Builds the box image and the runner, creates .env with a random secret if missing, and limits what boxes can reach:
#   - no access to private / link-local ranges (the VM's other services, the cloud metadata endpoint), internet egress allowed;
#   - egress rate-limited on the sandbox bridge (default 20 Mbit/s) when `tc` is available.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { printf 'RUNNER_SECRET=%s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > .env; chmod 600 .env; echo "created .env (secret not printed)"; }
docker build -t coder-sandbox-box:latest -f Dockerfile.box .
docker network inspect coder-sbx-net >/dev/null 2>&1 || docker network create --driver bridge \
  --opt com.docker.network.bridge.enable_icc=false --opt com.docker.network.bridge.name=br-coder-sbx --label coder-sandbox=1 coder-sbx-net
docker compose -p coder-sandbox up -d --build
SUBNET=$(docker network inspect coder-sbx-net -f '{{(index .IPAM.Config 0).Subnet}}')
if command -v iptables >/dev/null; then
  for NET in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10; do
    sudo iptables -C DOCKER-USER -s "$SUBNET" -d "$NET" -j DROP 2>/dev/null || sudo iptables -I DOCKER-USER -s "$SUBNET" -d "$NET" -j DROP
  done
  # replies to established connections still pass; DNS to the docker resolver is inside the container
  sudo iptables -C INPUT -i br-coder-sbx -j DROP 2>/dev/null || sudo iptables -I INPUT -i br-coder-sbx -j DROP
fi
if command -v tc >/dev/null; then
  sudo tc qdisc replace dev br-coder-sbx root tbf rate "${RUNNER_EGRESS_RATE:-20mbit}" burst 64kb latency 400ms || true
fi
echo "runner: http://127.0.0.1:8790 (health: curl -H \"x-runner-key: \$RUNNER_SECRET\" http://127.0.0.1:8790/health)"
