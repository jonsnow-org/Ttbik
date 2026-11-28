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
    return os.environ.get("KAGGLE_USERNAME") or ""


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
    print(f"runner account: {_account()} | KAGGLE_API_TOKEN set: {bool(os.environ.get('KAGGLE_API_TOKEN'))} "
          f"| KAGGLE_KEY set: {bool(os.environ.get('KAGGLE_KEY'))}", flush=True)
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
    try:
        mine = _api(creds).datasets_list(mine=True, page_size=1)
        print(f"✅ sham-runtime-creds credentials still authenticate (list returned {len(mine or [])} row(s))", flush=True)
        return 0
    except Exception as exc:
        print(f"❌ sham-runtime-creds credentials are REJECTED by Kaggle: {_why(exc)}\n"
              "   -> that is why API-pushed notebooks cannot publish. Fix: `repair-creds` (this workflow).", flush=True)
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


def main(argv: list[str]) -> int:
    cmd = (argv[1] if len(argv) > 1 else "check-creds").strip()
    if cmd == "check-creds":
        return check_creds()
    if cmd == "repair-creds":
        return repair_creds()
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
