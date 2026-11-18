#!/usr/bin/env bash
# Proves a job really runs on the chosen self-hosted runner: machine, cores, memory, disks, and what the restored /mnt/workspace holds. Changes nothing.
echo "runner=${RUNNER_NAME:-?} host=$(hostname) cores=$(nproc) user=$(id -un)"; free -g | head -2; df -h /mnt/workspace 2>/dev/null
ls -la /mnt/workspace 2>/dev/null; cat /mnt/workspace/.restore/status.json 2>/dev/null; echo
python3 --version; git --version
