"""
Sham publish probe (owner-facing, 2026-11-28): a notebook can keep RUNNING for weeks while its dataset never gets a
new version (sham-chat-checkpoint/image-tokenizer froze on 2026-11-08 05:24/08:03). This answers the only two questions
that matter, with evidence instead of a theory:

  check-creds        what a pushed kernel's credentials actually are: does sham-runtime-creds hold a kaggle.json that
                     still authenticates? (the fallback every API-pushed notebook relies on, because Kaggle returns
                     HTTP 400 for its secrets in those runs). Nothing secret is printed -- only names, booleans and the
                     API's own error text.
  publish NAME ...   one real re-version of each named dataset from this runner, using the same Python API the
                     notebooks' `kaggle datasets version -r zip` ends in. The uploaded content is downloaded from the
                     dataset's own latest version and a `publish_probe.json` is added, so the weights are untouched and
                     the version says exactly what it is. The full API answer (or exception body) is printed.
  repair-creds       refresh sham-runtime-creds/kaggle.json from this runner's credentials (the private dataset the
                     pushed kernels read), keeping whatever else that dataset holds.
  kernel-probe       push a one-minute kernel with no secrets and runtime-creds attached, then print its log: what a
                     pushed training notebook's credentials really do.
  inventory NAME ... one line per dataset: version number, lastUpdated date, size (the proof that a version is new).

  python sham_publish_probe.py check-creds
Needs KAGGLE_USERNAME + KAGGLE_API_TOKEN/KAGGLE_KEY (the repository's own Kaggle secrets).
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path

CREDS_DATASET = "sham-runtime-creds"


def _why(exc: Exception) -> str:
    """The exception's name plus the HTTP status and the API's own body: a bare 'HTTPError' hid whether a stop was a rate
    limit, a permission or an oversized upload."""
    resp = getattr(exc, "response", None)
    code = getattr(resp, "status_code", None) or getattr(exc, "code", None) or getattr(exc, "status", None)
    body = ""
    try:
        body = (getattr(resp, "text", "") or getattr(resp, "content", b"") or b"")[:600]
        body = body.decode("utf-8", "replace") if isinstance(body, bytes) else str(body)
    except Exception:
        pass
    return f"{type(exc).__name__}{f' HTTP {code}' if code else ''} {str(exc)[:300]}{f' | {body}'.strip() if body else ''}".strip()


def _api(creds: dict | None = None):
    from kaggle.api.kaggle_api_extended import KaggleApi

    saved = {k: os.environ.get(k) for k in ("KAGGLE_USERNAME", "KAGGLE_KEY", "KAGGLE_API_TOKEN")}
    try:
        if creds:
            os.environ["KAGGLE_USERNAME"] = creds["username"]
            os.environ.pop("KAGGLE_API_TOKEN", None)
            os.environ["KAGGLE_KEY"] = creds["key"]
        api = KaggleApi()
        api.authenticate()
        return api
    finally:
        if creds:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


def _account() -> str:
    return os.environ.get("KAGGLE_USERNAME") or "jonsnowjonsnow"   # the account every sham dataset lives under


def _find_kaggle_json(root: Path) -> dict | None:
    for p in sorted(root.rglob("kaggle.json")):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if d.get("username") and d.get("key"):
            return {**d, "_path": str(p)}
    return None


def check_creds() -> int:
    api = _api()
    has_token = bool(os.environ.get("KAGGLE_API_TOKEN"))
    has_legacy_key = bool(os.environ.get("KAGGLE_KEY"))
    print("runner account:", _account(), "| repository token present:", has_token,
          "| legacy key present:", has_legacy_key, flush=True)
    tmp = Path(tempfile.mkdtemp(prefix="creds_"))
    ref = f"{_account()}/{CREDS_DATASET}"
    try:
        api.dataset_download_files(ref, path=str(tmp), unzip=True, quiet=True)
    except Exception as exc:
        print(f"❌ {ref}: download failed: {_why(exc)}", flush=True)
        return 1
    files = sorted(str(p.relative_to(tmp)) for p in tmp.rglob("*") if p.is_file())
    print(f"{ref}: {len(files)} file(s) {files}", flush=True)
    creds = _find_kaggle_json(tmp)
    if not creds:
        print("❌ no usable kaggle.json in sham-runtime-creds: every API-pushed notebook has no Kaggle credentials "
              "(and its publish is skipped -- the exact silent freeze this probe was written for)", flush=True)
        return 2
    print(f"kaggle.json: username={'set' if creds.get('username') else 'EMPTY'} key_length={len(str(creds['key']))} "
          f"token_form={str(creds['key']).startswith('KGAT_')} same_account={creds.get('username') == _account()}", flush=True)
    api = _api(creds)
    # a real authenticated call, whichever listing method this CLI version exposes (2.x has dataset_list, no page_size)
    for label, call in (("dataset_list(mine=True)", lambda: api.dataset_list(mine=True)),
                        ("dataset_list()", lambda: api.dataset_list()),
                        ("datasets_list(mine=True)", lambda: api.datasets_list(mine=True))):
        try:
            mine = call()
        except (AttributeError, TypeError):
            continue                      # this CLI version does not have that call with those arguments: try the next one
        except Exception as exc:
            print(f"❌ sham-runtime-creds credentials are REJECTED by Kaggle ({label}): {_why(exc)}\n"
                  "   -> that is why API-pushed notebooks cannot publish. Fix: `repair-creds` (this workflow).", flush=True)
            return 3
        print(f"✅ sham-runtime-creds credentials still authenticate ({label} returned {len(mine or [])} row(s))", flush=True)
        return 0
    print("❌ this kaggle version exposes no authenticated listing call; the credentials themselves are unjudged", flush=True)
    return 3


def repair_creds() -> int:
    """Rewrite sham-runtime-creds/kaggle.json from this runner's credentials, keeping every other file of that dataset."""
    api = _api()
    user = _account()
    key = os.environ.get("KAGGLE_API_TOKEN") or os.environ.get("KAGGLE_KEY") or ""
    if not (user and key):
        print("❌ no runner credentials to copy", flush=True)
        return 2
    tmp = Path(tempfile.mkdtemp(prefix="creds_fix_"))
    ref = f"{user}/{CREDS_DATASET}"
    try:
        api.dataset_download_files(ref, path=str(tmp), unzip=True, quiet=True)
    except Exception as exc:
        print(f"⚠ could not download the current version ({_why(exc)}) — writing a fresh one", flush=True)
    (tmp / "kaggle.json").write_text(json.dumps({"username": user, "key": key}), encoding="utf-8")
    os.chmod(tmp / "kaggle.json", 0o600)
    (tmp / "dataset-metadata.json").write_text(json.dumps(
        {"title": CREDS_DATASET, "id": ref, "licenses": [{"name": "unknown"}]}), encoding="utf-8")
    note = f"kaggle.json refreshed from the repository's Kaggle secret at {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}"
    try:
        api.dataset_create_version(str(tmp), note, dir_mode="zip")
        print(f"✅ {ref}: new version published ({note})", flush=True)
        return 0
    except Exception as exc:
        print(f"❌ {ref}: version failed: {_why(exc)}", flush=True)
        return 1


def publish(names: list[str]) -> int:
    api = _api()
    user = _account()
    bad = 0
    for name in names:
        ref = f"{user}/{name}"
        tmp = Path(tempfile.mkdtemp(prefix=f"probe_{name}_"))
        print(f"\n===== {ref} =====", flush=True)
        try:
            api.dataset_download_files(ref, path=str(tmp), unzip=True, quiet=True)
        except Exception as exc:
            print(f"❌ download failed: {_why(exc)}", flush=True)
            bad += 1
            continue
        size_mb = sum(p.stat().st_size for p in tmp.rglob("*") if p.is_file()) / 1e6
        files = sorted(p.name for p in tmp.iterdir())
        print(f"downloaded latest version: {len(files)} top-level file(s), {size_mb:.1f} MB", flush=True)
        (tmp / "publish_probe.json").write_text(json.dumps({
            "at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            "why": "verification that the publish path works for this dataset (the weights are the previous version's, unchanged)",
            "from": "ai-system/supervision/sham_publish_probe.py in GitHub Actions",
        }, ensure_ascii=False, indent=1), encoding="utf-8")
        (tmp / "dataset-metadata.json").write_text(json.dumps(
            {"title": name, "id": ref, "licenses": [{"name": "unknown"}]}), encoding="utf-8")
        note = f"publish-path verification {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())} (same files as the previous version + publish_probe.json)"
        try:
            api.dataset_create_version(str(tmp), note, dir_mode="zip")
        except Exception as exc:
            print(f"❌ {ref}: version failed: {_why(exc)}", flush=True)
            bad += 1
            continue
        print(f"✅ {ref}: new version published ({size_mb:.1f} MB)", flush=True)
    return 1 if bad else 0


KERNEL_ID = "jonsnowjonsnow/sham-creds-probe"


def inventory(names: list[str]) -> int:
    """One compact line per dataset: the version number and the date Kaggle last updated it. This is the proof line --
    'v62 2026-11-08' turning into today's version -- without the notebooks' own 5-hour sessions."""
    api = _api()
    for name in names:
        ref = f"{_account()}/{name}"
        tmp = Path(tempfile.mkdtemp(prefix="inv_"))
        try:
            api.dataset_metadata(ref, path=str(tmp))
            meta = json.loads((tmp / "dataset-metadata.json").read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"❌ {ref}: {_why(exc)}", flush=True)
            continue
        version = meta.get("versionNumber") or meta.get("currentVersionNumber") or "?"
        updated = meta.get("lastUpdated") or "?"
        size = meta.get("totalBytes") or 0
        print(f"{name:34s} v{version} | lastUpdated {updated} | {float(size) / 1e9:.2f} GB", flush=True)
    return 0


def kernel_probe(timeout_min: int = 25) -> int:
    """Push a one-minute kernel that has NO Kaggle secrets (exactly how every API-pushed training notebook starts) and
    see what its credentials do: secrets reach it or not, sham-runtime-creds/kaggle.json reaches it or not, and whether
    `kaggle datasets list` authenticates there. This is the only cheap way to settle the kernel side -- the training
    notebooks' own logs stay empty until a 5-11 hour session ends."""
    api = _api()
    src = Path(__file__).resolve().parent / "creds_probe_kernel"
    work = Path(tempfile.mkdtemp(prefix="creds_probe_kernel_"))
    for p in src.iterdir():
        (work / p.name).write_bytes(p.read_bytes())
    (work / "kernel-metadata.json").write_text(json.dumps({
        "id": KERNEL_ID, "title": "sham-creds-probe", "code_file": "probe.py", "language": "python",
        "kernel_type": "script", "is_private": "true", "enable_gpu": "false", "enable_tpu": "false",
        "enable_internet": "true", "dataset_sources": [f"{_account()}/{CREDS_DATASET}"],
        "competition_sources": [], "kernel_sources": [], "model_sources": [],
    }), encoding="utf-8")
    print(f"pushing {KERNEL_ID} (no secrets, runtime-creds attached) …", flush=True)
    try:
        api.kernels_push(str(work))
    except Exception as exc:
        print(f"❌ push failed: {_why(exc)}", flush=True)
        return 1
    for i in range(max(1, timeout_min) * 2):
        time.sleep(30)
        try:
            status = api.kernels_status(KERNEL_ID)
            state = getattr(status, "status", str(status))
        except Exception as exc:
            state = f"status error: {_why(exc)}"
        print(f"  [{i * 30}s] {state}", flush=True)
        if str(state).lower().endswith(("complete", "error", "cancel")) or "complete" in str(state).lower() or "error" in str(state).lower():
            break
    out = Path(tempfile.mkdtemp(prefix="creds_probe_out_"))
    try:
        api.kernels_output(KERNEL_ID, path=str(out), quiet=True)
    except Exception as exc:
        print(f"❌ no output: {_why(exc)}", flush=True)
        return 1
    logs = sorted(out.rglob("*.log"))
    for log in logs:
        text = log.read_text(encoding="utf-8", errors="replace")
        print(f"\n===== {log.name} (last 4000 chars) =====\n{text[-4000:]}", flush=True)
    return 0 if logs else 1


def main(argv: list[str]) -> int:
    cmd = (argv[1] if len(argv) > 1 else "check-creds").strip()
    if cmd == "check-creds":
        return check_creds()
    if cmd == "repair-creds":
        return repair_creds()
    if cmd == "kernel-probe":
        return kernel_probe()
    if cmd == "inventory":
        return inventory(argv[2:] or ["sham-chat-checkpoint", "sham-image-tokenizer-checkpoint",
                                      "sham-checkpoint", "sham-multimodal-checkpoint",
                                      "sham-audio-tokenizer-checkpoint", "sham-merged-checkpoint"])
    if cmd == "publish":
        names = [a.strip() for a in argv[2:] if a.strip()]
        if not names:
            print("usage: sham_publish_probe.py publish DATASET [DATASET ...]", flush=True)
            return 2
        return publish(names)
    print(__doc__, flush=True)
    return 2


if __name__ == "__main__":
    import sys

    sys.exit(main(sys.argv))
