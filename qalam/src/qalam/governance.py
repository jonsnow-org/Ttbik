"""What the model may change about itself, and what it may NEVER change. This module is itself protected: a model that can edit its own limits, its own
tests, its own evaluation sets or its own approval logic has no limits, and nothing it reports about its own progress could be trusted.

  free (inside a sandbox copy)       memory writes, training an adapter, proposing a skill, installing packages in its sandbox, editing code outside the protected set
  allowed once the GATE passes       promoting weights, adding a tool, merging unprotected code (owner decision 2026-11-23: no human click when the fixed metrics pass;
                                     every promotion is logged and can be reverted exactly)
  needs a person's approval          scheduling work for itself, activating a skill that acts on the outside world
  forbidden, always                  editing this policy, the gate, the tests, the held-out sets, the approval or confinement code, CI, secrets
"""
from __future__ import annotations

import fnmatch
import posixpath
from dataclasses import dataclass

MAX_MEMORY_WRITE = 5_000          # entries per call
MAX_ADAPTER_STEPS = 50_000

# Matched against the path relative to the repository root, anywhere in it.
PROTECTED = (
    "qalam/src/qalam/governance.py", "qalam/src/qalam/evolve.py", "qalam/src/qalam/agent.py", "qalam/src/qalam/fileops.py", "qalam/src/qalam/data.py",
    "qalam/src/qalam/checkpoint.py", "qalam/src/qalam/config.py", "qalam/tests/*", "qalam/eval/*", "qalam/artifacts/heldout/*", "qalam/notebooks/N24*",
    ".github/*", "deploy/*", "athar/*", "cloudflare/*", "CLAUDE.md", "*secret*", "*.env", "*.env.*", "*credential*", "*.pem", "*.key",
)

ALWAYS_FORBIDDEN = {"policy_edit", "gate_edit", "eval_edit", "test_edit", "approval_edit", "confinement_edit", "ci_edit", "secret_access"}
FREE = {"memory_write", "adapter_train", "skill_propose", "code_edit_dev", "package_install"}
GATED = {"adapter_promote", "weights_promote", "tool_register", "code_merge"}          # allowed when the gate (metrics / tests / CI) passed - no human needed
APPROVAL = {"skill_activate_external", "schedule_create"}


@dataclass(frozen=True)
class Verdict:
    allowed: bool
    needs_approval: bool
    reason: str


def is_protected(path: str) -> bool:
    p = posixpath.normpath(path.replace("\\", "/")).lstrip("/")
    if p.startswith("..") or "\x00" in p:
        return True                                              # anything that escapes is treated as protected
    return any(fnmatch.fnmatch(p, g) or fnmatch.fnmatch(p, "*/" + g) for g in PROTECTED)


def classify(kind: str, target: str = "", amount: int = 0, gate_passed: bool = False, approved: bool = False) -> Verdict:
    """May this self-change happen now? `approved` is a person's decision (it can only come from outside the model)."""
    if kind in ALWAYS_FORBIDDEN:
        return Verdict(False, False, f"{kind} is never allowed: the model cannot change its own limits")
    if kind not in FREE | GATED | APPROVAL:
        return Verdict(False, False, f"unknown self-change {kind!r}")
    if kind in ("code_edit_dev", "code_merge") and is_protected(target):
        return Verdict(False, False, f"{target} is protected")
    if kind == "memory_write" and not 0 <= amount <= MAX_MEMORY_WRITE:
        return Verdict(False, False, "too many memory entries in one write")
    if kind == "adapter_train" and not 0 < amount <= MAX_ADAPTER_STEPS:
        return Verdict(False, False, "training steps outside the allowed range")
    if kind in FREE:
        return Verdict(True, False, "ok (sandbox copy only)")
    if kind in GATED:
        return Verdict(True, False, "gate passed") if gate_passed else Verdict(False, False, "the gate (metrics / tests / CI) has not passed")
    if not approved:
        return Verdict(False, True, "needs a person's approval")
    return Verdict(True, False, "approved")
