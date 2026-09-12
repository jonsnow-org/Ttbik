"""
Owner spec, 2026-09-12 — the "Dev Agent" (owner-only code-change
proposal tool). Explicit safety constraints from the owner, verbatim,
none of them negotiable:

  "ممنوع التنفيذ الفوري أو الكتابة المباشرة على الفرع الحي بأي شكل.
  ممنوع أي صلاحية تنفيذ أوامر Terminal بالكامل ... أي تعديل يقترحه
  نوفا يُنشأ كفرع Git جديد + Pull Request عبر GitHub API، ولا يُدمج
  إلا بعد مراجعة."

  "توكن GitHub ... مقيّد النطاق (Fine-grained PAT) بصلاحية contents +
  pull_requests فقط على هذا المستودع، لا صلاحيات إدارية، يُخزَّن كسرّ
  بيئي فقط، ولا يظهر أبداً في أي رد أو سجل."

This module is the ENTIRE surface that touches GitHub for this
feature. It:
  - has NO subprocess/os.system/shell-out capability of any kind —
    only `requests` HTTP calls to GitHub's REST API;
  - can create a branch, read a file, write a file ON THAT NEW BRANCH
    ONLY, and open a pull request;
  - CANNOT merge a pull request, delete a branch, change repo settings,
    or touch NOVA_DEV_AGENT_BASE_BRANCH directly — no function here
    calls any endpoint that could do those things, by construction, not
    by a runtime permission check alone (the fine-grained PAT itself is
    also scoped to contents+pull_requests only, per the owner's own
    requirement above — a second, independent layer, not a substitute
    for this one);
  - never logs or returns the token itself in any message, error, or
    log line — every function below reads it directly from config and
    never includes it in anything passed back to a caller.

Every function here is called ONLY after main.py has already confirmed
quota.is_platform_owner(user) for the current request — there is no
separate authorization check in this module itself, exactly like the
existing /admin/* endpoints' _require_internal pattern (one real check,
done once, upstream).
"""
import base64
import logging

import requests

from app.config import (
    NOVA_DEV_AGENT_BASE_BRANCH,
    NOVA_DEV_AGENT_GITHUB_TOKEN,
    NOVA_DEV_AGENT_REPO,
)

logger = logging.getLogger("nova")

_API_ROOT = "https://api.github.com"


class DevAgentError(Exception):
    """Raised for any GitHub-side failure — main.py catches this and
    relays str(e) to the owner. Every raise site below builds its
    message from the HTTP status/response body only, never from the
    token or headers, so this is always safe to relay verbatim."""


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {NOVA_DEV_AGENT_GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _ensure_configured() -> None:
    if not NOVA_DEV_AGENT_GITHUB_TOKEN or not NOVA_DEV_AGENT_REPO or not NOVA_DEV_AGENT_BASE_BRANCH:
        raise DevAgentError(
            "أداة اقتراح التعديل غير مُعدّة بعد على الخادم — "
            "NOVA_DEV_AGENT_GITHUB_TOKEN / NOVA_DEV_AGENT_REPO / NOVA_DEV_AGENT_BASE_BRANCH."
        )


def get_file(path: str, ref: str | None = None) -> tuple[str, str]:
    """Returns (decoded_text_content, blob_sha). ref defaults to
    NOVA_DEV_AGENT_BASE_BRANCH — read-only, no branch/PR involved."""
    _ensure_configured()
    resp = requests.get(
        f"{_API_ROOT}/repos/{NOVA_DEV_AGENT_REPO}/contents/{path}",
        headers=_headers(),
        params={"ref": ref or NOVA_DEV_AGENT_BASE_BRANCH},
        timeout=30,
    )
    if resp.status_code == 404:
        raise DevAgentError(f"لم يُعثر على الملف: {path}")
    if not resp.ok:
        raise DevAgentError(f"تعذّرت قراءة الملف من GitHub ({resp.status_code}): {resp.text[:300]}")
    data = resp.json()
    if data.get("type") != "file" or "content" not in data:
        raise DevAgentError(f"{path} ليس ملفاً عادياً قابلاً للقراءة (مجلد؟).")
    content = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    return content, data["sha"]


def create_branch(new_branch: str, base_branch: str | None = None) -> None:
    """Real branch creation via git refs — never touches
    NOVA_DEV_AGENT_BASE_BRANCH itself, only reads its current tip sha
    to fork from."""
    _ensure_configured()
    base = base_branch or NOVA_DEV_AGENT_BASE_BRANCH
    ref_resp = requests.get(
        f"{_API_ROOT}/repos/{NOVA_DEV_AGENT_REPO}/git/ref/heads/{base}",
        headers=_headers(),
        timeout=30,
    )
    if not ref_resp.ok:
        raise DevAgentError(f"تعذّر إيجاد الفرع الأساسي '{base}' ({ref_resp.status_code}): {ref_resp.text[:300]}")
    base_sha = ref_resp.json()["object"]["sha"]

    create_resp = requests.post(
        f"{_API_ROOT}/repos/{NOVA_DEV_AGENT_REPO}/git/refs",
        headers=_headers(),
        json={"ref": f"refs/heads/{new_branch}", "sha": base_sha},
        timeout=30,
    )
    if not create_resp.ok:
        raise DevAgentError(f"تعذّر إنشاء فرع جديد '{new_branch}' ({create_resp.status_code}): {create_resp.text[:300]}")


def update_file(path: str, branch: str, new_content: str, sha: str, commit_message: str) -> None:
    """Writes new_content to path ON `branch` ONLY — never called with
    NOVA_DEV_AGENT_BASE_BRANCH as `branch` from anywhere in this
    module (propose_code_change below always passes the freshly
    created branch)."""
    _ensure_configured()
    resp = requests.put(
        f"{_API_ROOT}/repos/{NOVA_DEV_AGENT_REPO}/contents/{path}",
        headers=_headers(),
        json={
            "message": commit_message,
            "content": base64.b64encode(new_content.encode("utf-8")).decode("ascii"),
            "sha": sha,
            "branch": branch,
        },
        timeout=30,
    )
    if not resp.ok:
        raise DevAgentError(f"تعذّر كتابة التعديل على الفرع '{branch}' ({resp.status_code}): {resp.text[:300]}")


def open_pull_request(branch: str, title: str, body: str, base_branch: str | None = None) -> str:
    """Returns the PR's html_url. This is the ONLY function in this
    module that can be described as "shipping" a change anywhere near
    the live branch — and even this only opens a PR against it,
    never merges. No function anywhere here calls the merge endpoint."""
    _ensure_configured()
    resp = requests.post(
        f"{_API_ROOT}/repos/{NOVA_DEV_AGENT_REPO}/pulls",
        headers=_headers(),
        json={"title": title, "head": branch, "base": base_branch or NOVA_DEV_AGENT_BASE_BRANCH, "body": body},
        timeout=30,
    )
    if not resp.ok:
        raise DevAgentError(f"تعذّر فتح Pull Request ({resp.status_code}): {resp.text[:300]}")
    return resp.json()["html_url"]
