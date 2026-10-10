"""
Sham's job on the owner's FREE Lightning AI Studio (4 CPU cores, 15 GB RAM, internet, torch preinstalled), driven from GitHub.

A free Studio sleeps after 10 minutes without activity and must be restarted every 4 hours, so GitHub is the supervisor:

  python studio_job.py diag   start the Studio, fetch the code and libraries, test public network reachability (no secrets are sent to the Studio)
  python studio_job.py run    start it, (re)start the job in the background, stay up to HOLD_MINUTES polling every 5 minutes (each poll is activity)

Only LIGHTNING_USER_ID / LIGHTNING_API_KEY are used (to reach the Studio). No Kaggle/HF token is copied into the Studio unless the owner
explicitly approves it and sets SHAM_STUDIO_SECRETS=1. Teamspace/Studio names: SHAM_LIGHTNING_USER / _TEAMSPACE / _STUDIO.
"""
from __future__ import annotations

import os
import shlex
import sys
import time

USER = os.environ.get("SHAM_LIGHTNING_USER", "jonsnowx1r-lab")
TEAMSPACE = os.environ.get("SHAM_LIGHTNING_TEAMSPACE", "document-intelligence-upgrade-project")
STUDIO = os.environ.get("SHAM_LIGHTNING_STUDIO", "fantastic-bronze-a104f")
REPO = "https://github.com/jonsnow-org/Ttbik.git"
BRANCH = "sham-main"
HOME_DIR = "~/sham"
HOLD_MINUTES = int(os.environ.get("SHAM_HOLD_MINUTES", "215"))
JOB_HOURS = float(os.environ.get("SHAM_JOB_HOURS", "3.3"))
WITH_SECRETS = os.environ.get("SHAM_STUDIO_SECRETS") == "1"      # off unless the owner approves it in so many words


def say(msg: str) -> None:
    print(msg, flush=True)


def open_studio():
    from lightning_sdk import Machine, Studio, Teamspace, User
    studio = Studio(name=STUDIO, teamspace=Teamspace(name=TEAMSPACE, user=User(name=USER)))
    if "running" not in str(getattr(studio, "status", "")).lower():
        say("يُشغَّل الاستوديو المجاني (CPU)…")
        studio.start(Machine.CPU)
    say(f"حالة الاستوديو: {getattr(studio, 'status', '?')}")
    return studio


def write_secrets(studio) -> None:
    if not WITH_SECRETS:
        return
    lines = [f"export {k}={shlex.quote(os.environ[k])}" for k in ("KAGGLE_USERNAME", "KAGGLE_API_TOKEN", "HF_TOKEN") if os.environ.get(k)]
    if lines:
        studio.run("umask 077; printf '%s\\n' " + " ".join(shlex.quote(x) for x in lines) + " > ~/.sham_env; echo secrets-ok")


def prepare(studio) -> str:
    return str(studio.run(
        f"mkdir -p {HOME_DIR} && cd {HOME_DIR} && "
        f"(test -d Ttbik/.git && git -C Ttbik fetch -q --depth 1 origin {BRANCH} && git -C Ttbik reset -q --hard FETCH_HEAD "
        f"|| git clone -q --depth 1 --branch {BRANCH} {REPO} Ttbik) && "
        "python -m pip install -q --disable-pip-version-check tokenizers numpy requests kaggle datasets pillow soundfile beautifulsoup4 2>&1 | tail -2; echo prepared"))


def diag(studio) -> None:
    write_secrets(studio)
    say("تحضير:\n" + prepare(studio)[-400:])
    say(str(studio.run("python -c \"import torch,tokenizers;print('torch',torch.__version__,'tokenizers',tokenizers.__version__)\" 2>&1 | tail -1; "
                       "ls ~/sham/Ttbik/ai-system/colab/sham_small | head -3")))


def start_job(studio) -> None:
    cmd = (f"test -f ~/.sham_env && . ~/.sham_env; cd {HOME_DIR}/Ttbik/ai-system/colab/sham_small && "
           "(pgrep -f 'sham_live' >/dev/null && echo already-running || (nohup nice -n 5 python -c \"import sham_live; print(sham_live.run(hours="
           f"{JOB_HOURS}, name='lightning', source_set='gh', video=False, workers=4))\" > ~/sham_job.log 2>&1 & echo started))")
    say("المهمة: " + str(studio.run(cmd)).strip())


def poll(studio) -> str:
    return str(studio.run("pgrep -f sham_live >/dev/null && echo حيّة || echo متوقفة; tail -n 4 ~/sham_job.log 2>/dev/null | cut -c1-300"))


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "diag"
    if not (os.environ.get("LIGHTNING_USER_ID") and os.environ.get("LIGHTNING_API_KEY")):
        say("لا مفاتيح Lightning — لا عمل")
        return 0
    try:
        studio = open_studio()
        if mode == "diag":
            diag(studio)
            return 0
        write_secrets(studio)
        say("تحضير:\n" + prepare(studio)[-300:])
        start_job(studio)
        end = time.time() + HOLD_MINUTES * 60
        while time.time() < end:
            time.sleep(300)
            try:
                say(time.strftime("%H:%M ") + poll(studio))
            except Exception as exc:
                say(f"فشل الفحص: {type(exc).__name__}")
    except Exception as exc:
        say(f"تعذّر العمل: {type(exc).__name__}: {str(exc)[:240]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
