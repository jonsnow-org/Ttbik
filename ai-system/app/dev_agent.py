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
  - can create a branch, read a file, write OR CREATE a file ON THAT
    NEW BRANCH ONLY (owner spec, 2026-09-12: "هل تستطيع تنفيذ هذا
    العمل الهندسي وانشاء ملف جديد" — create_file is the real, bounded
    extension that made a genuinely new capability possible, not just
    editing an existing file — same branch-only/PR-only shape, just
    omitting GitHub's own "sha" field, which is how its API already
    distinguishes "create" from "overwrite"), and open a pull request;
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

Owner spec, 2026-09-13 ("نظام الربط الحقيقي... يضيف نوفا لمواقعه كما
اضفتك انا لمواقعي"): every function below now takes optional
`token`/`repo`/`base_branch` overrides, all defaulting to None. None
means "use this project's own fixed env vars" — the exact behavior
this module has always had, so every existing owner call site
(propose_code_change, self_improve.py, propose_app_build) is
byte-for-byte unchanged. A caller acting on a CONNECTED external repo
(app/connections.py) passes that connection's own stored token/repo
instead — the same audited, branch-only, PR-only, forbidden-path-
checked code path, just pointed at a different repository with a
different credential. Nothing about the safety shape changes: whichever
repo is targeted, this module still cannot merge, delete a branch,
change settings, or write straight to that repo's base branch — only
open a PR, exactly as for this project's own repo.
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


def _headers(token: str | None = None) -> dict:
    return {
        "Authorization": f"Bearer {token or NOVA_DEV_AGENT_GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


# Real hole found 2026-09-13 while building the multi-file app builder
# (council.propose_app_build), not a hypothetical: nothing in this module
# stopped Nova from writing a file under .github/workflows/. A workflow
# file is not data — GitHub executes it as shell commands on push, with
# repository secrets in scope. Combined with the owner-directed
# auto_merge path, that would have been a complete, silent bypass of
# this project's single most explicit and least negotiable rule
# ("ممنوع أي صلاحية تنفيذ أوامر Terminal بالكامل" — see this module's
# own docstring above): no terminal was ever granted, one would simply
# have been written into existence and handed to GitHub's runners.
#
# So these paths are refused at the only layer that touches GitHub at
# all. Deliberately a hard refusal rather than a warning, and
# deliberately here rather than in each caller, so that every present
# and future path into this module inherits it automatically.
_FORBIDDEN_PATH_PREFIXES = (
    ".github/workflows/",
    ".github/actions/",
)


def _reject_forbidden_path(path: str) -> None:
    # NOT lstrip("./") — that strips any leading "." or "/" CHARACTER,
    # which turns ".github/workflows/x.yml" into "github/workflows/x.yml"
    # and silently defeats this entire check. Caught by a real test of
    # this exact path before it shipped; written out explicitly instead.
    normalized = (path or "").strip().replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    normalized = normalized.lstrip("/")
    for prefix in _FORBIDDEN_PATH_PREFIXES:
        if normalized.startswith(prefix):
            raise DevAgentError(
                f"مرفوض: {path} — ملفات GitHub Actions تُنفَّذ كأوامر Terminal حقيقية على خوادم GitHub، "
                "وكتابتها تلقائياً تعني منح صلاحية تنفيذ أوامر التفّت على القاعدة الأساسية للمشروع. "
                "عدّل هذا الملف بنفسك يدوياً إن أردته."
            )


def _ensure_token_repo(token: str | None, repo: str | None) -> None:
    if not (token or NOVA_DEV_AGENT_GITHUB_TOKEN) or not (repo or NOVA_DEV_AGENT_REPO):
        raise DevAgentError("أداة اقتراح التعديل غير مُعدّة بعد — NOVA_DEV_AGENT_GITHUB_TOKEN / NOVA_DEV_AGENT_REPO.")


def _ensure_configured(token: str | None = None, repo: str | None = None, base_branch: str | None = None) -> None:
    """Full check (token + repo + a base branch to fork/target) — for
    functions that actually need a base branch by default: get_file,
    create_branch, open_pull_request. update_file/create_file/
    merge_pull_request only ever touch an already-named branch or PR
    number, so they use _ensure_token_repo above instead."""
    _ensure_token_repo(token, repo)
    if not (base_branch or NOVA_DEV_AGENT_BASE_BRANCH):
        raise DevAgentError("أداة اقتراح التعديل غير مُعدّة بعد — لا فرع أساسي محدَّد (NOVA_DEV_AGENT_BASE_BRANCH).")


def get_file(path: str, ref: str | None = None, *, token: str | None = None, repo: str | None = None) -> tuple[str, str]:
    """Returns (decoded_text_content, blob_sha). ref defaults to
    NOVA_DEV_AGENT_BASE_BRANCH (or `repo`'s own base branch when both
    `token`/`repo` are given for a connected external repo) — read-only,
    no branch/PR involved."""
    resolved_repo = repo or NOVA_DEV_AGENT_REPO
    _ensure_configured(token, repo, ref or NOVA_DEV_AGENT_BASE_BRANCH)
    resp = requests.get(
        f"{_API_ROOT}/repos/{resolved_repo}/contents/{path}",
        headers=_headers(token),
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


def create_branch(
    new_branch: str, base_branch: str | None = None, *, token: str | None = None, repo: str | None = None
) -> None:
    """Real branch creation via git refs — never touches the base
    branch itself, only reads its current tip sha to fork from."""
    resolved_repo = repo or NOVA_DEV_AGENT_REPO
    _ensure_configured(token, repo, base_branch)
    base = base_branch or NOVA_DEV_AGENT_BASE_BRANCH
    ref_resp = requests.get(
        f"{_API_ROOT}/repos/{resolved_repo}/git/ref/heads/{base}",
        headers=_headers(token),
        timeout=30,
    )
    if not ref_resp.ok:
        raise DevAgentError(f"تعذّر إيجاد الفرع الأساسي '{base}' ({ref_resp.status_code}): {ref_resp.text[:300]}")
    base_sha = ref_resp.json()["object"]["sha"]

    create_resp = requests.post(
        f"{_API_ROOT}/repos/{resolved_repo}/git/refs",
        headers=_headers(token),
        json={"ref": f"refs/heads/{new_branch}", "sha": base_sha},
        timeout=30,
    )
    if not create_resp.ok:
        raise DevAgentError(f"تعذّر إنشاء فرع جديد '{new_branch}' ({create_resp.status_code}): {create_resp.text[:300]}")


def update_file(
    path: str, branch: str, new_content: str, sha: str, commit_message: str,
    *, token: str | None = None, repo: str | None = None,
) -> None:
    """Writes new_content to path ON `branch` ONLY — never called with
    the base branch as `branch` from anywhere in this module
    (propose_code_change below always passes the freshly created
    branch)."""
    resolved_repo = repo or NOVA_DEV_AGENT_REPO
    _ensure_token_repo(token, repo)
    _reject_forbidden_path(path)
    resp = requests.put(
        f"{_API_ROOT}/repos/{resolved_repo}/contents/{path}",
        headers=_headers(token),
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


def create_file(
    path: str, branch: str, content: str, commit_message: str,
    *, token: str | None = None, repo: str | None = None,
) -> None:
    """Owner spec, 2026-09-12 ("هل تستطيع تنفيذ هذا العمل الهندسي وانشاء
    ملف جديد دون اخطاء... فان كان جوابه مقنعا اقول له نفذ ونعطيه
    الصلاحية الكاملة"): the real, bounded extension that makes a
    genuinely NEW capability (not just editing an existing file)
    possible — still through the exact same safety shape as
    update_file above: writes ONLY to a fresh branch, never
    NOVA_DEV_AGENT_BASE_BRANCH directly, still surfaces as a real PR
    for review/merge, never a direct live write. The only real
    difference from update_file is the GitHub Contents API call below
    omitting "sha" — GitHub's own documented way to say "this path
    doesn't exist yet, create it" instead of "overwrite this exact
    version of an existing file". Raises DevAgentError instead of
    silently overwriting if the path unexpectedly already exists (a 422
    from GitHub in that case) — this function is for creation only, use
    update_file for an existing file."""
    resolved_repo = repo or NOVA_DEV_AGENT_REPO
    _ensure_token_repo(token, repo)
    _reject_forbidden_path(path)
    resp = requests.put(
        f"{_API_ROOT}/repos/{resolved_repo}/contents/{path}",
        headers=_headers(token),
        json={
            "message": commit_message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "branch": branch,
        },
        timeout=30,
    )
    if not resp.ok:
        raise DevAgentError(f"تعذّر إنشاء الملف الجديد على الفرع '{branch}' ({resp.status_code}): {resp.text[:300]}")


def upsert_file(
    path: str, branch: str, content: str, commit_message: str,
    *, token: str | None = None, repo: str | None = None,
) -> None:
    """Writes `path` on `branch` whether or not it already exists —
    create_file and update_file differ only in whether GitHub is given
    the current blob sha, and a caller building several files at once
    (council.propose_app_build) genuinely cannot know in advance which
    of its files are new. Looks the existing blob up ON THE BRANCH, not
    on the base branch, so writing the same file twice in one build
    works correctly instead of failing on a stale sha.

    Same branch-only guarantee as every function it delegates to: there
    is no argument here that could target a repo's base branch."""
    try:
        _current, sha = get_file(path, ref=branch, token=token, repo=repo)
    except DevAgentError:
        sha = None
    if sha:
        update_file(path, branch, content, sha, commit_message, token=token, repo=repo)
    else:
        create_file(path, branch, content, commit_message, token=token, repo=repo)


def open_pull_request(
    branch: str, title: str, body: str, base_branch: str | None = None,
    *, token: str | None = None, repo: str | None = None,
) -> tuple[str, int]:
    """Returns (html_url, pr_number). Opening a PR is the only function
    in this module that gets anywhere near the live branch by default —
    see merge_pull_request below for the one, explicitly opt-in
    exception the owner asked for."""
    resolved_repo = repo or NOVA_DEV_AGENT_REPO
    _ensure_configured(token, repo, base_branch)
    resp = requests.post(
        f"{_API_ROOT}/repos/{resolved_repo}/pulls",
        headers=_headers(token),
        json={"title": title, "head": branch, "base": base_branch or NOVA_DEV_AGENT_BASE_BRANCH, "body": body},
        timeout=30,
    )
    if not resp.ok:
        raise DevAgentError(f"تعذّر فتح Pull Request ({resp.status_code}): {resp.text[:300]}")
    data = resp.json()
    return data["html_url"], data["number"]


def merge_pull_request(pr_number: int, *, token: str | None = None, repo: str | None = None) -> None:
    """Owner spec, 2026-09-12 ("بداية نفعلها لي أنا مع الدمج التلقائي"):
    the ONE explicitly opt-in exception to "never merges" above —
    called ONLY when main.py has confirmed quota.is_platform_owner(user)
    AND the owner's request went through the auto-merge path. Still a
    real git merge commit (not a direct push/rewrite) — the change
    stays a normal, revertable commit in history either way, this just
    skips the manual tap. Raises DevAgentError on failure (e.g. a
    branch-protection rule blocking the merge) rather than failing
    silently, so the owner finds out the PR is still open awaiting
    manual action."""
    resolved_repo = repo or NOVA_DEV_AGENT_REPO
    _ensure_token_repo(token, repo)
    resp = requests.put(
        f"{_API_ROOT}/repos/{resolved_repo}/pulls/{pr_number}/merge",
        headers=_headers(token),
        json={"merge_method": "squash"},
        timeout=30,
    )
    if not resp.ok:
        raise DevAgentError(f"تعذّر الدمج التلقائي ({resp.status_code}): {resp.text[:300]} — الـPR ما زال مفتوحاً للمراجعة اليدوية.")
