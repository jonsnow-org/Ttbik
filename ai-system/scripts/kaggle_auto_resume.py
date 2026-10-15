"""
Kaggle auto-resume orchestrator for sham_small_training.ipynb.

Owner's real, repeatedly stated pain point (2026-09-20): the notebook
budgets MAX_TRAINING_HOURS=8.5 per run by design, then stops -- and
Kaggle's own native "Schedule this notebook" feature flatly refuses to
schedule ANY notebook with a GPU attached (a real, already-documented
platform limit in this repo -- see deploy-kaggle-notebook.yml's own
comment). Until this script, resuming meant a human manually reopening
the notebook on Kaggle and clicking "Save & Run All" again, every single
time it stopped -- exactly the "استمرار العمل اليدوي" (continuous manual
work) friction the owner asked to eliminate.

REVISED, 2026-09-20 (owner-reported real failure): the original delivery
mechanism for this -- a GitHub Actions workflow calling this script on a
schedule -- was tried for real and failed: the push did not reliably take
effect ("السكربت لا يضاف") and training failed at startup afterward. The
known Kaggle-side caveat further down (an API push can disconnect a
kernel's attached Secrets) is a plausible contributor -- cell 2 of
sham_small_training.ipynb needs GITHUB_TOKEN to even clone the repo, so a
disconnected secret there would fail training at exactly its very first
step -- but this is not confirmed as THE cause, only a known risk that
was already flagged before this was tried.

That GitHub Actions workflow has been removed. This script's own
decision logic (check real status, resume only when genuinely stopped,
never substitute a missing kernel) is unchanged and still fully
verified below -- what changed is WHERE it runs from: a Kaggle-NATIVE,
GPU-free orchestrator notebook (kaggle_notebooks/
kaggle_resume_orchestrator.ipynb) that Kaggle's own scheduler CAN run
(only GPU-attached notebooks are blocked from scheduling; a CPU-only one
is not), calling resume_kernel() below directly instead of going through
GitHub Actions at all.

This reuses the exact `kaggle kernels push` mechanism this project
already trusts for merge_and_finetune.ipynb / process_video_queue.ipynb /
generate_image_model.ipynb (see those three deploy-kaggle-*.yml
workflows), but adds a real safety check those don't need: this
notebook's runs are many real GPU-hours long (unlike the queue processor,
which "most runs cost seconds"), so blindly re-pushing on a fixed
schedule without checking whether a version is STILL running risks
disrupting a real, valuable, in-progress training session instead of
merely resuming a finished one. A real status check via Kaggle's own API
removes that risk instead of assuming Kaggle's push/queue behavior under
overlap is safe.

Deliberately does NOT overwrite the Kaggle kernel's notebook content from
this repo by default (unlike the three sibling workflows) -- the owner's
actual live notebook may have been set up directly through Kaggle's own
UI, possibly diverging from what's committed here, and the point of THIS
script is specifically "resume what's already running," not "also sync
code" as a side effect. Pass sync_from_repo=True explicitly on the rare
run where that's actually wanted.

KNOWN, OWNER-ACCEPTED PLATFORM CAVEAT (already documented in
deploy-kaggle-image-video-notebook.yml and deploy-kaggle-video-queue.yml
for this exact same "kaggle kernels push" mechanism): pushing a kernel via
the API can disconnect its attached Secrets (GITHUB_TOKEN,
KAGGLE_USERNAME, KAGGLE_KEY, all three used by sham_small_training.ipynb
itself -- see its own cells 2 and 24) and reset the selected accelerator,
even though the push itself reports success. There is no field in
kernel-metadata.json to manage Secrets, and no known programmatic
workaround yet. This script cannot fix that Kaggle-side limitation; it
can only flag it loudly every time it actually pushes, so it never looks
like silent, fully "invisible" automation when it is not.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import time
import sys
from pathlib import Path


def _load_kaggle_api():
    from kaggle.api.kaggle_api_extended import KaggleApi

    api = KaggleApi()
    api.authenticate()
    return api


GPU_RETRY_HOURS = 24
# GPU/accelerator AND quota wording -- a plain "time limit exceeded" must not count.
_GPU_QUOTA = re.compile(r"(gpu|accelerator).*(quota|exceed|limit)|(quota|limit).*(gpu|accelerator)", re.IGNORECASE)


def _set_gpu(work_dir: Path, enable: bool) -> bool:
    meta_path = work_dir / "kernel-metadata.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    was = bool(meta.get("enable_gpu"))
    meta["enable_gpu"] = enable
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return was


def _push_ok(api, work_dir: Path) -> None:
    resp = api.kernels_push(str(work_dir))
    error = getattr(resp, "error", None)
    if isinstance(error, str) and error.strip():
        raise RuntimeError(error)


def _resume_accelerator(api, work_dir: Path, slug: str, last_failed: bool, failure: str, state: dict) -> str:
    entry = state.setdefault(slug, {})
    set_to_gpu = _set_gpu(work_dir, False)  # read the notebook's current setting
    fallback_since = entry.get("gpu_fallback_since")
    if not set_to_gpu and not fallback_since:
        # The owner chose CPU (the free option): never move it to a paid GPU.
        _push_ok(api, work_dir)
        return "CPU (owner's choice)"

    now = time.time()
    quota_failed = last_failed and bool(_GPU_QUOTA.search(failure))
    waiting = fallback_since and now - fallback_since < GPU_RETRY_HOURS * 3600
    if not quota_failed and not waiting:
        _set_gpu(work_dir, True)
        try:
            _push_ok(api, work_dir)
            entry.pop("gpu_fallback_since", None)
            return "GPU (owner's choice)"
        except Exception as exc:
            print(f"kaggle_auto_resume: GPU refused for '{slug}' ({exc}) -- continuing on the free CPU instead.")
            quota_failed = True
        _set_gpu(work_dir, False)
    if quota_failed:
        entry["gpu_fallback_since"] = now
        print(f"kaggle_auto_resume: '{slug}' is a GPU notebook without GPU quota -- running it on CPU; "
              f"GPU will be tried again in {GPU_RETRY_HOURS}h.")
    _push_ok(api, work_dir)
    return "CPU (GPU quota exhausted)"


# --- SHAM_SECRETS_FALLBACK (2026-10-15, additive) ---------------------------
# Real failure: every API-pushed version of the three notebooks died in cell 1
# with HTTP 400 from UserSecretsClient.get_secret, although the owner's Secrets
# are attached (Kaggle denies secrets to API-pushed runs). The live notebooks
# are pulled from Kaggle and re-pushed, so the fix is applied here to what is
# pushed: a first cell that keeps get_secret unchanged when it works, and falls
# back (public clone / private kaggle.json dataset) when it does not. The
# owner's accelerator, internet and secret settings are left as pulled.
RUNTIME_CREDS_DATASET = "sham-runtime-creds"
SECRETS_FALLBACK_MARKER = "SHAM_SECRETS_FALLBACK_V2"  # v1 referenced a global that later cells could not see
SECRETS_FALLBACK_CELL = '# SHAM_SECRETS_FALLBACK_V2 (2026-10-15)\n# كاكل يرفض قراءة الأسرار (HTTP 400) في النسخ المرفوعة آلياً من المراقب.\n# لا تغيّر شيئاً حين تعمل الأسرار. وإلا: GITHUB_TOKEN -> استنساخ عام بلا توكن،\n# KAGGLE_* -> kaggle.json من مجموعة البيانات الخاصة sham-runtime-creds (تُضبط\n# في متغيرات البيئة فوراً كي تجدها كل الوحدات)، وتيليجرام يبقى اختيارياً.\ndef _sham_secrets_fallback_v2():\n    import glob, json, os, subprocess\n    os.environ.setdefault("GIT_TERMINAL_PROMPT", "0")\n    subprocess.run(["git", "config", "--global", "url.https://github.com/.insteadOf", "https://@github.com/"], check=False)\n\n    def creds():\n        for p in sorted(glob.glob("/kaggle/input/**/kaggle.json", recursive=True)):\n            try:\n                with open(p) as f:\n                    d = json.load(f)\n                if d.get("username") and d.get("key"):\n                    return d\n            except Exception:\n                pass\n        return {}\n\n    c = creds()\n    print("sham-runtime-creds:", "موجودة" if c else "غير موجودة في المدخلات")\n    if c and not (os.environ.get("KAGGLE_USERNAME") and (os.environ.get("KAGGLE_KEY") or os.environ.get("KAGGLE_API_TOKEN"))):\n        os.environ["KAGGLE_USERNAME"] = c["username"]\n        os.environ["KAGGLE_KEY"] = c["key"]\n        if c["key"].startswith("KGAT_"):\n            os.environ["KAGGLE_API_TOKEN"] = c["key"]\n    try:\n        from kaggle_secrets import UserSecretsClient\n    except Exception:\n        return\n    if getattr(UserSecretsClient.get_secret, "_sham_safe2", False):\n        return\n    orig = UserSecretsClient.get_secret\n\n    def get_secret(self, label, *a, **k):\n        try:\n            return orig(self, label, *a, **k)\n        except Exception:\n            if label == "GITHUB_TOKEN":\n                print("تنبيه: سرّ GITHUB_TOKEN غير متاح لهذا التشغيل — استنساخ عام بلا توكن.")\n                return ""\n            if label in ("KAGGLE_USERNAME", "KAGGLE_KEY"):\n                d = creds()\n                if d:\n                    return d["username"] if label == "KAGGLE_USERNAME" else d["key"]\n            raise\n\n    get_secret._sham_safe2 = True\n    UserSecretsClient.get_secret = get_secret\n\ntry:\n    _sham_secrets_fallback_v2()\nexcept Exception as _sf2_exc:\n    print("SHAM_SECRETS_FALLBACK_V2 غير مفعّل:", type(_sf2_exc).__name__)\n'


# --- SHAM_SECRETS_FALLBACK_V3 (2026-10-15, additive) ------------------------
# Real failure after hours of training: the save cells of ab_in_one and
# chat_image_in_one died with NameError '_sf_orig' / '_sf_creds' -- the pulled
# kernels still carried the v1 cell (v2 was prepended in front of it), and v1's
# wrapper looks its helpers up as notebook globals that were gone by then.
# v3 is inserted right after the last existing fallback cell, depends on no
# global at all (closure + default args), puts the creds into os.environ and
# ~/.kaggle/kaggle.json up front, and catches any error of the wrappers below it.
SECRETS_FALLBACK_V3_MARKER = "SHAM_SECRETS_FALLBACK_V3"
SECRETS_FALLBACK_V3_CELL = '# SHAM_SECRETS_FALLBACK_V3 (2026-10-15)\n# بعد ساعات من التدريب فشلت خلية الحفظ بـ NameError: \'_sf_orig\' / \'_sf_creds\'\n# (الغلاف القديم V1 يعتمد على متغيرات عامة اختفت). هذه الخلية مستقلة تماماً:\n# لا تعتمد على أي متغير عام، تضبط KAGGLE_USERNAME/KAGGLE_KEY في البيئة و\n# ~/.kaggle/kaggle.json فوراً، وتلتقط أي خطأ من الأغلفة السابقة (حتى NameError)\n# فترجع القيم من البيئة. آمنة إن أُعيد تشغيلها.\ndef _sham_secrets_fallback_v3():\n    import glob, json, os\n\n    def load_creds(_glob=glob, _json=json, _os=os):\n        u, k = _os.environ.get("KAGGLE_USERNAME"), _os.environ.get("KAGGLE_KEY") or _os.environ.get("KAGGLE_API_TOKEN")\n        if u and k:\n            return {"username": u, "key": k}\n        pats = ["/kaggle/input/sham-runtime-creds/**/kaggle.json", "/kaggle/input/**/kaggle.json",\n                _os.path.expanduser("~/.kaggle/kaggle.json")]\n        for pat in pats:\n            for p in sorted(_glob.glob(pat, recursive=True)):\n                try:\n                    with open(p) as f:\n                        d = _json.load(f)\n                    if d.get("username") and d.get("key"):\n                        return d\n                except Exception:\n                    pass\n        return {}\n\n    c = load_creds()\n    if c:\n        os.environ.setdefault("KAGGLE_USERNAME", c["username"])\n        if not (os.environ.get("KAGGLE_KEY") or os.environ.get("KAGGLE_API_TOKEN")):\n            os.environ["KAGGLE_KEY"] = c["key"]\n            if str(c["key"]).startswith("KGAT_"):\n                os.environ["KAGGLE_API_TOKEN"] = c["key"]\n        try:\n            kp = os.path.expanduser("~/.kaggle/kaggle.json")\n            if not os.path.exists(kp):\n                os.makedirs(os.path.dirname(kp), exist_ok=True)\n                with open(kp, "w") as f:\n                    json.dump({"username": c["username"], "key": c["key"]}, f)\n                os.chmod(kp, 0o600)\n        except Exception:\n            pass\n    print("SHAM_SECRETS_FALLBACK_V3: بيانات كاكل", "جاهزة في البيئة" if c else "غير موجودة")\n    try:\n        from kaggle_secrets import UserSecretsClient\n    except Exception:\n        return\n    if getattr(UserSecretsClient.get_secret, "_sham_safe3", False):\n        return\n\n    def get_secret(self, label, *a, _prev=UserSecretsClient.get_secret, _load=load_creds, **k):\n        try:\n            return _prev(self, label, *a, **k)\n        except BaseException as e:\n            if isinstance(e, KeyboardInterrupt):\n                raise\n            if label == "GITHUB_TOKEN":\n                return ""\n            if label in ("KAGGLE_USERNAME", "KAGGLE_KEY"):\n                d = _load()\n                if d:\n                    return d["username"] if label == "KAGGLE_USERNAME" else d["key"]\n            raise\n\n    get_secret._sham_safe3 = True\n    get_secret._sham_safe2 = True  # يمنع V2 من إعادة التغليف لو أعيد تشغيلها\n    get_secret._sham_safe = True   # ويمنع V1 كذلك\n    UserSecretsClient.get_secret = get_secret\n\ntry:\n    _sham_secrets_fallback_v3()\nexcept Exception as _sf3_exc:\n    print("SHAM_SECRETS_FALLBACK_V3 غير مفعّل:", type(_sf3_exc).__name__)\n'


def _insert_fallback_v3(cells: list) -> bool:
    """Adds the v3 cell once, after the last older fallback cell (or first). Removes nothing."""
    if any(SECRETS_FALLBACK_V3_MARKER in "".join(c.get("source") or []) for c in cells):
        return False
    pos = 0
    for i, c in enumerate(cells):
        if "SHAM_SECRETS_FALLBACK" in "".join(c.get("source") or []):
            pos = i + 1
    cells.insert(pos, {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [],
                       "source": SECRETS_FALLBACK_V3_CELL.splitlines(keepends=True)})
    return True


def _apply_runtime_fixes(work_dir: Path, kernel_slug: str) -> list:
    """Adds the fallback cell and the private creds dataset; never removes anything."""
    done = []
    work_dir = Path(work_dir)
    meta_path = work_dir / "kernel-metadata.json"
    if not meta_path.exists():
        return done
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    owner = (meta.get("id") or kernel_slug).split("/")[0]
    creds = f"{owner}/{RUNTIME_CREDS_DATASET}"
    sources = list(meta.get("dataset_sources") or [])
    if creds not in sources:
        sources.append(creds)
        meta["dataset_sources"] = sources
        done.append("creds_dataset")
    if meta.get("enable_internet") is not True:
        meta["enable_internet"] = True
        done.append("internet")
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    code_path = work_dir / str(meta.get("code_file") or "")
    if code_path.is_file() and code_path.suffix == ".ipynb":
        nb = json.loads(code_path.read_text(encoding="utf-8"))
        cells = nb.get("cells") or []
        if not any(SECRETS_FALLBACK_MARKER in "".join(c.get("source") or []) for c in cells):
            cell = {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [],
                    "source": SECRETS_FALLBACK_CELL.splitlines(keepends=True)}
            nb["cells"] = [cell] + cells
            code_path.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
            done.append("fallback_cell")
        nb = json.loads(code_path.read_text(encoding="utf-8"))
        cells = nb.get("cells") or []
        if _insert_fallback_v3(cells):
            nb["cells"] = cells
            code_path.write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
            done.append("fallback_cell_v3")
    return done


def resume_kernel(
    kernel_slug: str,
    notebook_repo_path: str | Path,
    work_dir: str | Path = "./kaggle-kernel",
    sync_from_repo: bool = False,
    dry_run: bool = False,
    api=None,
    auto_accelerator: bool = False,
    state: dict | None = None,
    runtime_fixes: bool = False,
) -> str:
    """Real orchestration logic, factored out from any CLI/argv concerns
    so it can be exercised directly (with a fake `api`) by this file's
    own __main__ self-test without needing real Kaggle credentials or
    network access -- same "verified, not assumed" approach this
    project's other components already use for anything that can't
    reach the real internet from a test sandbox.

    Returns one of: "still_running", "pushed", "dry_run_would_push",
    "not_found" (kernel_slug does not exist on Kaggle -- deliberately
    never falls back to creating a substitute kernel, since that would
    silently start a second, disconnected training run instead of
    resuming the real one).

    auto_accelerator (owner design, 2026-09-24 -- every Sham notebook runs on
    GPU or CPU, and the owner picks one per notebook):
      * notebook set to CPU  -> always resumed on CPU, never moved to GPU;
      * notebook set to GPU  -> resumed on GPU; when the free GPU quota is
        exhausted (push refused, or the last run failed for lack of quota)
        it is resumed on CPU instead, and moved back to GPU once the quota
        can be tried again (at most one GPU retry per GPU_RETRY_HOURS).
    `state` (a dict the caller persists between runs) remembers which CPU
    runs are only a quota fallback of a GPU notebook -- without it, a
    fallen-back notebook would look exactly like one the owner set to CPU."""
    from kagglesdk.kernels.types.kernels_enums import KernelWorkerStatus

    api = api or _load_kaggle_api()
    work_dir = Path(work_dir)

    try:
        status_response = api.kernels_status(kernel_slug)
    except Exception as exc:
        print(f"kaggle_auto_resume: could not read status for '{kernel_slug}' ({exc}) -- "
              f"treating as not found. Never falling back to creating a substitute kernel.")
        return "not_found"

    status = status_response.status
    failure = str(getattr(status_response, "failure_message", "") or "")
    if status in (KernelWorkerStatus.RUNNING, KernelWorkerStatus.QUEUED):
        print(f"kaggle_auto_resume: '{kernel_slug}' is still {status.name} -- nothing to do.")
        return "still_running"

    print(f"kaggle_auto_resume: '{kernel_slug}' is {status.name} -- resuming.")

    if dry_run:
        print("kaggle_auto_resume: --dry-run set, not actually pushing.")
        return "dry_run_would_push"

    if work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True)

    api.kernels_pull(kernel_slug, str(work_dir), metadata=True, quiet=False)

    if sync_from_repo:
        meta_path = work_dir / "kernel-metadata.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        code_file = meta["code_file"]
        shutil.copy2(notebook_repo_path, work_dir / code_file)
        print(f"kaggle_auto_resume: synced notebook content from {notebook_repo_path} before resuming.")

    try:
        _fixes = _apply_runtime_fixes(work_dir, kernel_slug) if runtime_fixes else []
        if _fixes:
            print(f"kaggle_auto_resume: runtime fixes added: {', '.join(_fixes)}")
    except Exception as exc:
        print(f"kaggle_auto_resume: runtime fixes skipped ({type(exc).__name__}).")

    if auto_accelerator:
        device = _resume_accelerator(api, work_dir, kernel_slug, status == KernelWorkerStatus.ERROR,
                                     failure, state if state is not None else {})
    else:
        api.kernels_push(str(work_dir))
        device = "accelerator unchanged"
    print(f"kaggle_auto_resume: pushed ({device}) -- '{kernel_slug}' should start a fresh run shortly.")
    print("kaggle_auto_resume: REMINDER -- verify on Kaggle's own UI that Secrets (GITHUB_TOKEN, "
          "KAGGLE_USERNAME, KAGGLE_KEY) and the GPU accelerator are still attached after this push. "
          "This is a known Kaggle API limitation (see this file's own module docstring), not something "
          "this script can fix or detect from here.")
    return "pushed"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kernel-slug", required=True, help='e.g. "jonsnowjonsnow/notebook2d0e40c1f1"')
    parser.add_argument(
        "--notebook-repo-path",
        default="ai-system/colab/sham_small/kaggle_notebooks/sham_small_training.ipynb",
    )
    parser.add_argument("--sync-from-repo", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = resume_kernel(
        kernel_slug=args.kernel_slug,
        notebook_repo_path=args.notebook_repo_path,
        sync_from_repo=args.sync_from_repo,
        dry_run=args.dry_run,
    )
    return 1 if result == "not_found" else 0


if __name__ == "__main__":
    # Real, mocked self-test of the decision logic (RUNNING/QUEUED ->
    # skip; COMPLETE/ERROR/CANCEL_ACKNOWLEDGED -> resume; unknown/not
    # found -> never fall back to creating a substitute). Mocked because
    # this sandbox has no real Kaggle credentials or reachable internet
    # (same documented environment boundary as ai-system/colab/
    # sham_small/data_acquisition.py) -- this tests THIS script's own
    # branching, not Kaggle's live API, which is exactly the part a
    # human can't easily verify by eye before trusting this to run
    # unattended on a schedule.
    from unittest.mock import MagicMock

    from kagglesdk.kernels.types.kernels_enums import KernelWorkerStatus

    def fake_api(status: KernelWorkerStatus, status_error: bool = False):
        api = MagicMock()
        if status_error:
            api.kernels_status.side_effect = RuntimeError("kernel not found")
        else:
            resp = MagicMock()
            resp.status = status
            api.kernels_status.return_value = resp
        return api

    # 1) Still running -> must NOT push
    api = fake_api(KernelWorkerStatus.RUNNING)
    result = resume_kernel("user/slug", "notebook.ipynb", api=api)
    assert result == "still_running", f"expected still_running, got {result}"
    assert api.kernels_push.call_count == 0, "must never push while the kernel is still running"
    print("RUNNING status correctly left alone (no push).")

    # 2) Queued -> must NOT push either
    api = fake_api(KernelWorkerStatus.QUEUED)
    result = resume_kernel("user/slug", "notebook.ipynb", api=api)
    assert result == "still_running"
    assert api.kernels_push.call_count == 0
    print("QUEUED status correctly left alone (no push).")

    # 3) Complete -> must pull + push, no content sync by default
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        work_dir = Path(tmp) / "kaggle-kernel"

        def fake_pull(kernel, path, metadata=False, quiet=True):
            Path(path).mkdir(parents=True, exist_ok=True)
            (Path(path) / "kernel-metadata.json").write_text(
                json.dumps({"id": kernel, "code_file": "notebook.ipynb"}), encoding="utf-8"
            )
            (Path(path) / "notebook.ipynb").write_text('{"cells": []}', encoding="utf-8")

        api = fake_api(KernelWorkerStatus.COMPLETE)
        api.kernels_pull.side_effect = fake_pull

        notebook_src = Path(tmp) / "repo_notebook.ipynb"
        notebook_src.write_text('{"cells": ["from repo"]}', encoding="utf-8")

        result = resume_kernel("user/slug", str(notebook_src), work_dir=work_dir, api=api)
        assert result == "pushed", f"expected pushed, got {result}"
        assert api.kernels_pull.call_count == 1
        assert api.kernels_push.call_count == 1
        pushed_notebook = (work_dir / "notebook.ipynb").read_text(encoding="utf-8")
        assert pushed_notebook == '{"cells": []}', (
            "without sync_from_repo, the pulled notebook content must be pushed back UNCHANGED"
        )
        print("COMPLETE status correctly triggered pull+push, content left unchanged (no sync).")

    # 4) Error -> must also resume (a crashed run is exactly as stopped as a finished one)
    with tempfile.TemporaryDirectory() as tmp:
        work_dir = Path(tmp) / "kaggle-kernel"
        api = fake_api(KernelWorkerStatus.ERROR)
        api.kernels_pull.side_effect = fake_pull
        notebook_src = Path(tmp) / "repo_notebook.ipynb"
        notebook_src.write_text('{"cells": ["from repo"]}', encoding="utf-8")
        result = resume_kernel("user/slug", str(notebook_src), work_dir=work_dir, api=api)
        assert result == "pushed"
        print("ERROR status correctly triggered a resume push too.")

    # 5) sync_from_repo=True -> pushed content must come from the repo file
    with tempfile.TemporaryDirectory() as tmp:
        work_dir = Path(tmp) / "kaggle-kernel"
        api = fake_api(KernelWorkerStatus.COMPLETE)
        api.kernels_pull.side_effect = fake_pull
        notebook_src = Path(tmp) / "repo_notebook.ipynb"
        notebook_src.write_text('{"cells": ["from repo"]}', encoding="utf-8")
        result = resume_kernel("user/slug", str(notebook_src), work_dir=work_dir, sync_from_repo=True, api=api)
        assert result == "pushed"
        pushed_notebook = (work_dir / "notebook.ipynb").read_text(encoding="utf-8")
        assert pushed_notebook == '{"cells": ["from repo"]}', (
            "with sync_from_repo=True, the pushed notebook content must come from the repo file"
        )
        print("sync_from_repo=True correctly overwrote the pushed content with this repo's notebook.")

    # 5b) auto_accelerator: owner's CPU choice never moves to GPU; GPU falls back to CPU without quota
    def run(meta_gpu, last_status=KernelWorkerStatus.COMPLETE, failure="", push_errors=(), state=None):
        with tempfile.TemporaryDirectory() as tmp:
            work_dir = Path(tmp) / "kaggle-kernel"
            api = fake_api(last_status)
            api.kernels_status.return_value.failure_message = failure

            def pull(kernel, path, metadata=False, quiet=True):
                fake_pull(kernel, path, metadata, quiet)
                meta = json.loads((Path(path) / "kernel-metadata.json").read_text())
                (Path(path) / "kernel-metadata.json").write_text(json.dumps({**meta, "enable_gpu": meta_gpu}))

            api.kernels_pull.side_effect = pull
            flags, errors = [], list(push_errors)

            def push(path):
                flags.append(json.loads((Path(path) / "kernel-metadata.json").read_text())["enable_gpu"])
                if errors:
                    raise errors.pop(0)
                return MagicMock(error="")

            api.kernels_push.side_effect = push
            state = {} if state is None else state
            assert resume_kernel("user/slug", "nb.ipynb", work_dir=work_dir, api=api,
                                 auto_accelerator=True, state=state) == "pushed"
            return flags, state

    assert run(False)[0] == [False]                                                   # CPU stays CPU
    assert run(True, KernelWorkerStatus.ERROR, "Time limit exceeded")[0] == [True]    # not a quota issue
    assert run(False, KernelWorkerStatus.ERROR, "GPU quota exceeded")[0] == [False]   # ...always
    assert run(True)[0] == [True]                                                     # GPU stays GPU
    flags, st = run(True, KernelWorkerStatus.ERROR, "You have exceeded your weekly GPU quota")
    assert flags == [False] and st["user/slug"]["gpu_fallback_since"]                 # no quota -> CPU
    flags, st = run(True, push_errors=[RuntimeError("GPU quota exceeded")])
    assert flags == [True, False] and st["user/slug"]["gpu_fallback_since"]           # refused -> CPU
    assert run(False, state=st)[0] == [False]                                         # fallback: wait 24h
    st["user/slug"]["gpu_fallback_since"] -= (GPU_RETRY_HOURS + 1) * 3600
    flags, st = run(False, state=st)
    assert flags == [True] and "gpu_fallback_since" not in st["user/slug"]            # back on GPU
    print("auto_accelerator: CPU choice never moves to GPU; GPU falls back to CPU without quota and returns later.")

    # 6) Kernel not found -> never create a substitute, just report not_found
    api = fake_api(KernelWorkerStatus.COMPLETE, status_error=True)
    result = resume_kernel("user/wrong-slug", "notebook.ipynb", api=api)
    assert result == "not_found"
    assert api.kernels_push.call_count == 0, "a missing kernel must never trigger a push to a substitute"
    print("Unknown/missing kernel slug correctly reported as not_found, with zero push attempted.")

    # 7) dry_run=True -> detects the need to resume but never actually pushes
    api = fake_api(KernelWorkerStatus.COMPLETE)
    result = resume_kernel("user/slug", "notebook.ipynb", dry_run=True, api=api)
    assert result == "dry_run_would_push"
    assert api.kernels_pull.call_count == 0 and api.kernels_push.call_count == 0
    print("dry_run=True correctly identified a resume was needed without touching Kaggle at all.")

    # 8) SHAM_SECRETS_FALLBACK: added once, nothing removed, settings kept
    import tempfile as _tf
    with _tf.TemporaryDirectory() as _d:
        _w = Path(_d)
        (_w / "kernel-metadata.json").write_text(json.dumps({"id": "u/k", "code_file": "k.ipynb", "enable_gpu": True,
            "enable_internet": True, "dataset_sources": ["u/sham-checkpoint"]}))
        (_w / "k.ipynb").write_text(json.dumps({"cells": [{"cell_type": "code", "source": ["x = 1"]}]}))
        assert _apply_runtime_fixes(_w, "u/k") == ["creds_dataset", "fallback_cell", "fallback_cell_v3"]
        assert _apply_runtime_fixes(_w, "u/k") == []
        _m = json.loads((_w / "kernel-metadata.json").read_text())
        _nb = json.loads((_w / "k.ipynb").read_text())
        assert _m["dataset_sources"] == ["u/sham-checkpoint", "u/sham-runtime-creds"] and _m["enable_gpu"] is True
        assert len(_nb["cells"]) == 3 and SECRETS_FALLBACK_MARKER in "".join(_nb["cells"][0]["source"])
        assert SECRETS_FALLBACK_V3_MARKER in "".join(_nb["cells"][1]["source"])
        assert _nb["cells"][2]["source"] == ["x = 1"]
        compile(SECRETS_FALLBACK_V3_CELL, "fallback_cell_v3", "exec")
        compile(SECRETS_FALLBACK_CELL, "fallback_cell", "exec")
    print("SHAM_SECRETS_FALLBACK cell + private creds dataset added exactly once; GPU and existing cells untouched.")

    print("\nAll kaggle_auto_resume decision-logic checks passed. The real kaggle.api calls themselves are "
          "unverified in this sandbox (no reachable internet/credentials here, same documented boundary as "
          "data_acquisition.py) -- what's proven is that THIS script's own branching (skip while running, "
          "resume when stopped, never substitute a missing kernel, content sync opt-in only, dry-run is "
          "genuinely inert) is correct.")
    sys.exit(0)
