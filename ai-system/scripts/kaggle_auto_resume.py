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
import shutil
import sys
from pathlib import Path


def _load_kaggle_api():
    from kaggle.api.kaggle_api_extended import KaggleApi

    api = KaggleApi()
    api.authenticate()
    return api


def resume_kernel(
    kernel_slug: str,
    notebook_repo_path: str | Path,
    work_dir: str | Path = "./kaggle-kernel",
    sync_from_repo: bool = False,
    dry_run: bool = False,
    api=None,
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
    resuming the real one)."""
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

    api.kernels_push(str(work_dir))
    print(f"kaggle_auto_resume: pushed -- '{kernel_slug}' should start a fresh run shortly.")
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

    print("\nAll kaggle_auto_resume decision-logic checks passed. The real kaggle.api calls themselves are "
          "unverified in this sandbox (no reachable internet/credentials here, same documented boundary as "
          "data_acquisition.py) -- what's proven is that THIS script's own branching (skip while running, "
          "resume when stopped, never substitute a missing kernel, content sync opt-in only, dry-run is "
          "genuinely inert) is correct.")
    sys.exit(0)
