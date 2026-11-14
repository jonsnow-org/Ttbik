"""Sham's live CPU/GPU trainer as a free ModelScope Studio (a Gradio app whose background thread trains, publishes, and starts again).

Same job as the GitHub CPU trainer and the Oracle one: sham_live.run(...) starts from the newest published head, trains for SHAM_TRAINER_HOURS, publishes ITS OWN lineage
(sham-crawl-<SHAM_TRAINER_NAME> + its corpus) to Kaggle; the merge job finds every sham-crawl-* dataset by itself and judges it through the same gate, so nothing else changes.
Device: sham_live picks CUDA when the Studio has a GPU and CPU otherwise (the free tier is CPU), so the same file serves both.

Settings come from the Studio's secrets (set by deploy-sham-trainer-studio.yml): KAGGLE_USERNAME, KAGGLE_API_TOKEN, SHAM_TRAINER_NAME, SHAM_TRAINER_HOURS, SHAM_TRAINER_JOB (live|images|audio|chat|tools|text|codec|motion), HF_ENDPOINT (hf-mirror: huggingface.co is
blocked from China). Nothing here prints a secret. Offline self-test: python app.py --selftest
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import traceback
from pathlib import Path

# The Studio's container has 8 GB of memory and the root file system counts against it (2026-11-13 memory watch: process 4.0 GB, container 7.1 GB, then killed with -9 right after the chat data
# loaded). The persistent disk /mnt/workspace does not: downloads (the 850 MB head), the Hugging Face dataset cache and temp files go there when it exists. Inherited by the cycle process.
_DISK = Path("/mnt/workspace")
if _DISK.is_dir() and os.access(_DISK, os.W_OK):
    for _k, _sub in (("SHAM_LIVE_WORK", "live_work"), ("SHAM_FETCH_ROOT", "inputs"), ("HF_HOME", "hf"), ("HF_DATASETS_CACHE", "hf/datasets"), ("TMPDIR", "tmp")):
        _p = _DISK / "sham_trainer" / _sub
        try:
            _p.mkdir(parents=True, exist_ok=True)
            os.environ.setdefault(_k, str(_p))
        except OSError:
            pass

HERE = Path(__file__).resolve().parent
SHAM = HERE / "sham_small"                      # the sham_small code the deploy workflow copies next to this file
WORK = Path(os.environ.get("SHAM_LIVE_WORK") or (Path.home() / "sham_live_work"))
STATE: dict = {"phase": "starting", "cycle": 0, "device": "?", "started": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "last": {}, "error": ""}
_LOCK = threading.Lock()


# What each Studio is FOR (SHAM_TRAINER_JOB). Chosen from the 2026-11-11 structure review of Sham v1: the picture generator writes only ~28 distinct codes of 256 (loss 7.70, the codec itself is fine at 20 dB),
# chat/tool skills sit at a plateau behind the merge gate (text 4.62 / chat 2.01 / media 7.25), audio has little training share. Each profile is only a set of environment shares for sham_live:
# nothing but WHAT is collected and mixed changes; the guard, the held-out measures and the merge gate stay the same.
PROFILES = {
    "live":   {},                                                                                                                # the general mix (same as the GitHub / Oracle trainers)
    "images": {"SHAM_LIVE_KINDS": "image", "SHAM_REHEARSAL_SHARE": "0.25", "SHAM_GENERAL_SHARE": "0.30", "SHAM_TOOLS_MIX": "0.02"},   # caption -> picture codes, text kept alive by rehearsal + general windows
    "audio":  {"SHAM_LIVE_KINDS": "audio", "SHAM_REHEARSAL_SHARE": "0.25", "SHAM_GENERAL_SHARE": "0.30", "SHAM_TOOLS_MIX": "0.02"},
    "chat":   {"SHAM_LIVE_KINDS": "text", "SHAM_REHEARSAL_SHARE": "0.45", "SHAM_GENERAL_SHARE": "0.25", "SHAM_TOOLS_MIX": "0.08", "SHAM_CHAT_MULTITURN": "1"},     # dialogue + memory
    "tools":  {"SHAM_LIVE_KINDS": "text", "SHAM_REHEARSAL_SHARE": "0.30", "SHAM_GENERAL_SHARE": "0.25", "SHAM_TOOLS_MIX": "0.40"},                                # the 44 tools and their paths
    "text":   {"SHAM_LIVE_KINDS": "text", "SHAM_REHEARSAL_SHARE": "0.20", "SHAM_GENERAL_SHARE": "0.55", "SHAM_TOOLS_MIX": "0.03"},                                # general text and code (the plateau)
    # the picture codec itself (not the language model): a NEW high-resolution lineage, 384 px = 24x24 = 576 tokens, published as sham-image-tokenizer-hd-checkpoint. The serving tokenizer is never touched.
    # Measured (sham_vq_bench): a 2-thread CPU trains ~1,150 pictures/hour at 256 px, so this is a slow trickle here; the bulk of an HD codec needs a GPU (Kaggle's weekly quota).
    "codec":  {"SHAM_IMG_SIZE": "384", "SHAM_TOK_AUDIO": "0", "SHAM_TOK_THREADS": "2"},
    # the motion codec: real clips -> consecutive frame pairs -> a motion tokenizer that beats "copy the previous frame"; published as sham-motion-tokenizer-checkpoint (resumes the newest one)
    "motion": {"SHAM_TOK_THREADS": "2"},
}


def run_codec(hours: float = 5.0, **_ignored) -> dict:
    """The "codec" job: ai-system/lightning/tokenizer_job.py (collect pictures, train the image tokenizer in chunks, publish) for `hours`. Returns whitelisted numbers."""
    for sub in ("lightning", "sham_small"):
        sys.path.insert(0, str(HERE / sub))
    os.environ.setdefault("SHAM_FACTORY_DIR", str(WORK / "factory"))
    import tokenizer_job
    tokenizer_job.HOURS = float(hours)
    code = tokenizer_job.main()
    prog = tokenizer_job._progress("image")
    return {"steps": int(prog.get("steps", 0)), "published": code == 0, "corpus": int(prog.get("samples", 0)), "hours": float(hours)}


def run_motion(hours: float = 3.0, **_ignored) -> dict:
    """The "motion" job: ai-system/lightning/motion_job.py for `hours`."""
    for sub in ("lightning", "sham_small"):
        sys.path.insert(0, str(HERE / sub))
    os.environ.setdefault("SHAM_FACTORY_DIR", str(WORK / "factory"))
    import motion_job
    motion_job.HOURS = float(hours)
    code = motion_job.main()
    return {"published": code == 0, "hours": float(hours)}


def settings(env=None) -> dict:
    env = os.environ if env is None else env
    name = re.sub(r"[^a-z0-9]+", "-", (env.get("SHAM_TRAINER_NAME") or "ms1").lower()).strip("-") or "ms1"
    try:
        hours = min(10.0, max(0.5, float(env.get("SHAM_TRAINER_HOURS") or 5.0)))
    except ValueError:
        hours = 5.0
    try:
        workers = min(16, max(1, int(env.get("SHAM_TRAINER_WORKERS") or 2)))
    except ValueError:
        workers = 2
    job = (env.get("SHAM_TRAINER_JOB") or "live").strip().lower()
    job = job if job in PROFILES else "live"
    return {"name": name, "hours": hours, "workers": workers, "source_set": env.get("SHAM_TRAINER_SOURCES") or "gh", "job": job}


# What the trainer printed lately, for the status page: the trainers on cn sat in "training" for 16 hours with an empty `last`, and nothing said where. Secrets are never kept:
# a line that mentions a token / key / secret / authorization is dropped, long lines are cut. Only the last TAIL_LINES lines, plus when the last line arrived.
TAIL_LINES = 40
_SECRET_LINE = re.compile(r"token|secret|password|authorization|api[_-]?key|bearer|kaggle_key", re.I)
_TAIL: list = []
_LAST_LINE_AT = [0.0]


class _Tee:
    def __init__(self, stream):
        self.stream, self.pending = stream, ""

    def write(self, text):
        try:
            self.stream.write(text)
        except Exception:  # noqa: BLE001
            pass
        self.pending += str(text)
        while "\n" in self.pending:
            line, self.pending = self.pending.split("\n", 1)
            line = line.strip()
            if line and not _SECRET_LINE.search(line):
                with _LOCK:
                    _TAIL.append(line[:220])
                    del _TAIL[:-TAIL_LINES]
                    _LAST_LINE_AT[0] = time.time()
        return len(text)

    def flush(self):
        try:
            self.stream.flush()
        except Exception:  # noqa: BLE001
            pass

    def __getattr__(self, name):
        return getattr(self.stream, name)


def _set(**kw) -> None:
    with _LOCK:
        STATE.update(kw)


def _short(res) -> dict:
    """Whitelisted numbers only: never a token, never a text."""
    keep = ("steps", "published", "corpus", "guard_score", "rollbacks", "device", "hours")
    return {k: res[k] for k in keep if isinstance(res, dict) and k in res and isinstance(res[k], (int, float, bool, str)) and len(str(res[k])) <= 80}


RESULT_MARK = "@@CYCLE_RESULT@@ "


def _resolve_run_fn(cfg: dict):
    for k, v in PROFILES[cfg["job"]].items():          # the job's shares, before sham_live is imported (it reads some of them at import time)
        os.environ.setdefault(k, v)
    # The search for a "better media tokenizer" downloads and measures every tokenizer dataset of the account: on this Studio's slow link it sat for hours with no output
    # (cn sham-trainer-1, 2026-11-13). The head adopted the best one once (2026-10-17); a trainer keeps the tokenizer that sits next to its start checkpoint.
    os.environ.setdefault("SHAM_MEDIA_TOKENIZER", "base")
    if cfg["job"] == "codec":
        return run_codec
    if cfg["job"] == "motion":
        return run_motion
    sys.path.insert(0, str(SHAM))
    import sham_live
    return sham_live.run


def child_cycle() -> None:
    """One cycle in its OWN process (python app.py --cycle): an out-of-memory kill or a hang here can no longer take the Studio's web page down (502) or freeze the status forever."""
    cfg = settings()
    WORK.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("SHAM_LIVE_WORK", str(WORK))
    run_fn = _resolve_run_fn(cfg)
    res = run_fn(hours=cfg["hours"], name=cfg["name"], source_set=cfg["source_set"], video=False, workers=cfg["workers"])
    print(RESULT_MARK + json.dumps(_short(res)), flush=True)


LEFTOVER_FILES = ("final.pt", "sham_small_tokenizer.json", "image_tokenizer.pt", "audio_tokenizer.pt", "motion_tokenizer.pt")


def child_publish_leftover() -> None:
    """Publish the previous cycle's best weights when they never reached the merge (2026-11-14: the cn trainer finished a cycle 11% better than its start point, but
    uploads to Kaggle from cn failed, so no dataset `sham-crawl-ms1` existed). The private ModelScope model repo is the door that works from here. A marker file
    remembers what was published, so a restart does not push the same file twice."""
    ck = WORK / "checkpoints"
    final = ck / "final.pt"
    marker = ck / ".published_to_modelscope"
    if not final.exists():
        print("leftover: no previous weights on this Studio's disk", flush=True)
        return
    if marker.exists() and marker.stat().st_mtime >= final.stat().st_mtime:
        print("leftover: the previous weights were already published", flush=True)
        return
    sys.path.insert(0, str(SHAM))
    import shutil

    import sham_inputs
    snap = WORK / "leftover_publish"
    shutil.rmtree(snap, ignore_errors=True)
    snap.mkdir(parents=True)
    for name in LEFTOVER_FILES:
        if (ck / name).exists():
            try:
                os.link(ck / name, snap / name)
            except OSError:
                shutil.copy2(ck / name, snap / name)
    slug = "".join(c if c.isalnum() else "-" for c in settings()["name"].lower()).strip("-")
    got = sham_inputs.publish_modelscope(snap, f"sham-crawl-{slug}", "leftover of the previous cycle")
    shutil.rmtree(snap, ignore_errors=True)
    if got:
        marker.write_text(got, encoding="utf-8")
    print(f"leftover: {'published as ' + got if got else 'NOT published (kept on disk)'}", flush=True)


def _clean_lines(text: str, limit: int = 2600) -> str:
    """The last lines of a child's output, without any line that mentions a token or a key (the status page is public to anyone who can call the Studio)."""
    keep = [ln for ln in str(text or "").splitlines() if ln.strip() and not any(w in ln.lower() for w in ("token", "key", "secret", "password"))]
    return "\n".join(keep[-20:])[-limit:]


def publish_leftover_subprocess() -> str:
    """Runs the leftover publish in its own process and returns its (cleaned) last lines; the same text goes to STATE["leftover"] so the status shows what happened."""
    import subprocess
    try:
        r = subprocess.run([sys.executable, "-u", str(Path(__file__).resolve()), "--publish-leftover"], capture_output=True, text=True, timeout=40 * 60, check=False)
        out = _clean_lines((r.stdout or "") + "\n" + (r.stderr or ""))
        if r.returncode != 0:
            out = f"exit {r.returncode}\n" + out
    except Exception as exc:  # noqa: BLE001 - never stop the trainer for this
        out = f"leftover publish failed: {type(exc).__name__}: {str(exc)[:120]}"
    _set(leftover=out[-2000:])
    print("leftover publish:\n" + out, flush=True)
    return out


def run_cycle_subprocess(cfg: dict) -> dict:
    """Run child_cycle in a subprocess; copy its printed lines into the status tail; kill it when it overruns the wall-clock budget (hours + 40 min)."""
    import subprocess
    deadline = time.time() + cfg["hours"] * 3600 + 40 * 60
    proc = subprocess.Popen([sys.executable, "-u", str(Path(__file__).resolve()), "--cycle"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    result: dict = {}
    killed = False

    def watchdog():
        nonlocal killed
        while proc.poll() is None:
            if time.time() > deadline:
                killed = True
                proc.kill()
                return
            time.sleep(20)

    threading.Thread(target=watchdog, daemon=True, name="trainer-watchdog").start()
    tee = _Tee(open(os.devnull, "w"))
    for line in proc.stdout:                         # type: ignore[union-attr]
        if line.startswith(RESULT_MARK):
            try:
                result = json.loads(line[len(RESULT_MARK):])
            except ValueError:
                pass
        tee.write(line)
        try:
            sys.__stdout__.write(line)               # the Studio's own log keeps everything
        except Exception:  # noqa: BLE001
            pass
    code = proc.wait()
    if killed:
        raise RuntimeError(f"cycle killed after the {cfg['hours']} h + 40 min wall-clock budget")
    if code != 0:
        raise RuntimeError(f"cycle process exited with code {code}" + (" (killed: out of memory?)" if code in (-9, 137) else ""))
    return result


def train_forever(run_fn=None, sleep=time.sleep, max_cycles: int | None = None) -> None:
    cfg = settings()
    WORK.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("SHAM_LIVE_WORK", str(WORK))
    in_process = run_fn is not None                    # tests inject run_fn; the real Studio runs every cycle in a child process
    if not in_process:
        for k, v in PROFILES[cfg["job"]].items():
            os.environ.setdefault(k, v)
        try:
            import torch
            _set(device="cuda" if torch.cuda.is_available() else "cpu")
        except Exception:
            pass
    if not (os.environ.get("KAGGLE_USERNAME") and (os.environ.get("KAGGLE_API_TOKEN") or os.environ.get("KAGGLE_KEY"))):
        _set(phase="blocked", error="no Kaggle keys in the Studio secrets (KAGGLE_USERNAME + KAGGLE_API_TOKEN)")
        return
    if not isinstance(sys.stdout, _Tee):
        sys.stdout = _Tee(sys.stdout)
    if not in_process:
        _set(phase="publishing-leftover")
        publish_leftover_subprocess()
    cycle = 0
    while max_cycles is None or cycle < max_cycles:
        cycle += 1
        _set(phase="training", cycle=cycle, error="")
        try:
            res = run_fn(hours=cfg["hours"], name=cfg["name"], source_set=cfg["source_set"], video=False, workers=cfg["workers"]) if in_process else run_cycle_subprocess(cfg)
            _set(phase="between-cycles", last=_short(res))
            if not in_process and isinstance(res, dict) and res.get("published"):
                try:                                       # the cycle itself published its best weights: a restart must not push them again
                    (WORK / "checkpoints" / ".published_to_modelscope").write_text(str(res["published"])[:80], encoding="utf-8")
                except OSError:
                    pass
        except Exception as exc:   # one failed cycle never stops the next
            _set(phase="error-retrying", error=f"{type(exc).__name__}: {str(exc)[:200]}")
            traceback.print_exc()
            sleep(600)
        sleep(30)


def status_json() -> str:
    with _LOCK:
        quiet = round((time.time() - _LAST_LINE_AT[0]) / 60) if _LAST_LINE_AT[0] else None
        return json.dumps({**STATE, "settings": {k: v for k, v in settings().items()}, "tail": list(_TAIL[-25:]), "minutes_since_last_line": quiet}, ensure_ascii=False)


def main() -> None:
    import gradio as gr
    threading.Thread(target=train_forever, daemon=True, name="sham-trainer").start()
    with gr.Blocks(title="Sham trainer") as demo:
        gr.Markdown("Sham live trainer — status only (the work runs in the background).")
        out = gr.Textbox(label="status", interactive=False)
        gr.Button("refresh").click(status_json, None, out, api_name="status")
        gr.Button("publish", visible=False).click(lambda: publish_leftover_subprocess(), None, out, api_name="publish_now")   # retry the leftover publish without a redeploy
    demo.launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT") or 7860))


if __name__ == "__main__":
    if "--cycle" in sys.argv:
        child_cycle()
        sys.exit(0)
    if "--publish-leftover" in sys.argv:
        child_publish_leftover()
        sys.exit(0)
    if "--selftest" in sys.argv:
        assert settings({})["name"] == "ms1" and settings({"SHAM_TRAINER_NAME": "MS 2!"})["name"] == "ms-2"
        assert settings({"SHAM_TRAINER_HOURS": "99"})["hours"] == 10.0 and settings({"SHAM_TRAINER_HOURS": "x"})["hours"] == 5.0
        assert settings({"SHAM_TRAINER_JOB": "Images"})["job"] == "images" and settings({"SHAM_TRAINER_JOB": "zzz"})["job"] == "live"
        assert set(PROFILES) == {"live", "images", "audio", "chat", "tools", "text", "codec", "motion"}
        calls = []

        def fake(**kw):
            calls.append(kw)
            if len(calls) == 1:
                raise RuntimeError("boom")
            return {"steps": 12, "published": True, "secret": "never"}
        os.environ.update(KAGGLE_USERNAME="u", KAGGLE_API_TOKEN="t")
        train_forever(fake, sleep=lambda s: None, max_cycles=2)
        assert len(calls) == 2 and calls[0]["video"] is False and STATE["last"] == {"steps": 12, "published": True}, (calls, STATE)
        del os.environ["KAGGLE_API_TOKEN"]
        train_forever(fake, sleep=lambda s: None, max_cycles=1)
        assert STATE["phase"] == "blocked"
        t = _Tee(open(os.devnull, "w"))
        t.write("hello\nkaggle token abc\nsecond line\n" + "x" * 500 + "\n")
        assert _TAIL[-3:] == ["hello", "second line", "x" * 220] and "abc" not in "".join(_TAIL), _TAIL
        assert json.loads(status_json())["tail"][-1] == "x" * 220
        import tempfile
        import types
        WORK = Path(tempfile.mkdtemp())
        (WORK / "checkpoints").mkdir()
        sent = []
        fake_inputs = types.ModuleType("sham_inputs")
        fake_inputs.publish_modelscope = lambda folder, name, message: (sent.append((name, sorted(p.name for p in Path(folder).iterdir()))), "modelscope:acct/" + name)[1]
        sys.modules["sham_inputs"] = fake_inputs
        child_publish_leftover()                                         # no weights yet: nothing is sent
        assert sent == [], sent
        (WORK / "checkpoints" / "final.pt").write_bytes(b"w")
        (WORK / "checkpoints" / "sham_small_tokenizer.json").write_text("{}")
        (WORK / "checkpoints" / "crawl_progress.json").write_text("{}")
        child_publish_leftover()
        assert sent == [("sham-crawl-ms1", ["final.pt", "sham_small_tokenizer.json"])], sent
        child_publish_leftover()                                         # already published: not twice
        assert len(sent) == 1, sent
        print("modelscope-trainer app self-test OK")
        sys.exit(0)
    main()
