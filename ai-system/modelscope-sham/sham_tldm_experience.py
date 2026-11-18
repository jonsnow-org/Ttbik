"""Append-only JSONL of verified T-LDM episode outcomes for the self-evolution loop.

Schema (tldm.session_experience.v1) matches what safe_evolve.load_session_pairs /
anonymize_record already ingest (SHAM_TLDM_SESSION_PAIRS):

    {"schema","verified","success","task","ref_reply","steps","secs"}

No personal data is written: no user/session ids, emails, IPs, names, or credentials.
The task and reply are redacted first. Unverified rows set verified=false so the
trainer skips them; verified successes and verified failures are both stored.
"""
from __future__ import annotations

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


def _evo_record(task: str, steps, success: bool, secs: float, session: str = "", verified: bool = True) -> None:
    """Forward verified command outcomes to the self-evolution ingest API (no raw PII)."""
    if not verified:
        return
    try:
        tldm = Path(__file__).resolve().parent / "tldm"
        if not (tldm / "evolution" / "api.py").is_file():
            tldm = Path(__file__).resolve().parent.parent / "tldm"
        if (tldm / "evolution" / "api.py").is_file() and str(tldm) not in sys.path:
            sys.path.insert(0, str(tldm))
        from evolution.api import record as evo_record  # type: ignore
    except Exception:
        return
    dest = evolution_root()
    if dest is None:
        return
    root = str(dest)
    user = session or "anon"
    try:
        items = list(steps or [])
        if items:
            for item in items:
                if not isinstance(item, (list, tuple)) or len(item) < 2:
                    continue
                cmd = redact(str(item[0]), 500)
                out = redact(str(item[1]), 1000)
                ok = bool(item[2]) if len(item) >= 3 else (not str(item[1]).lower().startswith("denied"))
                evo_record(
                    root, "sham2-tldm", user=user, task=redact(task, 500), command=cmd,
                    exit_code=0 if ok else 1, stdout=out if ok else "", stderr="" if ok else out,
                    verdict=bool(ok), latency_s=secs, names=(), source="user",
                )
        else:
            evo_record(
                root, "sham2-tldm", user=user, task=redact(task, 500), command="",
                exit_code=0 if success else 1, stdout="", stderr="",
                verdict=bool(success), latency_s=secs, names=(), source="user",
            )
    except Exception:
        return


def log_episode(task: str, reply: str, steps, success: bool, secs: float = 0.0, verified: bool = True, session: str = "") -> dict:
    rec = record(task, reply, steps, success, secs, verified)
    append(rec)
    _evo_record(task, steps, success, secs, session=session, verified=verified)
    return rec
