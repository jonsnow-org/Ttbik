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

from lightning_access import patch_whoami, why


def say(msg: str) -> None:
    print(msg, flush=True)


def main() -> int:
    if not ((os.environ.get("LIGHTNING_USER_ID") and os.environ.get("LIGHTNING_API_KEY")) or os.environ.get("LIGHTNING_AUTH_TOKEN")):
        say("لا مفاتيح Lightning في البيئة — لا فحص")
        return 0
    try:
        from lightning_sdk import Machine, Studio
    except Exception as exc:
        say(f"مكتبة lightning_sdk غير متاحة: {type(exc).__name__}")
        return 0
    name = os.environ.get("SHAM_LIGHTNING_STUDIO", "fantastic-bronze-a104f")
    # live 2026-11-11 (fresh `lightning login` token): the SDK's whoami endpoint answers 403 (an HTML page) for this token, so
    # User().teamspaces / Teamspace.studios die with "Neither name is provided…"; and the account's teamspace belongs to the
    # ORG (jonsnowx1r-lab-org), not the user. Fall back to LIGHTNING_USER_ID for whoami and find the teamspace by membership.
    patch_whoami()
    try:
        from lightning_sdk import Teamspace
        from lightning_sdk.api.teamspace_api import TeamspaceApi
        api = TeamspaceApi()
        client = api._client
        mem = client.projects_service_list_memberships().memberships or []
        say("عضوية مساحات الفريق: " + ", ".join(str(m.name) for m in mem))
        studio = None
        want_ts = os.environ.get("SHAM_LIGHTNING_TEAMSPACE", "")
        for m in mem:
            if want_ts and m.name != want_ts:
                continue
            spaces = client.cloud_space_service_list_cloud_spaces(project_id=m.project_id).cloudspaces or []
            say(f"  • {m.name}: استوديوهات = " + ", ".join(str(c.name) for c in spaces))
            hit = [c for c in spaces if c.name == name] or ([] if os.environ.get("SHAM_LIGHTNING_STUDIO") else spaces[:1])
            if hit and studio is None:
                proj = client.projects_service_get_project(m.project_id)
                owner = getattr(proj, "owner_type", "")
                org_name = None
                for o in (client.organizations_service_list_organizations().organizations or []):
                    if getattr(o, "id", None) == getattr(proj, "owner_id", None):
                        org_name = o.name
                ts = Teamspace(name=f"{org_name}/{m.name}") if org_name else Teamspace(name=m.name)
                studio = Studio(name=hit[0].name, teamspace=ts)
                say(f"الاستوديو: {hit[0].name} في {ts.owner.name}/{m.name} ({owner})")
        if studio is None:
            say(f"لا استوديو باسم «{name}» ولا غيره")
            return 0
    except Exception as exc:
        say(f"تعذّر الوصول إلى الاستوديو: {type(exc).__name__}: {why(exc)}")
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
        net = studio.run(
            "for u in https://huggingface.co https://www.kaggle.com https://api.kaggle.com https://github.com https://pypi.org "
            "https://hf-mirror.com https://www.modelscope.cn https://api.telegram.org; do printf '%s ' $u; "
            "curl -s -o /dev/null -m 8 -w '%{http_code}\\n' $u; done; python3 -m pip --version 2>&1 | head -1; "
            "ls /usr/bin/python3* 2>/dev/null | head -5; python3 -c 'import torch;print(\"torch\",torch.__version__)' 2>&1 | tail -1")
        say("الشبكة والأدوات داخل الاستوديو:\n" + str(net)[:900])
    except Exception as exc:
        say(f"فشل أثناء التشغيل أو الأمر: {type(exc).__name__}: {why(exc)}")
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
