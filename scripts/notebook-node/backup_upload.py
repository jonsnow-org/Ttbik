#!/usr/bin/env python3
"""Upload/verify helper for backup_workspace.sh (the notebook -> Studios move, 2026-11-18). Talks to the international ModelScope hub (MODELSCOPE_DOMAIN=www.modelscope.ai) with MS_AI_TOKEN.

  upload <repo> <parts_dir> <key> <source_path>   create the PRIVATE model repo if missing, upload <key>.tar.part-*, check every part's size + sha256 against what the hub
                                                   reports, then add the item to manifest.json (parts, sizes, sha256 of each part and of the whole tar).
  verify <repo>                                    re-read the hub's file list and check every manifest entry. Exit 1 on any mismatch.
  --selftest                                       offline checks.
Never prints the token."""
from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("MODELSCOPE_DOMAIN", "www.modelscope.ai")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def _get(d: dict, *names):
    low = {str(k).lower(): v for k, v in d.items()}
    for n in names:
        if n.lower() in low:
            return low[n.lower()]
    return None


def remote_files(api, repo: str) -> dict:
    out = {}
    for f in api.get_model_files(repo, recursive=True) or []:
        p = _get(f, "Path", "path", "Name")
        if p:
            out[str(p)] = {"size": int(_get(f, "Size", "size") or 0), "sha256": str(_get(f, "Sha256", "sha256") or "")}
    return out


def api_login():
    from modelscope.hub.api import HubApi
    api = HubApi()
    api.login(os.environ["MS_AI_TOKEN"])
    return api


def read_manifest(api, repo: str) -> dict:
    try:
        from modelscope.hub.file_download import model_file_download
        p = model_file_download(repo, "manifest.json", local_dir=tempfile.mkdtemp(), token=os.environ["MS_AI_TOKEN"])
        return json.loads(Path(p).read_text())
    except Exception:  # noqa: BLE001 - a new repo has no manifest yet
        return {"items": {}}


def check(entry_parts: list, remote: dict) -> list:
    bad = []
    for part in entry_parts:
        r = remote.get(part["path"])
        if not r:
            bad.append(f"{part['path']}: missing on the hub")
        elif r["size"] != part["size"]:
            bad.append(f"{part['path']}: size {r['size']} != {part['size']}")
        elif r["sha256"] and r["sha256"] != part["sha256"]:
            bad.append(f"{part['path']}: sha256 differs")
    return bad


def upload(repo: str, parts_dir: str, key: str, source: str) -> int:
    api = api_login()
    api.create_repo(repo, visibility="private", repo_type="model", exist_ok=True)
    d = Path(parts_dir)
    files = sorted(d.glob(f"{key}.tar.part-*"))
    if not files:
        print(f"::error::no parts for {key}")
        return 1
    whole = (d / f"{key}.sha").read_text().strip() if (d / f"{key}.sha").exists() else ""
    parts = []
    for f in files:
        rec = {"path": f"parts/{f.name}", "size": f.stat().st_size, "sha256": sha256(f)}
        for attempt in range(4):
            try:
                t0 = time.time()
                api.upload_file(repo_id=repo, path_or_fileobj=str(f), path_in_repo=rec["path"], commit_message=f"backup {f.name}")
                print(f"uploaded {rec['path']} {rec['size'] // (1 << 20)} MB in {time.time() - t0:.0f}s")
                break
            except Exception as exc:  # noqa: BLE001
                print(f"upload {f.name} attempt {attempt + 1} failed: {type(exc).__name__}: {str(exc)[:200]}")
                time.sleep(20 * (attempt + 1))
        else:
            return 1
        parts.append(rec)
    bad = check(parts, remote_files(api, repo))
    if bad:
        print("::error::verify failed: " + "; ".join(bad))
        return 1
    man = read_manifest(api, repo)
    man.setdefault("items", {})[key] = {"source": source, "parts": parts, "tar_sha256": whole, "bytes": sum(p["size"] for p in parts),
                                        "uploaded": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    mp = d / "manifest.json"
    mp.write_text(json.dumps(man, indent=1))
    api.upload_file(repo_id=repo, path_or_fileobj=str(mp), path_in_repo="manifest.json", commit_message=f"manifest: {key}")
    print(f"OK {key}: {len(parts)} parts, {man['items'][key]['bytes'] // (1 << 20)} MB, verified against the hub")
    return 0


def verify(repo: str) -> int:
    api = api_login()
    man, remote = read_manifest(api, repo), remote_files(api, repo)
    fail = 0
    for key, e in sorted(man.get("items", {}).items()):
        bad = check(e["parts"], remote)
        print(f"{'OK ' if not bad else 'BAD'} {key}: {e['bytes'] // (1 << 20)} MB in {len(e['parts'])} parts from {e['source']}" + ("" if not bad else " -> " + "; ".join(bad)))
        fail |= bool(bad)
    print(f"manifest items: {len(man.get('items', {}))}")
    return int(fail)


def selftest() -> int:
    with tempfile.TemporaryDirectory() as t:
        p = Path(t) / "a"
        p.write_bytes(b"abc")
        assert sha256(p) == hashlib.sha256(b"abc").hexdigest()
    parts = [{"path": "parts/x", "size": 3, "sha256": "aa"}]
    assert check(parts, {"parts/x": {"size": 3, "sha256": "aa"}}) == []
    assert check(parts, {"parts/x": {"size": 3, "sha256": ""}}) == []
    assert check(parts, {"parts/x": {"size": 4, "sha256": "aa"}})
    assert check(parts, {})
    assert _get({"Sha256": "z"}, "sha256") == "z"
    print("backup_upload self-test OK")
    return 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "--selftest":
        sys.exit(selftest())
    if a[0] == "upload":
        sys.exit(upload(*a[1:5]))
    if a[0] == "verify":
        sys.exit(verify(a[1]))
    sys.exit(f"unknown command {a[0]}")
