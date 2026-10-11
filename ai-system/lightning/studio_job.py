"""
Sham's jobs on the owner's FREE Lightning AI Studio (4 CPU cores, 15 GB RAM, 360 GB disk, internet), driven from GitHub.

A free Studio sleeps after 10 minutes without activity and is stopped every 4 hours, so GitHub is the supervisor: it starts the Studio, prepares
the code, launches the job detached, and polls it every 5 minutes (each poll is activity). If the Studio stopped meanwhile, the next poll
starts it again and relaunches the job.

  python studio_job.py diag      start, fetch code + libraries, print what the Studio has (no job)
  python studio_job.py measure   the media factory's one-small-cycle throughput test (publishes nothing)
  python studio_job.py tokens    collect + TRAIN the image/audio tokenizers on the Studio's 4 CPU cores (no GPU), publish v2 checkpoints  <- main job
  python studio_job.py media     the media factory (collect + pack tokenizer training data, publish as Kaggle datasets)  <- the main job
  python studio_job.py run       Sham's live text trainer (sham_live)

The Kaggle/HF keys are written to a private file inside the owner's own Studio only with her explicit approval (2026-10-11) and never printed.
Names: SHAM_LIGHTNING_USER / _TEAMSPACE / _STUDIO.
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
WITH_SECRETS = os.environ.get("SHAM_STUDIO_SECRETS") == "1"

JOBS = {
    "measure": ("media_factory.py --measure", "cd {home}/Ttbik/ai-system/lightning && python -u media_factory.py --measure", "~/factory_measure.log"),
    "media": ("media_factory.py$", "cd {home}/Ttbik/ai-system/lightning && SHAM_FACTORY_HOURS={h} python media_factory.py", "~/factory.log"),
    "tokens": ("tokenizer_job.py$", "cd {home}/Ttbik/ai-system/lightning && SHAM_TOK_HOURS={h} python tokenizer_job.py", "~/tokens.log"),
    "run": ("sham_live", "cd {home}/Ttbik/ai-system/colab/sham_small && python -c \"import sham_live; print(sham_live.run(hours={h}, "
                         "name='lightning', source_set='gh', video=False, workers=4))\"", "~/sham_job.log"),
}


def say(msg: str) -> None:
    print(msg, flush=True)


def open_studio():
    from lightning_sdk import Machine, Studio, Teamspace, User
    studio = Studio(name=STUDIO, teamspace=Teamspace(name=TEAMSPACE, user=User(name=USER)))
    return studio, Machine


def ensure_running(studio, machine) -> bool:
    """Starts the Studio if it is not running. True when it had to be (re)started."""
    if "running" in str(getattr(studio, "status", "")).lower():
        return False
    say("يُشغَّل الاستوديو المجاني (CPU)…")
    studio.start(machine.CPU)
    return True


def write_secrets(studio) -> None:
    if not WITH_SECRETS:
        return
    lines = [f"export {k}={shlex.quote(os.environ[k])}" for k in ("KAGGLE_USERNAME", "KAGGLE_API_TOKEN", "HF_TOKEN") if os.environ.get(k)]
    if lines:
        studio.run("umask 077; mkdir -p ~/.kaggle; printf '%s\\n' " + " ".join(shlex.quote(x) for x in lines) + " > ~/.sham_env; echo secrets-ok")


def prepare(studio) -> str:
    return str(studio.run(
        f"mkdir -p {HOME_DIR} && cd {HOME_DIR} && "
        f"(test -d Ttbik/.git && git -C Ttbik fetch -q --depth 1 origin {BRANCH} && git -C Ttbik reset -q --hard FETCH_HEAD "
        f"|| git clone -q --depth 1 --branch {BRANCH} {REPO} Ttbik) && "
        # the notebooks' code writes under /kaggle/working: give this Studio user that folder (sudo is available there), else fall back to HOME
        "(sudo -n mkdir -p /kaggle/working /kaggle/input && sudo -n chown -R $(id -u):$(id -g) /kaggle 2>/dev/null || true) && "
        "python -m pip install -q --disable-pip-version-check tokenizers numpy requests kaggle datasets pillow soundfile imageio-ffmpeg "
        "beautifulsoup4 av 2>&1 | tail -2; "
        # a --measure run that never exited (HF threads) must not be mistaken for the factory: end any such leftover
        "pkill -f 'media_factory.py --measure' 2>/dev/null; echo prepared; ls -ld /kaggle/working 2>&1 | cut -c1-60"))


def diag(studio) -> None:
    write_secrets(studio)
    say("تحضير:\n" + prepare(studio)[-500:])
    say(str(studio.run("python -c \"import torch,tokenizers;print('torch',torch.__version__,'tokenizers',tokenizers.__version__)\" 2>&1 | tail -1; "
                       "nproc; free -g | head -2; df -h ~ | tail -1; sudo -n true 2>&1 | head -1; echo sudo-exit=$?")))


def start_job(studio, name: str) -> None:
    proc, cmd, log = JOBS[name]
    inner = cmd.format(home=HOME_DIR, h=JOB_HOURS)
    full = (f"test -f ~/.sham_env && . ~/.sham_env; (pgrep -f {shlex.quote(proc)} >/dev/null && echo already-running || "
            f"(nohup nice -n 5 bash -c {shlex.quote(inner)} > {log} 2>&1 & echo started))")
    say("المهمة: " + str(studio.run(full)).strip())


def poll(studio, name: str) -> str:
    proc, _cmd, log = JOBS[name]
    return str(studio.run(f"pgrep -f {shlex.quote(proc)} >/dev/null && echo حيّة || echo متوقفة; tail -n 3 {log} 2>/dev/null | cut -c1-300"))


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "diag"
    if not (os.environ.get("LIGHTNING_USER_ID") and os.environ.get("LIGHTNING_API_KEY")):
        say("لا مفاتيح Lightning — لا عمل")
        return 0
    try:
        studio, machine = open_studio()
        if mode == "peek":                                   # read-only look at a running job: never starts, stops or restarts anything
            say(str(getattr(studio, "status", "?")))
            say(str(studio.run("tail -n 45 ~/factory.log 2>/dev/null | cut -c1-300; echo ---; ls ~/sham_factory 2>/dev/null | head; "
                               "du -sh ~/sham_factory 2>/dev/null; pgrep -af media_factory | cut -c1-120 | head -3; free -g | head -2")))
            return 0
        ensure_running(studio, machine)
        say(f"حالة الاستوديو: {getattr(studio, 'status', '?')}")
        if mode == "diag":
            diag(studio)
            return 0
        write_secrets(studio)
        say("تحضير:\n" + prepare(studio)[-400:])
        if mode == "measure":                                    # a short run with live progress: polled every 2 minutes for at most 40
            studio.run("rm -f ~/factory_measure.log")
            start_job(studio, "measure")
            for _ in range(20):
                time.sleep(120)
                status = poll(studio, "measure")
                say(time.strftime("%H:%M ") + status)
                if status.startswith("متوقفة"):
                    break
            say(str(studio.run("tail -n 40 ~/factory_measure.log 2>/dev/null | cut -c1-400")))
            return 0
        start_job(studio, mode)
        end = time.time() + HOLD_MINUTES * 60
        while time.time() < end:
            time.sleep(300)
            try:
                if ensure_running(studio, machine):             # the Studio was stopped under us: bring everything back
                    write_secrets(studio)
                    say("إعادة تحضير بعد توقف الاستوديو:\n" + prepare(studio)[-200:])
                    start_job(studio, mode)
                status = poll(studio, mode)
                say(time.strftime("%H:%M ") + status)
                if status.startswith("متوقفة") and time.time() < end - 600:
                    start_job(studio, mode)                     # the job ended early (cycle over or crashed): relaunch it
            except Exception as exc:
                say(f"فشل الفحص: {type(exc).__name__}: {str(exc)[:120]}")
    except Exception as exc:
        say(f"تعذّر العمل: {type(exc).__name__}: {str(exc)[:240]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
