"""
Sham's jobs on the owner's FREE Lightning AI Studio (4 CPU cores, 15 GB RAM, 360 GB disk, internet), driven from GitHub.

A free Studio sleeps after 10 minutes without activity and is stopped every 4 hours, so GitHub is the supervisor: it starts the Studio, prepares
the code, launches the job detached, and polls it every 5 minutes (each poll is activity). If the Studio stopped meanwhile, the next poll
starts it again and relaunches the job.

  python studio_job.py diag      start, fetch code + libraries, print what the Studio has (no job)
  python studio_job.py measure   the media factory's one-small-cycle throughput test (publishes nothing)
  python studio_job.py tokens    collect + TRAIN the image/audio tokenizers (full design, resolution curriculum) on the Studio's 4 CPU cores (no GPU), publish  <- main job
  python studio_job.py media     the media factory (collect + pack tokenizer training data, publish as Kaggle datasets)  <- the main job
  python studio_job.py run       Sham's live text trainer (sham_live): crawls, tokenizes and trains text on the 4 CPU cores, publishes sham-crawl-lightning
  python studio_job.py auto      the scheduled mode: each 4-hour window picks tokens (2 windows of 3) or run (1 of 3), so one Studio serves both

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
    # end-anchored: a bare "sham_live" also matches the very shell that is asking (its own command line contains the word), so the job always looked alive
    "run": (r"sham_live\.run.*workers=4\)\)$", "cd {home}/Ttbik/ai-system/colab/sham_small && python -c \"import sham_live; print(sham_live.run(hours={h}, "
                         "name='lightning', source_set='gh', video=False, workers=4))\"", "~/sham_job.log"),
}


def auto_mode(now: float | None = None) -> str:
    """The scheduled run's job: one free Studio, two jobs, alternating 4-hour windows: the live model trainer (the model has priority: owner, 2026-10-13)
    and the tokenizer training (both resume from their own last published state, so a window's work is never lost)."""
    slot = int((time.time() if now is None else now) // (4 * 3600))
    return "run" if slot % 2 == 0 else "tokens"


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


GPU_MODES = {"run", "tokens"}                  # the important jobs: try a GPU first, fall back to the free CPU (owner, 2026-10-12)
GPU_NAMES = ("T4", "L4")                      # cheapest first
GPU_MAX_SECONDS = int(os.environ.get("SHAM_GPU_MAX_SECONDS", str(4 * 3600 + 900)))   # never hold a GPU machine longer than one window


def has_gpu(studio) -> bool:
    try:
        return "GPU" in str(studio.run("nvidia-smi -L 2>&1 | head -1"))
    except Exception:
        return False


def try_gpu(studio, machine) -> str | None:
    """Asks Lightning for a GPU machine (interruptible = the cheapest). Works only if the account has GPU credit and there is capacity: otherwise
    Lightning refuses and we return None — nothing is assumed about the account, the answer is measured here every window.
    SHAM_LIGHTNING_GPU=0 switches this off."""
    if os.environ.get("SHAM_LIGHTNING_GPU") == "0":
        return None
    for name in GPU_NAMES:
        m = getattr(machine, name, None)
        if m is None:
            continue
        try:
            if "running" in str(getattr(studio, "status", "")).lower():
                studio.switch_machine(m, interruptible=True)              # blocks until the new machine is up
            else:
                studio.start(m, interruptible=True, max_runtime=GPU_MAX_SECONDS)
        except Exception as exc:
            say(f"GPU {name} غير متاح: {type(exc).__name__}: {str(exc)[:140]}")
            continue
        if has_gpu(studio):
            return name
        say(f"GPU {name}: بدأت الآلة ولا يظهر عتاد GPU")
    return None


def bring_up(studio, machine, mode: str) -> str:
    """Starts the Studio on a GPU when the job is an important one and one is available, else on the free CPU. Returns "GPU <name>" or "CPU"."""
    if mode in GPU_MODES:
        got = try_gpu(studio, machine)
        if got:
            return f"GPU {got}"
        say("لا GPU متاح الآن — يكمل على المعالج المجاني")
    ensure_running(studio, machine)
    return "CPU"


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
        "pkill -f 'media_factory.py --measure' 2>/dev/null; "
        # a job still running OLD code (before this prepare fetched new code) must not block the new one: end it, the launcher restarts it fresh
        "pkill -f 'tokenizer_job.py$' 2>/dev/null; echo prepared; ls -ld /kaggle/working 2>&1 | cut -c1-60"))


def diag(studio) -> None:
    write_secrets(studio)
    say("تحضير:\n" + prepare(studio)[-500:])
    say(str(studio.run("python -c \"import torch,tokenizers;print('torch',torch.__version__,'tokenizers',tokenizers.__version__)\" 2>&1 | tail -1; "
                       "nproc; free -g | head -2; df -h ~ | tail -1; sudo -n true 2>&1 | head -1; echo sudo-exit=$?")))


def start_job(studio, name: str) -> None:
    proc, cmd, log = JOBS[name]
    inner = cmd.format(home=HOME_DIR, h=JOB_HOURS)
    # the four cores serve ONE job at a time: end any other job of ours that is still running (a window of the other mode that outlived its hold)
    others = "; ".join(f"pkill -f {shlex.quote(p)} 2>/dev/null" for n, (p, _c, _l) in JOBS.items() if n != name and n != "measure")
    full = (f"{others}; test -f ~/.sham_env && . ~/.sham_env; (pgrep -f {shlex.quote(proc)} >/dev/null && echo already-running || "
            f"(nohup nice -n 5 bash -c {shlex.quote(inner)} > {log} 2>&1 & echo started))")
    say("المهمة: " + str(studio.run(full)).strip())


def poll(studio, name: str) -> str:
    proc, _cmd, log = JOBS[name]
    return str(studio.run(f"pgrep -f {shlex.quote(proc)} >/dev/null && echo حيّة || echo متوقفة; tail -n 3 {log} 2>/dev/null | cut -c1-300"))


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "diag"
    if mode == "auto":
        mode = auto_mode()
        say(f"الوضع التلقائي لهذه النافذة: {mode}")
    if not (os.environ.get("LIGHTNING_USER_ID") and os.environ.get("LIGHTNING_API_KEY")):
        say("لا مفاتيح Lightning — لا عمل")
        return 0
    try:
        studio, machine = open_studio()
        if mode == "peek":                                   # read-only look at a running job: never starts, stops or restarts anything
            say(str(getattr(studio, "status", "?")))
            say(str(studio.run("tail -n 30 ~/tokens.log 2>/dev/null | cut -c1-300; echo ---; tail -n 10 ~/factory.log 2>/dev/null | cut -c1-200; echo ---; ls ~/sham_factory 2>/dev/null | head; "
                               "du -sh ~/sham_factory 2>/dev/null; pgrep -af 'media_factory|tokenizer_job' | cut -c1-120 | head -3; free -g | head -2")))
            return 0
        if mode == "stopfactory":                            # the 4 cores belong to the tokenizer trainer: end a leftover media factory, touch nothing else
            say(str(studio.run("pkill -f 'media_factory.py' 2>/dev/null; sleep 2; pgrep -af 'media_factory|tokenizer_job' | cut -c1-100")))
            return 0
        hardware = bring_up(studio, machine, mode)
        say(f"حالة الاستوديو: {getattr(studio, 'status', '?')} | العتاد: {hardware}")
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
                if "running" not in str(getattr(studio, "status", "")).lower():     # the Studio was stopped under us (or an interruptible GPU was taken back)
                    hardware = bring_up(studio, machine, mode)
                    say(f"العتاد بعد التوقف: {hardware}")
                    write_secrets(studio)
                    say("إعادة تحضير بعد توقف الاستوديو:\n" + prepare(studio)[-200:])
                    start_job(studio, mode)
                status = poll(studio, mode)
                say(time.strftime("%H:%M ") + status)
                if status.startswith("متوقفة") and time.time() < end - 600:
                    start_job(studio, mode)                     # the job ended early (cycle over or crashed): relaunch it
            except Exception as exc:
                say(f"فشل الفحص: {type(exc).__name__}: {str(exc)[:120]}")
        if hardware.startswith("GPU"):                  # the window is over: do not leave a GPU machine running idle (it would keep spending the credit)
            try:
                studio.stop()
                say("أُوقف الاستوديو (آلة GPU) بعد انتهاء النافذة")
            except Exception as exc:
                say(f"تعذّر إيقاف آلة GPU: {type(exc).__name__}: {str(exc)[:100]}")
    except Exception as exc:
        say(f"تعذّر العمل: {type(exc).__name__}: {str(exc)[:240]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
