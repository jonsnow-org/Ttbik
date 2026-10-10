"""
The checkpoint vault, run by GitHub (no server login needed): an off-Kaggle copy of the main-line datasets in PRIVATE ModelScope model repos,
one repo per dataset (`<owner>/sham-vault-<dataset>`). Git keeps the older revisions of every repo, so a bad publish never replaces the only copy.

For each dataset: download it from Kaggle (the CLI, with the secrets GitHub already holds), fingerprint its files, and push a new revision only
when the fingerprint differs from the one recorded in the repo's `vault_manifest.json`. Datasets over MAX_BYTES are skipped (reported, not failed).
Tokens come from the environment and are never printed.

    python vault_to_modelscope.py --run     the real job (GitHub runner)
    python vault_to_modelscope.py           offline self-test
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DATASETS = [
    "sham-merged-checkpoint", "sham-chat-checkpoint", "sham-multimodal-checkpoint", "sham-crawl-checkpoint", "sham-checkpoint",
    "sham-image-tokenizer-checkpoint", "sham-audio-tokenizer-checkpoint", "sham-research-track-checkpoint-v2", "sham-cpu-track-checkpoint-v2",
]
MAX_BYTES = 4 * 1024 ** 3
OWNER = os.environ.get("SHAM_MS_OWNER", "novaai2026")


def fingerprint(root: Path) -> tuple[str, list[str]]:
    h, names = hashlib.sha256(), []
    for f in sorted(p for p in Path(root).rglob("*") if p.is_file() and p.name not in ("vault_manifest.json", "configuration.json")):
        rel = f.relative_to(root).as_posix()
        h.update(rel.encode())
        fh = hashlib.sha256()
        with open(f, "rb") as fp:
            for chunk in iter(lambda: fp.read(1 << 22), b""):
                fh.update(chunk)
        h.update(fh.digest())
        names.append(rel)
    return h.hexdigest(), names


def kaggle_download(user: str, slug: str, dest: Path) -> bool:
    dest.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["kaggle", "datasets", "download", "-d", f"{user}/{slug}", "-p", str(dest), "--unzip", "-q"],
                       capture_output=True, text=True)
    return r.returncode == 0 and any(dest.rglob("*"))


def remote_manifest(repo: str) -> dict:
    try:
        from modelscope.hub.file_download import model_file_download
        p = model_file_download(repo, "vault_manifest.json", cache_dir=tempfile.mkdtemp())
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        return {}


def push(repo: str, model_dir: Path, message: str) -> None:
    from modelscope.hub.api import HubApi
    from modelscope.hub.constants import Visibility
    api = HubApi()
    api.login(os.environ["MODELSCOPE_TOKEN"])
    api.push_model(model_id=repo, model_dir=str(model_dir), visibility=Visibility.PRIVATE, license="apache-2.0", chinese_name=repo.split("/")[-1],
                   commit_message=message)


def backup_one(user: str, slug: str, work: Path, download=kaggle_download, get_remote=remote_manifest, do_push=push) -> str:
    d = work / slug
    shutil.rmtree(d, ignore_errors=True)
    try:
        if not download(user, slug, d):
            return f"⚠ {slug}: تعذّر التنزيل من Kaggle"
        size = sum(p.stat().st_size for p in d.rglob("*") if p.is_file())
        if size > MAX_BYTES:
            return f"⏭ {slug}: {size / 1e9:.1f} جيجا أكبر من الحد"
        sha, names = fingerprint(d)
        repo = f"{OWNER}/sham-vault-{slug}"
        if get_remote(repo).get("sha") == sha:
            return f"= {slug}: بلا تغيير"
        (d / "configuration.json").write_text(json.dumps({"framework": "pytorch", "task": "backup"}), encoding="utf-8")
        (d / "vault_manifest.json").write_text(json.dumps({"sha": sha, "files": names, "saved": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())},
                                                           ensure_ascii=False), encoding="utf-8")
        do_push(repo, d, f"{slug} {sha[:12]}")
        return f"✅ {slug}: نسخة جديدة ({size / 1e6:.0f} ميجا، {len(names)} ملف)"
    except Exception as exc:
        return f"⚠ {slug}: {type(exc).__name__}: {str(exc)[:120]}"
    finally:
        shutil.rmtree(d, ignore_errors=True)       # the runner's disk is small: one dataset at a time


def run(user: str, work: Path, datasets=None, **kw) -> list[str]:
    return [backup_one(user, s, work, **kw) for s in (datasets or DATASETS)]


if __name__ == "__main__":
    if "--run" in sys.argv:
        user = os.environ.get("KAGGLE_USERNAME", "")
        if not user or not os.environ.get("MODELSCOPE_TOKEN"):
            print("لا مفاتيح (KAGGLE_USERNAME / MODELSCOPE_TOKEN) — لا نسخ احتياطي")
        else:
            lines = run(user, Path(tempfile.mkdtemp()))
            print("🗄 خزنة نقاط الحفظ (ModelScope):\n" + "\n".join(lines))
    else:
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            pushed, remote = [], {}

            def dl(user, slug, dest):
                if slug == "bad":
                    return False
                dest.mkdir(parents=True, exist_ok=True)
                (dest / "final.pt").write_bytes(slug.encode() * 50)
                (dest / "sub").mkdir()
                (dest / "sub" / "t.json").write_text("{}")
                return True

            gr = lambda repo: remote.get(repo, {})

            def pu(repo, d, msg):
                pushed.append(repo)
                remote[repo] = json.loads((d / "vault_manifest.json").read_text())
                assert (d / "configuration.json").exists() and (d / "final.pt").exists()

            r1 = run("me", t, ["a", "bad"], download=dl, get_remote=gr, do_push=pu)
            assert r1[0].startswith("✅") and r1[1].startswith("⚠") and pushed == [f"{OWNER}/sham-vault-a"], (r1, pushed)
            r2 = run("me", t, ["a"], download=dl, get_remote=gr, do_push=pu)
            assert r2[0].startswith("=") and len(pushed) == 1, r2                    # unchanged content is never pushed twice
            def dl2(user, slug, dest):
                dl(user, slug, dest); (dest / "final.pt").write_bytes(b"new weights"); return True
            r3 = run("me", t, ["a"], download=dl2, get_remote=gr, do_push=pu)
            assert r3[0].startswith("✅") and len(pushed) == 2, r3                    # changed content becomes a new revision
            def boom(repo, d, msg): raise RuntimeError("upload failed " + "x" * 300)
            def dl3(user, slug, dest):
                dl(user, slug, dest); (dest / "final.pt").write_bytes(b"third"); return True
            r4 = run("me", t, ["a"], download=dl3, get_remote=gr, do_push=boom)
            assert r4[0].startswith("⚠") and len(r4[0]) < 200 and not (t / "a").exists(), r4   # a failed push is reported, the work folder cleaned
        print("vault_to_modelscope self-test OK")
