#!/usr/bin/env python3
"""Mirror Sham Pro's PRIVATE model repos from modelscope.cn (novaai2026, where Sham Pro is trained) to modelscope.ai (the international account, where Sham Pro
is served; owner's platform decision 2026-11-25: models run on the international site, the cn site is for training). Sham Pro's own repos only.

  python mirror_sham_v2_to_ai.py novaai2026/sham-v2=Jonjithup/sham-v2 novaai2026/sham2-tldm-head=Jonjithup/sham2-tldm-head

Env: MS_CN_TOKEN, MS_AI_TOKEN (never printed). Only files that are missing on the ai side or differ (sha256 / size) are copied, one big file at a time
(download from cn in a child process, upload to ai in another child process: the SDK picks its site from the environment at import), so the runner disk
holds at most one big file. The ai repo is created private when missing. Nothing is ever deleted on either side; files that exist only on the ai side are
listed. Offline self-test: python mirror_sham_v2_to_ai.py --selftest
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

CN, AI = "https://www.modelscope.cn", "https://www.modelscope.ai"
SMALL = 64 * 2**20                     # files below this go up together in one commit


def listing(base: str, repo: str, token: str) -> dict[str, dict] | None:
    """{path: {"size", "sha"}} of a model repo's files, or None when the repo does not exist / cannot be read."""
    url = f"{base}/api/v1/models/{repo}/repo/files?Recursive=true&Revision=master&PageSize=5000"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token, "Cookie": "m_session_id=" + token})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read().decode("utf-8", "replace") or "{}")
    except urllib.error.HTTPError as e:
        print(f"  list {base.split('//')[1]}/{repo}: HTTP {e.code}", flush=True)
        return None
    files = ((d.get("Data") or {}).get("Files")) if isinstance(d, dict) else None
    if not d.get("Success", True) or files is None:
        print(f"  list {base.split('//')[1]}/{repo}: {str(d.get('Message') or d)[:200]}", flush=True)
        return None
    return {f["Path"]: {"size": int(f.get("Size") or 0), "sha": str(f.get("Sha256") or "")} for f in files if f.get("Type") != "tree"}


def to_copy(src: dict[str, dict], dst: dict[str, dict] | None) -> list[str]:
    """Paths that are missing on the destination or differ from the source (sha256 when both have it, else size)."""
    dst = dst or {}
    out = []
    for p, s in sorted(src.items()):
        d = dst.get(p)
        if d is None:
            out.append(p)
        elif s["sha"] and d["sha"]:
            if s["sha"] != d["sha"]:
                out.append(p)
        elif s["size"] != d["size"]:
            out.append(p)
    return out


def _site_env(base: str, token: str) -> dict:
    env = dict(os.environ)
    env.update(MODELSCOPE_ENDPOINT=base, MODELSCOPE_DOMAIN=base.split("//", 1)[1], MS_TOKEN=token)
    env.pop("MS_CN_TOKEN", None)
    env.pop("MS_AI_TOKEN", None)
    return env


DOWNLOAD = r'''
import os, sys, shutil
from modelscope.hub.api import HubApi
from modelscope.hub.file_download import model_file_download
HubApi().login(os.environ["MS_TOKEN"])
repo, out = sys.argv[1], sys.argv[2]
for p in sys.argv[3:]:
    got = model_file_download(repo, p, cache_dir=out + "/.cache")
    dst = os.path.join(out, "files", p)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(got, dst)
'''

UPLOAD = r'''
import os, sys
from modelscope.hub.api import HubApi
api = HubApi(); api.login(os.environ["MS_TOKEN"])
repo, root, msg = sys.argv[1], sys.argv[2], sys.argv[3]
paths = sys.argv[4:]
if len(paths) == 1:
    api.upload_file(path_or_fileobj=os.path.join(root, paths[0]), path_in_repo=paths[0], repo_id=repo, commit_message=msg)
else:
    api.upload_folder(repo_id=repo, folder_path=root, commit_message=msg)
'''

CREATE = r'''
import os, sys
from modelscope.hub.api import HubApi
api = HubApi(); api.login(os.environ["MS_TOKEN"])
try:
    api.create_model(sys.argv[1], visibility=1, chinese_name=sys.argv[1].split("/")[1])
    print("  created private repo", sys.argv[1])
except Exception as e:
    print("  create_model:", type(e).__name__, str(e)[:160])
'''


def _run(code: str, args: list[str], env: dict) -> None:
    r = subprocess.run([sys.executable, "-c", code, *args], env=env, capture_output=True, text=True)
    if r.returncode != 0:
        tok = [env.get("MS_TOKEN", "")]
        err = (r.stderr or r.stdout or "")[-1500:]
        for t in tok:
            if t:
                err = err.replace(t, "***")
        raise RuntimeError(err)
    if r.stdout.strip():
        print(r.stdout.strip(), flush=True)


def mirror(src_repo: str, dst_repo: str, cn_tok: str, ai_tok: str) -> bool:
    print(f"== {src_repo} (cn) -> {dst_repo} (ai)", flush=True)
    src = listing(CN, src_repo, cn_tok)
    if src is None:
        print("::error::cannot read the source repo", flush=True)
        return False
    dst = listing(AI, dst_repo, ai_tok)
    if dst is None:
        _run(CREATE, [dst_repo], _site_env(AI, ai_tok))
        dst = listing(AI, dst_repo, ai_tok) or {}
    need = to_copy(src, dst)
    total = sum(src[p]["size"] for p in need)
    print(f"  source {len(src)} files ({sum(s['size'] for s in src.values()) >> 20} MiB); to copy {len(need)} ({total >> 20} MiB)", flush=True)
    extra = sorted(set(dst) - set(src))
    if extra:
        print(f"  only on the ai side (kept, not deleted): {extra[:20]}", flush=True)
    small = [p for p in need if src[p]["size"] < SMALL]
    big = [p for p in need if src[p]["size"] >= SMALL]
    batches = ([small] if small else []) + [[p] for p in big]
    for batch in batches:
        work = Path(tempfile.mkdtemp(prefix="msmirror_"))
        try:
            _run(DOWNLOAD, [src_repo, str(work), *batch], _site_env(CN, cn_tok))
            root = work / "files"
            label = batch[0] if len(batch) == 1 else f"{len(batch)} small files"
            _run(UPLOAD, [dst_repo, str(root), f"mirror from cn: {label}"[:200], *batch], _site_env(AI, ai_tok))
            print(f"  copied {label} ({sum(src[p]['size'] for p in batch) >> 20} MiB)", flush=True)
        finally:
            shutil.rmtree(work, ignore_errors=True)
    after = listing(AI, dst_repo, ai_tok) or {}
    left = to_copy(src, after)
    print(f"  verify: {len(src) - len(left)}/{len(src)} files identical on the ai side" + (f"; still different: {left[:10]}" if left else ""), flush=True)
    return not left


def _selftest() -> None:
    a = {"x": {"size": 1, "sha": "aa"}, "y": {"size": 2, "sha": ""}, "z": {"size": 3, "sha": "cc"}}
    b = {"x": {"size": 1, "sha": "aa"}, "y": {"size": 5, "sha": ""}, "z": {"size": 3, "sha": "dd"}, "w": {"size": 1, "sha": ""}}
    assert to_copy(a, b) == ["y", "z"], to_copy(a, b)
    assert to_copy(a, None) == ["x", "y", "z"]
    e = _site_env(AI, "t")
    assert e["MODELSCOPE_DOMAIN"] == "www.modelscope.ai" and e["MS_TOKEN"] == "t" and "MS_CN_TOKEN" not in e
    print("mirror self-test OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
        sys.exit(0)
    cn_tok, ai_tok = os.environ.get("MS_CN_TOKEN", ""), os.environ.get("MS_AI_TOKEN", "")
    if not cn_tok or not ai_tok:
        sys.exit("MS_CN_TOKEN and MS_AI_TOKEN are required")
    ok = True
    for pair in sys.argv[1:]:
        s, d = pair.split("=", 1)
        if not (s.startswith("novaai2026/sham") and d.startswith("Jonjithup/sham")):
            sys.exit(f"refusing {pair}: only Sham's own repos, cn novaai2026 -> ai Jonjithup")
        ok = mirror(s, d, cn_tok, ai_tok) and ok
    sys.exit(0 if ok else 1)
