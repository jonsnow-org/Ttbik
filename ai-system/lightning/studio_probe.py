"""
Can GitHub start the owner's FREE Lightning AI Studio and run a command in it? (answer measured, nothing assumed)

Prints, without any secret: the Studio's status, then — after starting it on the free CPU machine if it was stopped — the cores, memory,
disk and Python of the machine, and whether it could be stopped again. Credentials: LIGHTNING_USER_ID + LIGHTNING_API_KEY from the environment
(GitHub secrets). Teamspace/Studio names are optional env settings (SHAM_LIGHTNING_STUDIO, SHAM_LIGHTNING_TEAMSPACE).

    python studio_probe.py        needs the SDK and the two secrets; without them it only says so (exit 0)
"""
from __future__ import annotations

import os
import sys


def say(msg: str) -> None:
    print(msg, flush=True)


def main() -> int:
    if not (os.environ.get("LIGHTNING_USER_ID") and os.environ.get("LIGHTNING_API_KEY")):
        say("لا مفاتيح Lightning في البيئة — لا فحص")
        return 0
    try:
        from lightning_sdk import Machine, Studio
    except Exception as exc:
        say(f"مكتبة lightning_sdk غير متاحة: {type(exc).__name__}")
        return 0
    name = os.environ.get("SHAM_LIGHTNING_STUDIO", "fantastic-bronze-a104f")
    try:        # the SDK needs the teamspace: ask the account which ones it has (names are not secrets)
        from lightning_sdk import User
        spaces = list(User().teamspaces)
        say("مساحات الفريق في الحساب: " + ", ".join(str(getattr(s, "name", s)) for s in spaces))
        studio = None
        for sp in spaces:
            found = [s for s in sp.studios]
            say(f"  • {getattr(sp, 'name', sp)}: استوديوهات = " + ", ".join(str(getattr(s, 'name', s)) for s in found))
            for s in found:
                if str(getattr(s, "name", "")) == name or (studio is None and not os.environ.get("SHAM_LIGHTNING_STUDIO")):
                    studio = s
        if studio is None:
            say(f"لا استوديو باسم «{name}» ولا غيره")
            return 0
    except Exception as exc:
        say(f"تعذّر سرد مساحات الفريق: {type(exc).__name__}: {str(exc)[:200]}")
        return 0
    started_here = False
    try:
        status = str(getattr(studio, "status", "?"))
        say(f"حالة الاستوديو: {status} | نوم تلقائي: {getattr(studio, 'auto_sleep', '?')} بعد {getattr(studio, 'auto_sleep_time', '?')}")
        if "running" not in status.lower():
            say("يُشغَّل على معالج مجاني (CPU)…")
            studio.start(Machine.CPU)
            started_here = True
        say(f"بعد التشغيل: {getattr(studio, 'status', '?')} | الآلة: {getattr(studio, 'machine', '?')}")
        out = studio.run("nproc; free -g | head -2; df -h / | tail -1; python3 --version; echo صدى-من-الاستوديو")
        say("ناتج الأمر داخل الاستوديو:\n" + str(out)[:600])
    except Exception as exc:
        say(f"فشل أثناء التشغيل أو الأمر: {type(exc).__name__}: {str(exc)[:240]}")
    finally:
        if started_here:
            try:
                studio.stop()
                say("أُوقف الاستوديو بعد الفحص")
            except Exception as exc:
                say(f"تعذّر إيقافه: {type(exc).__name__}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
