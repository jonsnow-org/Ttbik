"""
GitHub-side bridge between Kaggle (where Sham's checkpoints live) and the ModelScope Studio (which cannot reach github.com).

    python sync_to_modelscope.py <checkpoint_dir> <studio_work_dir>

1. checkpoint_dir  = Kaggle `sham-merged-checkpoint` downloaded + unzipped. Its files are pushed to the ModelScope MODEL repo
                     SHAM_MS_MODEL (private) — only when the checkpoint's sha256 differs from the one recorded in the repo's
                     bridge_manifest.json, so an unchanged checkpoint is never re-uploaded.
2. studio_work_dir = a clone of the Studio's git repo. The Sham app (app.py, requirements.txt, sham_small/*.py + tokenizer json) is copied
                     in; the previous app of this Studio is moved (not deleted) to legacy-nova/. The caller commits and pushes.

Secrets come from the environment (MODELSCOPE_TOKEN) and are never printed.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import codesign
SRC = HERE.parent / "colab" / "sham_small"
MODEL_ID = os.environ.get("SHAM_MS_MODEL", "novaai2026/sham-merged")
CODE_FILES_EXCLUDE = {"sham_small_api_keys.db"}
FILES = ("final_merged.pt", "sham_small_tokenizer.json", "image_tokenizer.pt", "audio_tokenizer.pt", "merge_progress.json")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


def stage_code(dest: Path) -> str:
    """studio_code/: the worker + the Sham modules it imports, signed. Returns the signature."""
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(HERE / "ms_worker.py", dest / "ms_worker.py")
    inner = dest / "sham_small"
    inner.mkdir(exist_ok=True)
    for p in SRC.glob("*.py"):
        if p.name not in CODE_FILES_EXCLUDE:
            shutil.copy2(p, inner / p.name)
    shutil.copy2(SRC / "sham_general_tokenizer.json", inner / "sham_general_tokenizer.json")
    sig = codesign.sign(dest)
    (dest / codesign.SIG_NAME).write_text(sig, encoding="utf-8")
    return sig


def stage_model_dir(ckpt_dir: Path) -> tuple[Path, str]:
    """A clean folder with exactly what the Studio loads, plus configuration.json (the hub requires it) and the manifest."""
    out = Path(tempfile.mkdtemp())
    found = {n: next(iter(sorted(ckpt_dir.rglob(n))), None) for n in FILES}
    if not found["final_merged.pt"] or not found["sham_small_tokenizer.json"]:
        raise SystemExit("نقطة الحفظ المدموجة ناقصة (final_merged.pt أو مقطّع النص) — لا رفع")
    for n, p in found.items():
        if p:
            shutil.copy2(p, out / n)
    sha = sha256(out / "final_merged.pt")
    code_sig = stage_code(out / "studio_code")
    (out / "configuration.json").write_text(json.dumps({"framework": "pytorch", "task": "text-generation"}), encoding="utf-8")
    (out / "bridge_manifest.json").write_text(json.dumps({"sha": sha, "code_sig": code_sig, "files": sorted(p.name for p in out.iterdir())}), encoding="utf-8")
    return out, sha


def remote_manifest(api, model_id: str) -> dict:
    try:
        from modelscope.hub.file_download import model_file_download
        p = model_file_download(model_id, "bridge_manifest.json", cache_dir=tempfile.mkdtemp())
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        return {}


def push_model(ckpt_dir: Path) -> str:
    token = os.environ.get("MODELSCOPE_TOKEN", "")
    if not token:
        return "⏭ لا مفتاح ModelScope — لا رفع للنموذج"
    from modelscope.hub.api import HubApi
    api = HubApi()
    api.login(token)
    model_dir, sha = stage_model_dir(ckpt_dir)
    local = json.loads((model_dir / "bridge_manifest.json").read_text(encoding="utf-8"))
    remote = remote_manifest(api, MODEL_ID)
    if remote.get("sha") == sha and remote.get("code_sig") == local["code_sig"]:
        return "⏭ النموذج والكود في ModelScope هما نفسهما — لا إعادة رفع"
    from modelscope.hub.constants import Visibility
    api.push_model(model_id=MODEL_ID, model_dir=str(model_dir), visibility=Visibility.PRIVATE, license="apache-2.0",
                   chinese_name="Sham", commit_message=f"sham-merged-checkpoint {sha[:12]} code {local['code_sig'][:8]}")
    return f"✅ رُفع إلى ModelScope: النموذج {sha[:12]} والكود الموقَّع {local['code_sig'][:8]}"


def stage_studio(studio_dir: Path) -> str:
    """Copy the Sham app into the Studio clone. The old app (Nova's) is moved to legacy-nova/ once, never deleted."""
    legacy = studio_dir / "legacy-nova"
    if (studio_dir / "app.py").exists() and not (studio_dir / "sham_small").exists():
        legacy.mkdir(exist_ok=True)
        for name in ("app.py", "requirements.txt"):
            if (studio_dir / name).exists():
                shutil.move(str(studio_dir / name), str(legacy / name))
    shutil.copy2(HERE / "app.py", studio_dir / "app.py")
    shutil.copy2(HERE / "requirements.txt", studio_dir / "requirements.txt")
    shutil.copy2(HERE / "codesign.py", studio_dir / "codesign.py")
    code = studio_dir / "sham_small"
    shutil.rmtree(code, ignore_errors=True)
    code.mkdir()
    n = 0
    for p in SRC.glob("*.py"):
        if p.name not in CODE_FILES_EXCLUDE:
            shutil.copy2(p, code / p.name)
            n += 1
    shutil.copy2(SRC / "sham_general_tokenizer.json", code / "sham_general_tokenizer.json")
    return f"✅ نُسخ تطبيق شام إلى الاستوديو ({n} ملف كود)"


if __name__ == "__main__":
    if len(sys.argv) == 1:      # self-test: the studio staging and the model staging, with local fakes (no network, no token)
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            studio = d / "studio"
            studio.mkdir()
            (studio / "app.py").write_text("old nova app", encoding="utf-8")
            (studio / "requirements.txt").write_text("old", encoding="utf-8")
            stage_studio(studio)
            assert (studio / "legacy-nova" / "app.py").read_text(encoding="utf-8") == "old nova app"
            assert "Sham on the ModelScope Studio" in (studio / "app.py").read_text(encoding="utf-8")
            assert (studio / "sham_small" / "serve.py").exists() and (studio / "sham_small" / "sham_general_tokenizer.json").exists()
            assert not (studio / "sham_small" / "sham_small_api_keys.db").exists()
            stage_studio(studio)                                     # second run: the legacy copy is not overwritten by Sham's own app
            assert (studio / "legacy-nova" / "app.py").read_text(encoding="utf-8") == "old nova app"
            ck = d / "ck"
            ck.mkdir()
            os.environ["MODELSCOPE_TOKEN"] = "selftest-key"
            for n in FILES[:4]:
                (ck / n).write_bytes(n.encode())
            md, sha = stage_model_dir(ck)
            assert (md / "configuration.json").exists() and json.loads((md / "bridge_manifest.json").read_text())["sha"] == sha
            assert (md / "studio_code" / "ms_worker.py").exists() and (md / "studio_code" / "sham_small" / "model.py").exists()
            assert codesign.verify(md / "studio_code", (md / "studio_code" / codesign.SIG_NAME).read_text(), {"MODELSCOPE_API_TOKEN": "selftest-key"})
            assert not codesign.verify(md / "studio_code", (md / "studio_code" / codesign.SIG_NAME).read_text(), {"MODELSCOPE_API_TOKEN": "another"})
            os.environ.pop("MODELSCOPE_TOKEN", None)
            assert push_model(ck).startswith("⏭")
        print("sync_to_modelscope self-test OK")
    else:
        ck, studio = Path(sys.argv[1]), Path(sys.argv[2])
        print(push_model(ck))
        print(stage_studio(studio))
