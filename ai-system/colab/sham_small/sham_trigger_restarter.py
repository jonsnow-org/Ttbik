"""
Sham — ask the restarter to run as soon as this notebook's session ends (owner, 2026-10-16).

GitHub's */15 cron for sham-restarter.yml actually fires every 3-5 hours, so a finished notebook
sat idle for hours. At the end of a session (atexit, so it fires even after a failure) this sends
one workflow_dispatch for sham-restarter.yml (live=1, delay=N seconds so Kaggle has time to mark
the kernel COMPLETE before the restarter looks at it).

  * token: env GITHUB_TOKEN / GH_TOKEN, else the Kaggle secret GITHUB_TOKEN; none -> silent no-op;
  * never raises, never prints the token; SHAM_NO_RESTART_TRIGGER=1 switches it off;
  * fires at most once per process; outside Kaggle (no /kaggle) it does nothing.
Deployment plumbing only: it touches no training, model, merge or data logic.

  python sham_trigger_restarter.py   -> offline self-test
"""
from __future__ import annotations

import atexit
import json
import os
import urllib.request

REPO = os.environ.get("SHAM_RESTARTER_REPO", "jonsnow-org/Ttbik")
WORKFLOW = "sham-restarter.yml"
REF = "sham-main"
PUBLISH_WORKFLOW = "publish-sham-v2-trained.yml"
PUBLISH_REF = "claude/free-services-marketplace-h6rwk2"
DEFAULT_DELAY = 240
PUBLISHED_FLAG = os.environ.get("SHAM_V2_PUBLISHED_FLAG", "/kaggle/working/sham-v2-training-published.json")
_STATE = {"installed": False, "fired": False}


def _token() -> str | None:
    for k in ("GITHUB_TOKEN", "GH_TOKEN"):
        if os.environ.get(k):
            return os.environ[k]
    try:
        from kaggle_secrets import UserSecretsClient
        t = UserSecretsClient().get_secret("GITHUB_TOKEN")
        if t:
            return t
    except Exception:
        pass
    return _token_from_input()


# Kernels the restarter pushes through the API get no Kaggle secrets (that is why the
# credentials fallback V3 reads kaggle.json from the private dataset sham-runtime-creds).
# Same idea for this one request (added 2026-10-16): an optional file with a token limited to
# "Actions: write" on this repo. File absent -> silent no-op, exactly as before.
TOKEN_FILES = ("github_dispatch_token.txt", "github_token.txt")


def _token_from_input() -> str | None:
    import glob
    for name in TOKEN_FILES:
        for pat in (f"/kaggle/input/sham-runtime-creds/**/{name}", f"/kaggle/input/**/{name}"):
            for p in sorted(glob.glob(pat, recursive=True)):
                try:
                    t = open(p, encoding="utf-8").read().strip()
                    if t:
                        return t
                except Exception:
                    pass
    return None


def _request(token: str, delay: int) -> urllib.request.Request:
    body = json.dumps({"ref": REF, "inputs": {"live": "1", "delay": str(int(delay))}}).encode()
    return urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/actions/workflows/{WORKFLOW}/dispatches", data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"})


def _publish_request(token: str) -> urllib.request.Request:
    body = json.dumps({"ref": PUBLISH_REF, "inputs": {}}).encode()
    return urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/actions/workflows/{PUBLISH_WORKFLOW}/dispatches",
        data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"})


def _send_dispatch(opener, request: urllib.request.Request, label: str) -> bool:
    try:
        with opener(request, timeout=20) as response:
            ok = getattr(response, "status", 204) in (200, 201, 204)
        print(f"sham_trigger_restarter: {label} {'requested' if ok else 'not accepted'}")
        return ok
    except Exception as exc:
        print(f"sham_trigger_restarter: {label} skipped ({type(exc).__name__})")
        return False


def _training_published_ok(flag_path: str = PUBLISHED_FLAG) -> bool:
    """Only publish trained weights when the notebook confirms the dataset upload completed."""
    try:
        with open(flag_path, encoding="utf-8") as fh:
            stamp = json.load(fh)
        return (
            int(stamp.get("step") or 0) > 0
            and stamp.get("dataset") == "sham-v2-checkpoint"
            and stamp.get("dataset_published") is True
            and bool(stamp.get("checkpoint"))
            and bool(stamp.get("tools_after"))
            and bool(stamp.get("arabic_after"))
        )
    except (OSError, ValueError, TypeError):
        return False


def trigger(delay: int = DEFAULT_DELAY, opener=urllib.request.urlopen, token: str | None = None, published: bool | None = None) -> bool:
    if _STATE["fired"] or os.environ.get("SHAM_NO_RESTART_TRIGGER") == "1":
        return False
    if token is None and not os.environ.get("KAGGLE_KERNEL_RUN_TYPE"):
        return False
    tok = token or _token()
    if not tok:
        return False
    _STATE["fired"] = True
    # atexit also runs after notebook failures. In that case, restart training but do NOT
    # dispatch the weight publisher unless cell 25 wrote a success stamp after dataset upload.
    was_published = _training_published_ok() if published is None else bool(published)
    if was_published:
        _send_dispatch(opener, _publish_request(tok), "trained-checkpoint publisher")
    else:
        print("sham_trigger_restarter: publisher skipped (no successful trained-checkpoint upload stamp)")
    return _send_dispatch(opener, _request(tok, delay), f"restarter (in ~{delay}s)")


def install(delay: int = DEFAULT_DELAY) -> None:
    # review 2026-10-17: only inside a real Kaggle kernel (Kaggle sets KAGGLE_KERNEL_RUN_TYPE). A directory /kaggle exists on every GitHub runner of ours and on dev
    # machines, so any self-test that merely imported sham_inputs used to send a REAL live=1 dispatch at exit when a token was around.
    if _STATE["installed"] or not os.path.isdir("/kaggle") or not os.environ.get("KAGGLE_KERNEL_RUN_TYPE"):
        return
    _STATE["installed"] = True
    atexit.register(trigger, delay)


def _self_test() -> None:
    sent = []

    class R:
        status = 204
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def opener(req, timeout=0):
        sent.append(json.loads(req.data)); assert "secret" in req.headers["Authorization"]; return R()

    for k in ("GITHUB_TOKEN", "GH_TOKEN"):
        os.environ.pop(k, None)
    assert trigger(opener=opener) is False and not sent            # no token -> silent no-op
    # A normal failed/not-yet-finished run may restart, but cannot publish weights.
    assert trigger(5, opener=opener, token="secret", published=False) is True
    assert sent == [{"ref": "sham-main", "inputs": {"live": "1", "delay": "5"}}]
    _STATE["fired"] = False
    sent.clear()
    # The notebook's explicit post-upload call is allowed to dispatch the guarded publisher.
    assert trigger(5, opener=opener, token="secret", published=True) is True
    assert sent == [
        {"ref": PUBLISH_REF, "inputs": {}},
        {"ref": "sham-main", "inputs": {"live": "1", "delay": "5"}},
    ]
    assert trigger(opener=opener, token="secret", published=True) is False  # once per process
    _STATE["fired"] = False
    def bad(*a, **k): raise OSError("net")
    assert trigger(opener=bad, token="secret", published=False) is False   # never raises
    print("sham_trigger_restarter self-test OK")


if __name__ == "__main__":
    _self_test()
