"""Starts one Nova 1 training stage on Lightning AI with the official SDK (no browser), waits, and reports.
Each call runs one GPU job that resumes from the private HF checkpoint repo, trains for --minutes, pushes the checkpoint and
exits, so it can be called again (by hand, by cron on the Oracle runner, or by a scheduled workflow) until the stage is done.
A credit guard refuses to start when the account's spent amount would pass --budget (the free grant is 5 credits).

    pip install lightning-sdk huggingface_hub
    export LIGHTNING_USER_ID=... LIGHTNING_API_KEY=...   # Lightning: Account settings -> Keys -> Programmatic login
    export HF_TOKEN=...                                  # HF write token (data + checkpoint repos are private)
    python train/launch_lightning.py --teamspace <user>/<teamspace> --hf-user <hf-user> --minutes 150
"""
import argparse
import json
import os
import time
from pathlib import Path

from lightning_sdk import Job, Machine

ap = argparse.ArgumentParser()
ap.add_argument("--teamspace", required=True, help="owner/teamspace as shown in the Lightning URL")
ap.add_argument("--hf-user", required=True)
ap.add_argument("--machine", default="T4", choices=["T4", "L4"])
ap.add_argument("--minutes", type=int, default=150, help="training minutes in this job (job is hard-stopped 20 min later)")
ap.add_argument("--budget", type=float, default=5.0, help="never let total spend recorded in the ledger pass this many credits")
ap.add_argument("--ledger", default=str(Path(__file__).with_name("lightning_ledger.json")))
ap.add_argument("--image", default="pytorch/pytorch:2.8.0-cuda12.8-cudnn9-devel")
a = ap.parse_args()

RATE = {"T4": 0.55, "L4": 0.79}[a.machine]          # $/h from https://lightning.ai/pricing (2026-10-21)
ledger = json.loads(Path(a.ledger).read_text()) if Path(a.ledger).exists() else {"spent": 0.0, "jobs": []}
worst = (a.minutes + 20) / 60 * RATE
if ledger["spent"] + worst > a.budget:
    raise SystemExit(f"stop: spent {ledger['spent']:.2f} + this job up to {worst:.2f} would pass the budget {a.budget}")

cmd = " && ".join([
    "pip install -q unsloth 'transformers>=5.0.0' 'trl>=0.24' 'peft>=0.17' datasets pyyaml huggingface_hub",
    f"python -c \"from huggingface_hub import snapshot_download as s; s('{a.hf_user}/nova1-data', repo_type='dataset', local_dir='/tmp/nova1')\"",
    "cd /tmp/nova1",
    f"python train/train.py --config train/config.colab.yaml --out out/nova1-lora --hub-repo {a.hf_user}/nova1-lora-ckpt "
    f"--max-minutes {a.minutes} --resume",
])
name = f"nova1-{int(time.time())}"
job = Job.run(name=name, machine=getattr(Machine, a.machine), image=a.image, command=cmd, teamspace=a.teamspace,
              env={"HF_TOKEN": os.environ["HF_TOKEN"]}, max_runtime=(a.minutes + 20) * 60, interruptible=False)
print("started", name, job.link)
job.wait()
cost = float(getattr(job, "total_cost", None) or worst)
ledger["spent"] += cost
ledger["jobs"].append({"name": name, "status": str(job.status), "cost": round(cost, 3), "at": time.strftime("%Y-%m-%d %H:%M")})
Path(a.ledger).write_text(json.dumps(ledger, indent=1))
print(f"finished {job.status}; this job {cost:.2f}, total {ledger['spent']:.2f} of {a.budget}")
try:
    print("\n".join(str(job.logs).splitlines()[-15:]))
except Exception:
    pass
