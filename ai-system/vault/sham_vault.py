"""
Sham's checkpoint vault — an off-Kaggle copy of the project's checkpoints, kept on the Oracle server.

Why: the checkpoints are "half the project" (owner, 2026-10-10) and today they live in ONE place, the owner's Kaggle account. A deleted dataset,
a bad publish that replaces a good version, or a locked account would lose weeks of training. This job keeps the last VERSIONS_KEPT versions of
every main-line dataset as plain zip files on the server's disk, and only downloads a dataset when Kaggle's version number changed.

Runs from ai-system/oracle_job.sh (the isolated `sham` user: 1 CPU, 4 GB RAM, lowest priority, work folder <= 40 GB). Pure standard library —
no pip install needed on the server. Credentials come from the environment (/etc/sham/sham.env, placed by the owner): KAGGLE_USERNAME with
KAGGLE_KEY, or KAGGLE_API_TOKEN. A secret is never printed, and the Authorization header is never sent to the download host Kaggle redirects to.

    python sham_vault.py --run [WORK_DIR]     the real job
    python sham_vault.py                      offline self-test
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

DATASETS = [      # main line first: when the cap bites, these are kept and the rest are skipped
    "sham-merged-checkpoint", "sham-chat-checkpoint", "sham-multimodal-checkpoint", "sham-crawl-checkpoint", "sham-checkpoint",
    "sham-image-tokenizer-checkpoint", "sham-audio-tokenizer-checkpoint", "sham-research-track-checkpoint-v2", "sham-cpu-track-checkpoint-v2",
]
VERSIONS_KEPT = 2
VAULT_CAP_BYTES = 15 * 1024 ** 3
MAX_DATASET_BYTES = 3 * 1024 ** 3
API = "https://www.kaggle.com/api/v1/datasets"


def _auth(env) -> dict:
    if env.get("KAGGLE_API_TOKEN"):
        return {"Authorization": "Bearer " + env["KAGGLE_API_TOKEN"]}
    if env.get("KAGGLE_USERNAME") and env.get("KAGGLE_KEY"):
        return {"Authorization": "Basic " + base64.b64encode(f"{env['KAGGLE_USERNAME']}:{env['KAGGLE_KEY']}".encode()).decode()}
    return {}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def kaggle_view(owner: str, slug: str, env=os.environ, opener=None) -> dict | None:
    req = urllib.request.Request(f"{API}/view/{owner}/{slug}", headers=_auth(env))
    try:
        with (opener or urllib.request.build_opener()).open(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def kaggle_download(owner: str, slug: str, dest: Path, env=os.environ) -> bool:
    """Streams the dataset zip to dest. The first request (with credentials) answers with a redirect; the redirect target gets NO credentials."""
    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(f"{API}/download/{owner}/{slug}", headers=_auth(env))
    try:
        try:
            opener.open(req, timeout=60)
            return False
        except urllib.error.HTTPError as e:
            if e.code not in (301, 302, 303, 307, 308) or not e.headers.get("Location"):
                return False
            url = e.headers["Location"]
        with urllib.request.urlopen(urllib.request.Request(url), timeout=120) as r, open(dest, "wb") as f:
            shutil.copyfileobj(r, f, 1 << 22)
        return True
    except Exception:
        return False


def zip_ok(path: Path) -> bool:
    try:
        with zipfile.ZipFile(path) as z:
            return z.testzip() is None and len(z.namelist()) > 0
    except Exception:
        return False


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def vault_size(vault: Path) -> int:
    return sum(p.stat().st_size for p in vault.rglob("*.zip"))


def prune(vault: Path, index: dict) -> list[str]:
    """Keep the newest VERSIONS_KEPT versions of each dataset; then, while over the cap, drop the oldest copy of the datasets that have
    more than one (the newest copy of any dataset is never dropped)."""
    removed = []
    for name, rec in index.items():
        vers = sorted(rec.get("versions", []), key=lambda v: v["version"], reverse=True)
        for old in vers[VERSIONS_KEPT:]:
            (vault / name / old["file"]).unlink(missing_ok=True)
            removed.append(f"{name}/{old['file']}")
        rec["versions"] = vers[:VERSIONS_KEPT]
    while vault_size(vault) > VAULT_CAP_BYTES:
        cands = [(v["version"], n, v) for n, r in index.items() for v in r["versions"][1:]]
        if not cands:
            break
        _, n, v = min(cands, key=lambda c: c[0])
        (vault / n / v["file"]).unlink(missing_ok=True)
        index[n]["versions"].remove(v)
        removed.append(f"{n}/{v['file']}")
    return removed


def run(work: Path, env=os.environ, view=kaggle_view, download=kaggle_download, datasets=None, free_bytes=None) -> dict:
    vault = Path(work) / "vault"
    vault.mkdir(parents=True, exist_ok=True)
    idx_path = vault / "index.json"
    try:
        index = json.loads(idx_path.read_text(encoding="utf-8"))
    except Exception:
        index = {}
    owner = env.get("KAGGLE_USERNAME", "")
    out = {"new": [], "same": [], "skipped": [], "failed": []}
    if not owner or not _auth(env):
        out["error"] = "لا مفاتيح Kaggle في /etc/sham/sham.env — لا نسخ احتياطي (تضعها المالكة، وأنا لا أراها)"
        return out
    for slug in datasets or DATASETS:
        meta = view(owner, slug)
        if not meta or meta.get("currentVersionNumber") is None:
            out["failed"].append(f"{slug}: لا جواب من Kaggle")
            continue
        ver, size = int(meta["currentVersionNumber"]), int(meta.get("totalBytes") or 0)
        rec = index.setdefault(slug, {"versions": []})
        if any(v["version"] == ver for v in rec["versions"]):
            out["same"].append(f"{slug} v{ver}")
            continue
        free = (free_bytes or (lambda p: shutil.disk_usage(p).free))(vault)
        if size > MAX_DATASET_BYTES or size * 2 > free or vault_size(vault) > VAULT_CAP_BYTES:
            out["skipped"].append(f"{slug} v{ver}: الحجم {size / 1e9:.1f} جيجا لا يناسب الحدود")
            continue
        (vault / slug).mkdir(exist_ok=True)
        name = f"v{ver:04d}-{time.strftime('%Y%m%d-%H%M', time.gmtime())}.zip"
        part = vault / slug / (name + ".part")
        if download(owner, slug, part, env) and zip_ok(part):
            part.rename(vault / slug / name)
            rec["versions"].append({"version": ver, "file": name, "bytes": (vault / slug / name).stat().st_size,
                                    "sha256": sha256(vault / slug / name), "saved": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())})
            out["new"].append(f"{slug} v{ver}")
        else:
            part.unlink(missing_ok=True)
            out["failed"].append(f"{slug} v{ver}: فشل التنزيل أو الملف تالف")
    out["pruned"] = prune(vault, index)
    idx_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    out["total_gb"] = round(vault_size(vault) / 1e9, 2)
    return out


def report(res: dict) -> str:
    if res.get("error"):
        return "🗄 خزنة نقاط الحفظ (Oracle): " + res["error"]
    return ("🗄 خزنة نقاط الحفظ (Oracle): جديد " + (", ".join(res["new"]) or "—") + f" | بلا تغيير {len(res['same'])}"
            + (f" | تُخطّي {len(res['skipped'])}" if res["skipped"] else "") + (f" | ⚠ فشل: {'; '.join(res['failed'])}" if res["failed"] else "")
            + f" | الحجم الكلي {res['total_gb']} جيجا")


if __name__ == "__main__":
    if "--run" in sys.argv:
        args = [a for a in sys.argv[1:] if a != "--run"]
        res = run(Path(args[0]) if args else Path(os.environ.get("SHAM_WORK", ".")))
        text = report(res)
        print(text)
        try:        # the report mirror (best effort: needs the Kaggle package, which the server may not have — then the line above is the record)
            sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "colab" / "sham_small"))
            from sham_reports import log_report
            log_report(text, source="vault")
        except Exception:
            pass
    else:
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            made = {}

            def fake_view(owner, slug):
                if slug == "gone":
                    return None
                return {"currentVersionNumber": made.get(slug, 1), "totalBytes": 1000}

            def fake_download(owner, slug, dest, env):
                with zipfile.ZipFile(dest, "w") as z:
                    z.writestr("final.pt", f"{slug}-{made.get(slug, 1)}" * 100)
                return True

            env = {"KAGGLE_USERNAME": "me", "KAGGLE_KEY": "secret-key"}
            r1 = run(d, env, fake_view, fake_download, ["a", "b", "gone"], free_bytes=lambda p: 10 ** 9)
            assert r1["new"] == ["a v1", "b v1"] and len(r1["failed"]) == 1, r1
            r2 = run(d, env, fake_view, fake_download, ["a", "b"], free_bytes=lambda p: 10 ** 9)
            assert r2["new"] == [] and r2["same"] == ["a v1", "b v1"], r2        # unchanged versions are never downloaded again
            for v in (2, 3):
                made["a"] = v
                run(d, env, fake_view, fake_download, ["a"], free_bytes=lambda p: 10 ** 9)
            idx = json.loads((d / "vault" / "index.json").read_text())
            assert [x["version"] for x in idx["a"]["versions"]] == [3, 2], idx["a"]       # the newest two kept, the oldest pruned
            assert len(list((d / "vault" / "a").glob("*.zip"))) == 2
            r3 = run(d, {}, fake_view, fake_download, ["a"])
            assert "error" in r3 and "Kaggle" in report(r3)                                 # no credentials: says so, no crash
            r4 = run(d, env, fake_view, fake_download, ["c"], free_bytes=lambda p: 10)
            made["c"] = 1
            assert r4["skipped"] and not r4["new"], r4                                      # not enough free disk: skipped, not attempted
            (d / "vault" / "a" / "v0099-x.zip").write_bytes(b"not a zip")                    # a corrupt download never becomes a version
            def bad_download(owner, slug, dest, env):
                dest.write_bytes(b"garbage"); return True
            made["z"] = 1
            r5 = run(d, env, fake_view, bad_download, ["z"], free_bytes=lambda p: 10 ** 9)
            assert r5["failed"]
            assert not list((d / "vault" / "z").glob("*")), "a corrupt part file must be deleted"
            h = _auth(env)["Authorization"]
            assert h.startswith("Basic ") and "secret-key" not in report(r1)               # the key never appears in the report
        print("sham_vault self-test OK")
