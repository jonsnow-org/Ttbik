#!/usr/bin/env bash
# Turns the ModelScope Notebook into a GitHub Actions self-hosted runner for THIS repository, so workflows (and Claude, through them) can run jobs on its 8 CPU cores / A10 GPU
# with the repository's own secrets and nothing typed in the notebook.
# One time per notebook disk (/mnt/workspace persists between sessions and between the CPU and GPU environments, read 2026-11-17):
#   1. GitHub: repo Settings -> Actions -> Runners -> New self-hosted runner -> Linux x64: tap Copy on the line "./config.sh --url ... --token XXXX" and keep ONLY the token (valid 1 hour, one use).
#   2. Notebook terminal:  curl -sL https://raw.githubusercontent.com/jonsnow-org/Ttbik/claude/free-services-marketplace-h6rwk2/scripts/notebook-node/runner.sh | bash -s -- TOKEN
# Every later session (each lasts <= 4 h and the process dies with it):  bash /mnt/workspace/runner/start.sh
# SAFETY: this repository is PUBLIC. Set Settings -> Actions -> General -> "Require approval for all outside collaborators" BEFORE step 2, so that a pull request from a fork can never run on this machine.
set -eu
T=${1:?usage: runner.sh <registration token>}
D=/mnt/workspace/runner; mkdir -p "$D"; cd "$D"
if [ ! -x ./run.sh ]; then
  V=$(curl -sL https://api.github.com/repos/actions/runner/releases/latest | grep -o '"tag_name": *"v[0-9.]*"' | grep -o '[0-9][0-9.]*' | head -1)
  echo "runner v$V"
  curl -sL -o r.tgz "https://github.com/actions/runner/releases/download/v$V/actions-runner-linux-x64-$V.tar.gz" && tar xzf r.tgz && rm -f r.tgz
  ./bin/installdependencies.sh >/dev/null 2>&1 || true
fi
export RUNNER_ALLOW_RUNASROOT=1
./config.sh --url https://github.com/jonsnow-org/Ttbik --token "$T" --name "notebook-$(date +%m%d)" --labels notebook --unattended --replace
printf '#!/usr/bin/env bash\ncd %s && export RUNNER_ALLOW_RUNASROOT=1 && nohup ./run.sh > run.log 2>&1 &\n' "$D" > start.sh
chmod +x start.sh && ./start.sh
sleep 8; tail -n 5 run.log
