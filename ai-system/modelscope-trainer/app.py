"""Sham's live CPU/GPU trainer as a free ModelScope Studio (a Gradio app whose background thread trains, publishes, and starts again).

Same job as the GitHub CPU trainer and the Oracle one: sham_live.run(...) starts from the newest published head, trains for SHAM_TRAINER_HOURS, publishes ITS OWN lineage
(sham-crawl-<SHAM_TRAINER_NAME> + its corpus) to Kaggle; the merge job finds every sham-crawl-* dataset by itself and judges it through the same gate, so nothing else changes.
Device: sham_live picks CUDA when the Studio has a GPU and CPU otherwise (the free tier is CPU), so the same file serves both.

Settings come from the Studio's secrets (set by deploy-sham-trainer-studio.yml): KAGGLE_USERNAME, KAGGLE_API_TOKEN, SHAM_TRAINER_NAME, SHAM_TRAINER_HOURS, HF_ENDPOINT (hf-mirror: huggingface.co is
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

HERE = Path(__file__).resolve().parent
SHAM = HERE / "sham_small"                      # the sham_small code the deploy workflow copies next to this file
WORK = Path(os.environ.get("SHAM_LIVE_WORK") or (Path.home() / "sham_live_work"))
STATE: dict = {"phase": "starting", "cycle": 0, "device": "?", "started": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "last": {}, "error": ""}
_LOCK = threading.Lock()


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
    return {"name": name, "hours": hours, "workers": workers, "source_set": env.get("SHAM_TRAINER_SOURCES") or "gh"}


def _set(**kw) -> None:
    with _LOCK:
        STATE.update(kw)


def _short(res) -> dict:
    """Whitelisted numbers only: never a token, never a text."""
    keep = ("steps", "published", "corpus", "guard_score", "rollbacks", "device", "hours")
    return {k: res[k] for k in keep if isinstance(res, dict) and k in res and isinstance(res[k], (int, float, bool, str)) and len(str(res[k])) <= 80}


def train_forever(run_fn=None, sleep=time.sleep, max_cycles: int | None = None) -> None:
    cfg = settings()
    WORK.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("SHAM_LIVE_WORK", str(WORK))
    if run_fn is None:
        sys.path.insert(0, str(SHAM))
        import sham_live
        run_fn = sham_live.run
        try:
            import torch
            _set(device="cuda" if torch.cuda.is_available() else "cpu")
        except Exception:
            pass
    if not (os.environ.get("KAGGLE_USERNAME") and (os.environ.get("KAGGLE_API_TOKEN") or os.environ.get("KAGGLE_KEY"))):
        _set(phase="blocked", error="no Kaggle keys in the Studio secrets (KAGGLE_USERNAME + KAGGLE_API_TOKEN)")
        return
    cycle = 0
    while max_cycles is None or cycle < max_cycles:
        cycle += 1
        _set(phase="training", cycle=cycle, error="")
        try:
            res = run_fn(hours=cfg["hours"], name=cfg["name"], source_set=cfg["source_set"], video=False, workers=cfg["workers"])
            _set(phase="between-cycles", last=_short(res))
        except Exception as exc:   # one failed cycle never stops the next
            _set(phase="error-retrying", error=f"{type(exc).__name__}: {str(exc)[:200]}")
            traceback.print_exc()
            sleep(600)
        sleep(30)


def status_json() -> str:
    with _LOCK:
        return json.dumps({**STATE, "settings": {k: v for k, v in settings().items()}}, ensure_ascii=False)


def main() -> None:
    import gradio as gr
    threading.Thread(target=train_forever, daemon=True, name="sham-trainer").start()
    with gr.Blocks(title="Sham trainer") as demo:
        gr.Markdown("Sham live trainer — status only (the work runs in the background).")
        out = gr.Textbox(label="status", interactive=False)
        gr.Button("refresh").click(status_json, None, out, api_name="status")
    demo.launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT") or 7860))


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        assert settings({})["name"] == "ms1" and settings({"SHAM_TRAINER_NAME": "MS 2!"})["name"] == "ms-2"
        assert settings({"SHAM_TRAINER_HOURS": "99"})["hours"] == 10.0 and settings({"SHAM_TRAINER_HOURS": "x"})["hours"] == 5.0
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
        print("modelscope-trainer app self-test OK")
        sys.exit(0)
    main()
