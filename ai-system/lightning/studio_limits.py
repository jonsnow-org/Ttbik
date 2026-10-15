"""
How many free Studios does the owner's Lightning account really allow — and can a second one run at the same time? (measured, nothing assumed)

Steps, each printed: the account's teamspaces and Studios (name, status, machine) and any plan/limit/credit attributes the SDK exposes; then it tries to
CREATE a small probe Studio ("sham-limit-probe"), START it on the free CPU while the main Studio keeps working, run `nproc` in it, and reports exactly
what Lightning answers at each step (the error text is the finding). Whatever it created is stopped and deleted at the end. It never touches the
main Studio. Secrets are not printed (only names and counts).

    python studio_limits.py          needs LIGHTNING_USER_ID + LIGHTNING_API_KEY; without them it only says so (exit 0)
"""
from __future__ import annotations

import os
import sys

PROBE = "sham-limit-probe"


def say(msg: str) -> None:
    print(msg, flush=True)


def attrs_like(obj, words=("plan", "limit", "quota", "credit", "tier", "max", "free", "machine", "status")) -> str:
    out = []
    for name in dir(obj):
        if name.startswith("_") or not any(w in name.lower() for w in words):
            continue
        try:
            val = getattr(obj, name)
        except Exception as exc:
            val = f"<{type(exc).__name__}>"
        if callable(val):
            continue
        out.append(f"{name}={str(val)[:60]}")
    return ", ".join(out) or "(لا شيء)"


def main() -> int:
    if not (os.environ.get("LIGHTNING_USER_ID") and os.environ.get("LIGHTNING_API_KEY")):
        say("لا مفاتيح Lightning في البيئة — لا فحص")
        return 0
    from lightning_sdk import Machine, Studio, Teamspace, User
    user = os.environ.get("SHAM_LIGHTNING_USER", "jonsnowx1r-lab")
    space = os.environ.get("SHAM_LIGHTNING_TEAMSPACE", "document-intelligence-upgrade-project")
    ts = Teamspace(name=space, user=User(name=user))
    say("مساحة الفريق: " + attrs_like(ts))
    studios = list(ts.studios)
    say(f"عدد الاستوديوهات الموجودة: {len(studios)}")
    for s in studios:
        say(f"  • {getattr(s, 'name', s)} | الحالة: {getattr(s, 'status', '?')} | الآلة: {getattr(s, 'machine', '?')}")
    probe = None
    try:
        probe = Studio(name=PROBE, teamspace=ts, create_ok=True)
        say(f"أُنشئ استوديو الفحص: {PROBE} (الحالة {getattr(probe, 'status', '?')})")
    except Exception as exc:
        say(f"تعذّر إنشاء استوديو ثانٍ: {type(exc).__name__}: {str(exc)[:300]}")
        return 0
    try:
        probe.start(Machine.CPU)
        say(f"بدأ استوديو الفحص على CPU والاستوديو الرئيسي يعمل: الحالة {getattr(probe, 'status', '?')}")
        say("نواة/ذاكرة: " + str(probe.run("nproc; free -g | head -2")).strip().replace("\n", " | "))
        say("الاستوديوهات العاملة الآن: " + ", ".join(f"{getattr(s, 'name', s)}={getattr(s, 'status', '?')}" for s in ts.studios))
    except Exception as exc:
        body = str(getattr(exc, "body", "") or "")[:400]       # Lightning's own explanation is in the response body
        say(f"تعذّر تشغيل استوديو ثانٍ بالتزامن: {type(exc).__name__} {getattr(exc, 'status', '')} | {body or str(exc)[:200]}")
    finally:
        try:
            probe.stop()
        except Exception:
            pass
        try:
            probe.delete()
            say("حُذف استوديو الفحص")
        except Exception as exc:
            say(f"لم يُحذف استوديو الفحص ({type(exc).__name__}): احذفيه يدوياً من لوحة Lightning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
