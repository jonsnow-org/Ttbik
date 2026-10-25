"""Uploads the Nova 1 GGUF files to a ModelScope model repo (created if missing, private by default).
Needs MODELSCOPE_API_TOKEN in the environment (the owner's ModelScope access token; never commit it).

    python export/upload_modelscope.py out/gguf --repo novaai2026/nova1-4b-gguf
"""
import argparse
import os
from pathlib import Path

from modelscope.hub.api import HubApi

ap = argparse.ArgumentParser()
ap.add_argument("folder")
ap.add_argument("--repo", default="novaai2026/nova1-4b-gguf")
ap.add_argument("--public", action="store_true")
a = ap.parse_args()
api = HubApi()
api.login(os.environ["MODELSCOPE_API_TOKEN"])
try:
    api.create_model(a.repo, visibility=5 if a.public else 1, license="Apache License 2.0", chinese_name="Nova 1")
except Exception as e:  # already exists
    print("repo:", str(e)[:120])
card = Path(a.folder) / "README.md"
card.write_text("---\nlicense: apache-2.0\nbase_model: Qwen/Qwen3.5-4B\ntags: [code, arabic, gguf]\n---\n# Nova 1 (4B, GGUF)\n\n"
                "LoRA fine-tune of Qwen3.5-4B for coding (instructions, repair, agentic tool use). Data sources and licences: "
                "training/nova1/datasets.yaml in the source repository.\n")
for f in ["README.md"] + sorted(p.name for p in Path(a.folder).glob("nova1-4b-q*.gguf")):
    api.upload_file(path_or_fileobj=str(Path(a.folder) / f), path_in_repo=f, repo_id=a.repo, commit_message=f"add {f}")
    print("uploaded", f)
