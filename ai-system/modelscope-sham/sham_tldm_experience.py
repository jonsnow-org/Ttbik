"""Append-only JSONL of verified T-LDM episode outcomes for the self-evolution loop.

Schema (tldm.session_experience.v1) matches what safe_evolve.load_session_pairs /
anonymize_record already ingest (SHAM_TLDM_SESSION_PAIRS):

    {"schema","verified","success","task","ref_reply","steps","secs"}

No personal data is written: no user/session ids, emails, IPs, names, or credentials.
The task and reply are redacted first. Unverified rows set verified=false so the
trainer skips them; verified successes and verified failures are both stored.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sys
from pathlib import Path

SCHEMA = "tldm.session_experience.v1"
DEFAULT_PATH = "/mnt/workspace/sham2_tldm_experience/sessions.jsonl"

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)")
IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
SECRET = re.compile(r"(?i)\b(api[_-]?key|token|secret|password|passwd|bearer|authorization)\b\s*[:=]\s*\S+")
TOKENISH = re.compile(r"\b(?:sk|ghp|gho|ghu|ghs|ghr|xox[baprs]|ya29|eyJ)[A-Za-z0-9_\-.=]{8,}\b")


def _hidden_unlock_text(text: str) -> bool:
    """True when text is the owner passphrase. Never log or echo it."""
    raw = (text or "").replace("\r\n", "\n").strip()
    if not raw:
        return False
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    named = (os.environ.get("SHAM_OWNER_PASSPHRASE_HASH") or "").strip().lower()
    if named.startswith("sha256:"):
        named = named[7:]
    if len(named) == 64 and all(c in "0123456789abcdef" for c in named):
        try:
            return hmac.compare_digest(digest, bytes.fromhex(named))
        except Exception:
            return False
    plain = os.environ.get("SHAM_OWNER_PASSPHRASE")
    if plain:
        return hmac.compare_digest(digest, hashlib.sha256(plain.encode("utf-8")).digest())
    return False


def experience_path() -> Path | None:
    raw = (os.environ.get("SHAM_TLDM_SESSION_PAIRS") or "").strip()
    if raw:
        return Path(raw)
    if Path("/mnt/workspace").is_dir():
        return Path(DEFAULT_PATH)
    return None


def redact(text: str, limit: int = 2000) -> str:
    s = (text or "").replace("\x00", "")
    s = EMAIL.sub("[email]", s)
    s = SECRET.sub(lambda m: m.group(1) + "=[redacted]", s)
    s = TOKENISH.sub("[token]", s)
    s = IPV4.sub("[ip]", s)
    s = PHONE.sub("[phone]", s)
    s = re.sub(r"tldm-sham_v2-\d+", "tldm-sham_v2-[id]", s)
    return s.strip()[:limit]


def record(task: str, reply: str, steps, success: bool, secs: float = 0.0, verified: bool = True) -> dict:
    clean_steps = []
    for item in steps or []:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        cmd = redact(str(item[0]), 500)
        out = redact(str(item[1]), 1000)
        ok = bool(item[2]) if len(item) >= 3 else (not str(item[1]).lower().startswith("denied"))
        clean_steps.append([cmd, out, ok])
    return {
        "schema": SCHEMA,
        "verified": bool(verified),
        "success": bool(success),
        "task": redact(task, 500),
        "ref_reply": redact(reply, 2000),
        "steps": clean_steps,
        "secs": round(float(secs or 0), 3),
    }


def append(rec: dict, path: Path | None = None) -> Path | None:
    """Write one JSONL line. Never raises to the chat path."""
    try:
        if not isinstance(rec, dict) or "task" not in rec:
            return None
        if _hidden_unlock_text(str(rec.get("task") or "")) or _hidden_unlock_text(str(rec.get("ref_reply") or "")):
            return None
        dest = path or experience_path()
        if dest is None:
            return None
        dest.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n"
        with dest.open("a", encoding="utf-8") as f:
            f.write(line)
        return dest
    except OSError:
        return None


def evolution_root() -> Path | None:
    raw = (os.environ.get("SHAM_TLDM_EVOLUTION_ROOT") or "").strip()
    if raw:
        return Path(raw)
    if Path("/mnt/workspace").is_dir():
        return Path("/mnt/workspace/sham2_tldm_evolution")
    return None


def _evo():
    """Import the self-evolution serving API (record / hints). None if it is not staged."""
    try:
        tldm = Path(__file__).resolve().parent / "tldm"
        if not (tldm / "evolution" / "api.py").is_file():
            tldm = Path(__file__).resolve().parent.parent / "tldm"
        if (tldm / "evolution" / "api.py").is_file() and str(tldm) not in sys.path:
            sys.path.insert(0, str(tldm))
        from evolution import api as evo_api  # type: ignore
        return evo_api
    except Exception:
        return None


def evo_hints(task: str) -> dict:
    """Optional inference help from lessons memory. Never used to block a work-time command."""
    api = _evo()
    dest = evolution_root()
    if api is None or dest is None:
        return {}
    try:
        return api.hints(str(dest), "sham2-tldm", task) or {}
    except Exception:
        return {}


def record_command(user: str, task: str, command: str, exit_code: int, stdout: str = "", stderr: str = "",
                   verdict=None, latency_s: float = 0.0, adapter: str = "base", display_name: str = "", source: str = "user") -> str:
    """Call api.record after a command (and its verifier, if any) has finished. Never raises.

    verdict is True/False only from a verifier; None = stored and not learned.
    display_name is used only to scrub the task/command (it is not stored).
    """
    api = _evo()
    dest = evolution_root()
    if api is None or dest is None:
        return ""
    if _hidden_unlock_text(task) or _hidden_unlock_text(command):
        return ""
    names = (display_name,) if str(display_name or "").strip() else ()
    src = "owner" if source == "owner" else (source or "user")
    try:
        return api.record(
            str(dest),
            "sham2-tldm",
            user=user or "anon",
            task=redact(task, 500),
            command=redact(command, 500),
            exit_code=int(exit_code),
            stdout=redact(stdout, 1000),
            stderr=redact(stderr, 1000),
            verdict=verdict,
            latency_s=latency_s,
            adapter=adapter or "base",
            names=names,
            source=src,
        )
    except Exception:
        return ""


def _evo_record(task: str, steps, success: bool, secs: float, session: str = "", verified: bool = True, display_name: str = "", source: str = "user") -> None:
    """Episode fallback: one api.record per command. A clean exit without a verifier is stored, not learned."""
    items = list(steps or [])
    if items:
        for item in items:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            cmd, out = str(item[0]), str(item[1])
            ok = bool(item[2]) if len(item) >= 3 else (not str(item[1]).lower().startswith("denied"))
            if len(item) >= 4:
                verdict = bool(item[3])
            elif not ok:
                verdict = False
            else:
                verdict = None
            record_command(
                session or "anon", task, cmd, 0 if ok else 1,
                stdout=out if ok else "", stderr="" if ok else out,
                verdict=verdict, latency_s=secs, display_name=display_name, source=source,
            )
        return
    record_command(
        session or "anon", task, "", 0 if success else 1,
        verdict=bool(success) if verified else None, latency_s=secs, display_name=display_name, source=source,
    )


def log_episode(task: str, reply: str, steps, success: bool, secs: float = 0.0, verified: bool = True, session: str = "", display_name: str = "", source: str = "user") -> dict:
    if _hidden_unlock_text(task) or _hidden_unlock_text(reply):
        return {}
    rec = record(task, reply, steps, success, secs, verified)
    append(rec)
    _evo_record(task, steps, success, secs, session=session, verified=verified, display_name=display_name, source=source)
    return rec
