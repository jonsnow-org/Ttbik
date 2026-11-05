"""Sham v2's own video Studio: real text-to-video on a free CPU Studio (AnimateDiff-Lightning on an SD-1.5 realistic base, ~2.9 GiB of open weights from ModelScope).

Why it exists: the Sham v2 chat Studio (8 GB RAM) already holds the text model; loading the video pipeline there (4+ GB) killed the Studio (HTTP 502 right after the
4 sampling steps). Video gets a Studio of its own so the chat Studio never has to carry it. Independent of Nova: Nova's media Studio has its own copy of the same code.

The deploy workflow copies colab/sham_small/cpu_video.py and media_quality.py next to this file. API (Gradio call protocol, private Studio, account token):
  status()                    -> JSON {phase, disk, ram, video:{ready, profile}}
  generate_video(body_json)   -> JSON {"type": "video", "b64": <mp4>, "text"} | {"type": "busy"} | {"type": "error", "text"}
  generate_video_start(body)  -> JSON {"type": "job", "job": id} | {"type": "busy"}   (the clip runs in the background)
  job({"job": id, "wait": s}) -> the finished answer above, {"type": "running", "phase", "elapsed_s"}, or {"type": "error", "reason": "job_lost"}
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import threading
import time
import traceback
from pathlib import Path

os.environ.setdefault("CPU_VIDEO_KEEP", "1")        # this Studio has nothing else in RAM: keep the pipeline loaded between clips
os.environ.setdefault("CPU_VIDEO_MAX_PASS_S", "2")  # 8 GB Studio: 2 s (16-frame) passes are the proven-safe size; a 4 s pass died mid-sampling (2026-11-05)
HERE = Path(__file__).resolve().parent
_LOCK = threading.Lock()
STATE = {"phase": "starting", "error": "", "videos": 0, "last_s": 0.0}

import cpu_video  # noqa: E402  (copied next to app.py by the deploy workflow)
from media_quality import MediaQualityError, check_mp4  # noqa: E402

ENVS = ("SHAM_VIDEO_MODEL_DIR", "CPU_VIDEO_MODEL_DIR")

def _ram() -> dict:
    try:
        mem = {l.split(":")[0]: int(l.split()[1]) // 1024 for l in open("/proc/meminfo") if l.split(":")[0] in ("MemTotal", "MemAvailable")}
        return {"total_mb": mem.get("MemTotal", 0), "free_mb": mem.get("MemAvailable", 0)}
    except OSError:
        return {}


def _disk() -> dict:
    try:
        d = shutil.disk_usage(HERE)
        return {"total_gb": round(d.total / 2 ** 30, 2), "used_gb": round(d.used / 2 ** 30, 2), "free_gb": round(d.free / 2 ** 30, 2)}
    except OSError:
        return {}


def generate_video(body: str) -> str:
    """One clip at a time (a second request while one runs answers busy: the caller retries)."""
    if not _LOCK.acquire(blocking=False):
        return json.dumps({"type": "busy"})
    t0 = time.time()
    try:
        payload = json.loads(body or "{}")
        prompt = str(payload.get("prompt", "")).strip()
        if not prompt:
            return json.dumps({"type": "error", "text": "a text prompt is required"})
        STATE["phase"] = "making video"
        requested_seconds = float(payload.get("seconds", 4) or 4)
        clip = cpu_video.cv_generate_long(HERE, prompt, requested_seconds, int(payload.get("seed", 0) or 0), ENVS)
        check_mp4(clip, expected_seconds=requested_seconds, min_width=480, min_height=270)
        STATE["videos"] += 1
        STATE["last_s"] = round(time.time() - t0, 1)
        STATE["error"] = ""
        return json.dumps({"type": "video", "mime": "video/mp4", "b64": base64.b64encode(clip).decode(), "text": prompt[:120]})
    except MediaQualityError as exc:
        STATE["error"] = f"quality: {str(exc)[:160]}"
        return json.dumps({"type": "error", "text": STATE["error"]})
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        STATE["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
        return json.dumps({"type": "error", "text": STATE["error"]})
    finally:
        STATE["phase"] = "ready"
        _LOCK.release()


# A clip takes minutes. One long result read through the ModelScope gateway gets cut, and with no request in flight the serverless Studio stops giving the job
# CPU (Nova/LFM run logs 2026-11-04: sampling stuck at 0/4 for 13+ min, then every request 500/502). The clip runs in a background thread instead and the caller
# asks `job` back-to-back; each call waits at most 20 s.
_JOBS: dict = {}
_JOBS_LOCK = threading.Lock()
JOB_KEEP_S = 1800


def _job_thread(jid: str, body: str) -> None:
    try:
        out = json.loads(generate_video(body))
    except Exception as exc:  # noqa: BLE001
        out = {"type": "error", "text": f"{type(exc).__name__}: {str(exc)[:200]}"}
    with _JOBS_LOCK:
        job = _JOBS.setdefault(jid, {})
        job["result"], job["done_at"] = out, time.time()
        ev = job.get("event")
    if ev is not None:
        ev.set()


def generate_video_start(body: str) -> str:
    import uuid
    if _LOCK.locked():
        return json.dumps({"type": "busy"})
    jid = uuid.uuid4().hex[:16]
    now = time.time()
    with _JOBS_LOCK:
        for old in [j for j, v in _JOBS.items() if v.get("done_at") and now - v["done_at"] > JOB_KEEP_S]:
            _JOBS.pop(old, None)
        _JOBS[jid] = {"started": now, "event": threading.Event()}
    threading.Thread(target=_job_thread, args=(jid, body), daemon=True).start()
    return json.dumps({"type": "job", "job": jid})


def job(body: str) -> str:
    req = json.loads(body or "{}")
    jid = str(req.get("job") or "")
    wait = max(0.0, min(20.0, float(req.get("wait", 15) or 0)))
    with _JOBS_LOCK:
        entry = _JOBS.get(jid)
    if entry is None:
        return json.dumps({"type": "error", "reason": "job_lost", "text": "the video job is unknown (the Studio restarted or the result expired)"})
    if "result" not in entry and entry.get("event") is not None:
        entry["event"].wait(wait)
    with _JOBS_LOCK:
        entry = _JOBS.get(jid) or entry
        if "result" in entry:
            return json.dumps(entry["result"])
    return json.dumps({"type": "running", "phase": STATE.get("phase", ""), "elapsed_s": round(time.time() - entry.get("started", time.time()), 1)})


def status() -> str:
    ready = bool(cpu_video._CV["pipe"] is not None or cpu_video.cv_find_weights(HERE, ENVS))
    return json.dumps({**STATE, "cpus": os.cpu_count(), "ram": _ram(), "disk": _disk(),
                       "video": {"engine": "AnimateDiff-Lightning (segmented)", "ready": ready, "device": "cpu", "profile": cpu_video.cv_profile(), "supported_seconds": list(cpu_video.CV_SUPPORTED_DURATIONS), "segment_seconds": [2, 3, 4]}})


def _warm() -> None:
    """Fetch the weights from ModelScope once and load the pipeline (retry on failure, no recursion)."""
    while True:
        try:
            STATE["phase"] = "loading video weights"
            cpu_video.cv_pipe(HERE, ENVS)
            STATE["phase"] = "ready"
            STATE["error"] = ""
            return
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            STATE["phase"] = "waiting for weights"
            STATE["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
            time.sleep(120)



if __name__ == "__main__":
    import gradio as gr
    threading.Thread(target=_warm, daemon=True).start()
    with gr.Blocks() as demo:
        gr.Markdown("Sham v2 video Studio — real text-to-video on CPU. Computer tools run on the separate isolated computer hub.")
        box = gr.Textbox(visible=False)
        out = gr.Textbox(visible=False)
        gr.Button("generate_video", visible=False).click(generate_video, box, out, api_name="generate_video")
        gr.Button("generate_video_start", visible=False).click(generate_video_start, box, out, api_name="generate_video_start")
        gr.Button("job", visible=False).click(job, box, out, api_name="job")
        gr.Button("status", visible=False).click(status, None, out, api_name="status")
    demo.queue(default_concurrency_limit=4).launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", 7860)), show_error=True)
