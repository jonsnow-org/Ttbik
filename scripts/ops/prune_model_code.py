#!/usr/bin/env python3
"""Remove from the model repos' studio_code/ every file the signed local code no longer has (the Studios refuse signed code when an extra file is present).

Same logic as sync_to_modelscope.prune_remote_code, run on its own with the full error printed. MODELS = comma-separated repo ids (default both Sham repos).
Offline self-test: python prune_model_code.py --selftest
"""
from __future__ import annotations

import os
import sys
import tempfile
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ai-system" / "modelscope-sham"))
sys.path.insert(0, str(ROOT / "ai-system" / "colab" / "sham_small"))
import sync_to_modelscope as sync  # noqa: E402


def prune(model_id: str, local_code: Path, token: str) -> None:
    from modelscope.hub.api import HubApi
    api = HubApi()
    api.login(token)
    files = api.get_model_files(model_id, recursive=True)
    remote = [f.get("Path") for f in files if f.get("Type") != "tree" and f.get("Path")]
    stale = sync.stale_remote_code(remote, local_code)
    print(f"{model_id}: {len(remote)} files, {len(stale)} stale under studio_code/")
    for s in stale:
        print("  stale:", s)
    if not stale:
        return
    try:
        from modelscope_hub.api import HubApi as New
        res = New(token=token).delete_files(model_id, "model", file_paths=stale, commit_message="remove studio_code files that the signed code no longer has")
        print("  delete_files ->", {k: (len(v) if isinstance(v, list) else v) for k, v in res.items()})
    except Exception:
        print("  new client failed:")
        traceback.print_exc()
        for s in stale:                               # fallback: the legacy per-file endpoint
            try:
                api.delete_model_file(model_id, s) if hasattr(api, "delete_model_file") else print("  no legacy delete on this client")
                print("  legacy delete:", s)
            except Exception as exc:
                print(f"  legacy delete failed {s}: {type(exc).__name__} {str(exc)[:160]}")


def main() -> int:
    token = os.environ.get("MODELSCOPE_TOKEN", "").strip()
    if not token:
        print("MODELSCOPE_TOKEN missing")
        return 1
    with tempfile.TemporaryDirectory() as d:
        out = Path(d)
        os.environ.setdefault("SHAM_CODE_SIGNING_KEY", token)          # only to stage the folder; nothing is signed for upload here
        sync.stage_code(out / "studio_code")
        for m in [x.strip() for x in os.environ.get("MODELS", "novaai2026/sham-merged,novaai2026/sham-v2").split(",") if x.strip()]:
            try:
                prune(m, out / "studio_code", token)
            except Exception:
                print(f"{m}: failed")
                traceback.print_exc()
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        assert sync.stale_remote_code(["studio_code/a.py", "studio_code/old.py", "x.pt"], Path(__file__)) is not None
        print("prune_model_code self-test OK")
        sys.exit(0)
    sys.exit(main())
