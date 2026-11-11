"""Lightning AI access shared by the probe, the job runner and the limits check (owner's free Studio).

Live 2026-11-11 with a fresh `lightning login` token (the new platform has no API key, only LIGHTNING_USER_ID + an auth token):
  * the SDK's whoami endpoint answers 403 (an HTML page) for that token, and Teamspace.studios / Studio() call it first;
  * the account's teamspace «document-intelligence-upgrade-project» belongs to the ORGANISATION jonsnowx1r-lab-org, not the user,
    so Teamspace(name=..., user=User("jonsnowx1r-lab")) says it does not exist.
patch_whoami() falls back to LIGHTNING_USER_ID; teamspace() builds the org-owned teamspace (SHAM_LIGHTNING_ORG), falling back to the user one.
"""
from __future__ import annotations

import os
import types

ORG = os.environ.get("SHAM_LIGHTNING_ORG", "jonsnowx1r-lab-org")
USER = os.environ.get("SHAM_LIGHTNING_USER", "jonsnowx1r-lab")
TEAMSPACE = os.environ.get("SHAM_LIGHTNING_TEAMSPACE", "document-intelligence-upgrade-project")


def has_credentials() -> bool:
    return bool((os.environ.get("LIGHTNING_USER_ID") and os.environ.get("LIGHTNING_API_KEY")) or os.environ.get("LIGHTNING_AUTH_TOKEN"))


def patch_whoami() -> None:
    try:
        from lightning_sdk.api import auth_api
    except Exception:
        return
    if getattr(auth_api.AuthApi.whoami, "_sham_fallback", False):
        return
    orig = auth_api.AuthApi.whoami

    def whoami(self):
        try:
            return orig(self)
        except Exception:
            return types.SimpleNamespace(user_id=os.environ.get("LIGHTNING_USER_ID", ""), org_id=None, project_id=None, role_ids=None)
    whoami._sham_fallback = True
    auth_api.AuthApi.whoami = whoami


def teamspace(name: str | None = None):
    patch_whoami()
    from lightning_sdk import Teamspace, User
    name = name or TEAMSPACE
    errors = []
    for build in (lambda: Teamspace(name=f"{ORG}/{name}") if ORG else None, lambda: Teamspace(name=name, user=User(name=USER))):
        try:
            ts = build()
            if ts is not None:
                return ts
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {str(exc)[:160]}")
    raise RuntimeError("teamspace not found: " + " | ".join(errors))


def why(exc: BaseException) -> str:
    """The server's own JSON reason when there is one (e.g. 403 "not available to your account during maintenance")."""
    e: BaseException | None = exc
    while e is not None:
        body = getattr(e, "body", None)
        if isinstance(body, (bytes, str)):
            b = body.decode("utf-8", "replace") if isinstance(body, bytes) else body
            if b.lstrip().startswith("{"):
                return b[:200]
        e = e.__cause__ or e.__context__
    return str(exc)[:240]
