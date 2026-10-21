"""Gives a GGUF that is already being served the SHAM AI identity in its own file (metadata and chat template; see
sham_identity.py), without touching its weights.

    # the coder Studio's current model (fetched from ModelScope, like ai-system/modelscope-coder/app.py does), checked locally only:
    python export/rebrand_gguf.py
    # any local GGUF:
    python export/rebrand_gguf.py --src path/to/model.gguf --out out/served/sham-ai-coder-q4_k_m.gguf
    # and, only when the owner asks for it, upload the result to his ModelScope model repo (needs MODELSCOPE_API_TOKEN):
    python export/rebrand_gguf.py --upload --repo novaai2026/sham-ai-coder-gguf

The Studio keeps serving its current file until the owner points it at the new one (Studio settings CODER_MODEL_REPO and
CODER_MODEL_FILE, read by app.py) and deploys the Studio again by hand.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sham_identity import rebrand_gguf  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--src", default="", help="a local GGUF; when empty, --src-repo/--src-file are downloaded from ModelScope")
ap.add_argument("--src-repo", default="unsloth/Qwen3.5-4B-GGUF")
ap.add_argument("--src-file", default="Qwen3.5-4B-Q4_K_M.gguf")
ap.add_argument("--out", default="out/served/sham-ai-coder-q4_k_m.gguf")
ap.add_argument("--name", default="SHAM AI", help="general.name (the served model has not been trained as Nova 1 yet)")
ap.add_argument("--upload", action="store_true")
ap.add_argument("--repo", default="novaai2026/sham-ai-coder-gguf")
ap.add_argument("--public", action="store_true")
a = ap.parse_args()

src = a.src
if not src:
    from modelscope import snapshot_download
    d = snapshot_download(a.src_repo, allow_patterns=[a.src_file], cache_dir="out/_src")
    src = str(Path(d) / a.src_file)
out = Path(a.out)
out.parent.mkdir(parents=True, exist_ok=True)
meta = {"general.name": a.name, "general.basename": "sham-ai-coder", "general.finetune": "coder", "general.version": "0",
        "general.description": "SHAM AI coding model, developed by the Sham team."}
print(json.dumps(rebrand_gguf(src, out, meta), indent=1))

import gguf  # noqa: E402  (read back what was written)
r = gguf.GGUFReader(str(out), "r")
print({k: r.fields[k].contents() for k in ("general.architecture", "general.name", "general.organization") if k in r.fields},
      "tensors:", len(r.tensors), "size:", out.stat().st_size)

if a.upload:
    from modelscope.hub.api import HubApi
    api = HubApi()
    api.login(os.environ["MODELSCOPE_API_TOKEN"])
    try:
        api.create_model(a.repo, visibility=5 if a.public else 1, license="Apache License 2.0", chinese_name="SHAM AI")
    except Exception as e:  # already exists
        print("repo:", str(e)[:120])
    api.upload_file(path_or_fileobj=str(out), path_in_repo=out.name, repo_id=a.repo, commit_message=f"add {out.name}")
    print("uploaded", f"{a.repo}/{out.name}")
