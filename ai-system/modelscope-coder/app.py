"""
Open coder on a ModelScope Studio (free CPU box) — the commercial daily coding model, a separate service next to Sham's own Studio.

What it serves
  * a pinned llama.cpp `llama-server` (release b11757, CPU build) running an open coding model in GGUF:
      primary   unsloth/Qwen3.5-4B-GGUF          Qwen3.5-4B-Q4_K_M.gguf           (Apache-2.0)
      fallback  Qwen/Qwen2.5-Coder-7B-Instruct-GGUF qwen2.5-coder-7b-instruct-q4_k_m.gguf (Apache-2.0)
    both fetched from modelscope.cn with modelscope.snapshot_download (this Studio cannot reach github.com or huggingface.co)
  * behind Gradio's own call protocol (the one the Studio proxy speaks), the same way the bot already talks to Sham:
      POST /gradio_api/call/v2/chat        {messages, tools, max_tokens, think, temperature, wait_s} -> {event_id}
      GET  /gradio_api/call/chat/<id>      data: ["<json>"]   (done | pending + job id | loading | error)
      /gradio_api/call/v2/job_result       {job_id, offset}   long answers keep running after the HTTP call returns (job/detach)
      /gradio_api/call/v2/cancel           {job_id}
      /gradio_api/call/v2/status           {}                 phase, model, context, queue length
  * one shared FIFO queue: one generation at a time on the CPU, every other request waits its turn (never refused).
  * NO answer-length cap: max_tokens 0 (default) = generate until the model stops or the context (-c, default 32768) is full.
  * native tool calling (OpenAI `tools`, `--jinja` chat template): the bot's agent harness (src/lib/coderAgent.ts) runs the tools.

Settings (Studio settings -> environment variables; all optional):
  CODER_MODEL_REPO / CODER_MODEL_FILE   override the GGUF (default: the primary above, then the fallback)
  CODER_MODEL_PATH a GGUF already on disk (skips the download)
  CODER_CTX        context tokens for llama-server -c        (default 32768; never below 8192)
  CODER_THREADS    CPU threads                               (default: all cores)
  CODER_API_PREFIX prefix for the api names ("coder_" in the combined variant, combined_app.py)
  MODELSCOPE_API_TOKEN  only if a private model repo is used (the defaults are public)
"""
from __future__ import annotations

import collections
import hashlib
import json
import os
import queue
import subprocess
import tarfile
import threading
import time
import traceback
import urllib.request
import uuid
from pathlib import Path

os.environ.setdefault("no_proxy", "127.0.0.1,localhost")
HERE = Path(__file__).resolve().parent

LLAMA_BUILD = "b11757"
LLAMA_TGZ = f"llama-{LLAMA_BUILD}-bin-ubuntu-x64.tar.gz"
LLAMA_SHA256 = "87aae0ada6ace2aa82e098994ef92ed76677b221941ce940c83757a89f2b1a6e"
LLAMA_URL = f"https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_BUILD}/{LLAMA_TGZ}"   # only tried when the tarball is not in the repo
MODELS = [
    ("unsloth/Qwen3.5-4B-GGUF", "Qwen3.5-4B-Q4_K_M.gguf"),
    ("Qwen/Qwen2.5-Coder-7B-Instruct-GGUF", "qwen2.5-coder-7b-instruct-q4_k_m.gguf"),
]
if os.environ.get("CODER_MODEL_REPO") and os.environ.get("CODER_MODEL_FILE"):
    MODELS.insert(0, (os.environ["CODER_MODEL_REPO"], os.environ["CODER_MODEL_FILE"]))
CTX = max(8192, int(os.environ.get("CODER_CTX", "32768")))
THREADS = int(os.environ.get("CODER_THREADS", "0")) or (os.cpu_count() or 2)
PREFIX = os.environ.get("CODER_API_PREFIX", "")
LLAMA_PORT = int(os.environ.get("CODER_LLAMA_PORT", "8081"))
JOB_TTL = 6 * 3600

STATE = {"phase": "starting", "detail": "", "model": "", "model_repo": "", "ctx": CTX, "threads": THREADS,
         "llama_build": LLAMA_BUILD, "error": "", "started_at": time.time(), "ready_at": 0}
JOBS: "collections.OrderedDict[str, dict]" = collections.OrderedDict()
JOBS_LOCK = threading.Lock()
QUEUE: "queue.Queue[str]" = queue.Queue()
_PROC = {"p": None}


def _log(*a) -> None:
    print("[coder]", *a, flush=True)


# ---------------------------------------------------------------- llama-server binary
def _llama_dir() -> Path:
    out = HERE / "_llama" / LLAMA_BUILD
    exe = next(iter(out.rglob("llama-server")), None) if out.exists() else None
    if exe:
        return exe.parent
    tgz = HERE / LLAMA_TGZ
    if not tgz.exists():
        STATE.update(detail="downloading llama.cpp release")
        tmp = tgz.with_suffix(".part")
        urllib.request.urlretrieve(LLAMA_URL, tmp)
        tmp.rename(tgz)
    h = hashlib.sha256(tgz.read_bytes()).hexdigest()
    if h != LLAMA_SHA256:
        raise RuntimeError(f"llama.cpp tarball sha256 mismatch ({h[:12]})")
    out.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tgz) as t:
        try:
            t.extractall(out, filter="data")
        except TypeError:          # Python without extraction filters
            t.extractall(out)
    exe = next(iter(out.rglob("llama-server")))
    exe.chmod(0o755)
    return exe.parent


# ---------------------------------------------------------------- model
def _download_model() -> Path:
    local = os.environ.get("CODER_MODEL_PATH", "")
    if local and Path(local).is_file():          # a GGUF already on disk (tests, or the combined variant)
        STATE.update(model=Path(local).name, model_repo="local")
        return Path(local)
    from modelscope import snapshot_download
    tok = os.environ.get("MODELSCOPE_API_TOKEN") or ""
    if tok:
        try:
            from modelscope.hub.api import HubApi
            HubApi().login(tok)
        except Exception as exc:  # a public repo still downloads
            _log("login skipped:", type(exc).__name__)
    errors = []
    for repo, fname in MODELS:
        STATE.update(detail=f"downloading {repo}/{fname}", model_repo=repo)
        try:
            try:
                d = snapshot_download(repo, allow_patterns=[fname], cache_dir=str(HERE / "_models"))
            except TypeError:
                d = snapshot_download(repo, allow_file_pattern=[fname], cache_dir=str(HERE / "_models"))
            p = next(iter(Path(d).rglob(fname)), None)
            if p and p.stat().st_size > 100_000_000:
                STATE.update(model=fname, model_repo=repo)
                return p
            errors.append(f"{repo}: file missing")
        except Exception as exc:
            errors.append(f"{repo}: {type(exc).__name__}: {str(exc)[:160]}")
    raise RuntimeError(" | ".join(errors))


def _wait_health(timeout: float = 900) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        p = _PROC["p"]
        if p is not None and p.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{LLAMA_PORT}/health", timeout=5) as r:
                if json.loads(r.read() or b"{}").get("status") == "ok":
                    return True
        except Exception:
            pass
        time.sleep(3)
    return False


def _start_server(model: Path, bindir: Path) -> None:
    env = dict(os.environ, LD_LIBRARY_PATH=f"{bindir}:{os.environ.get('LD_LIBRARY_PATH', '')}")
    cmd = [str(bindir / "llama-server"), "-m", str(model), "-c", str(CTX), "-t", str(THREADS), "-np", "1", "-n", "-1",
           "--jinja", "--host", "127.0.0.1", "--port", str(LLAMA_PORT)]
    log = open(HERE / "_llama_server.log", "ab")
    _PROC["p"] = subprocess.Popen(cmd, env=env, stdout=log, stderr=log, cwd=str(bindir))


def _supervisor() -> None:
    """Brings the server up, and back up if it ever exits. Never crashes the app: the reason is in `status`."""
    while True:
        try:
            if _PROC["p"] is None or _PROC["p"].poll() is not None:
                STATE.update(phase="loading", error="")
                bindir = _llama_dir()
                model = _download_model()
                STATE.update(detail="starting llama-server")
                _start_server(model, bindir)
                if not _wait_health():
                    tail = ""
                    try:
                        tail = (HERE / "_llama_server.log").read_text(errors="ignore")[-400:]
                    except Exception:
                        pass
                    raise RuntimeError("llama-server did not become healthy: " + tail)
                STATE.update(phase="ready", detail="", ready_at=time.time())
                _log("ready", STATE["model_repo"], STATE["model"], "ctx", CTX, "threads", THREADS)
        except Exception as exc:
            STATE.update(phase="error", error=f"{type(exc).__name__}: {str(exc)[:300]}")
            _log(traceback.format_exc()[-800:])
            p = _PROC["p"]
            if p is not None and p.poll() is None:
                p.kill()
            _PROC["p"] = None
            time.sleep(60)
            continue
        time.sleep(10)


# ---------------------------------------------------------------- jobs (shared FIFO queue, one generation at a time)
def _gc() -> None:
    now = time.time()
    with JOBS_LOCK:
        for k in [k for k, j in JOBS.items() if j["status"] in ("done", "error", "cancelled") and now - j.get("finished", now) > JOB_TTL]:
            JOBS.pop(k, None)


def _stream(job: dict) -> None:
    body = {"messages": job["messages"], "stream": True, "temperature": job["temperature"],
            "chat_template_kwargs": {"enable_thinking": bool(job["think"])}}
    if job["tools"]:
        body["tools"] = job["tools"]
    if job["max_tokens"] > 0:
        body["max_tokens"] = job["max_tokens"]
    req = urllib.request.Request(f"http://127.0.0.1:{LLAMA_PORT}/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    calls: dict = {}
    with urllib.request.urlopen(req, timeout=24 * 3600) as r:
        for raw in r:
            if job.get("cancel"):
                job["finish_reason"] = "cancelled"
                break
            line = raw.decode("utf-8", "ignore").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                ev = json.loads(data)
            except ValueError:
                continue
            if ev.get("error"):
                raise RuntimeError(str(ev["error"])[:300])
            for ch in ev.get("choices") or []:
                d = ch.get("delta") or {}
                if d.get("content"):
                    job["text"] += d["content"]
                if d.get("reasoning_content"):
                    job["reasoning"] += d["reasoning_content"]
                for tc in d.get("tool_calls") or []:
                    slot = calls.setdefault(tc.get("index", 0), {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                    if tc.get("id"):
                        slot["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    slot["function"]["name"] += fn.get("name") or ""
                    slot["function"]["arguments"] += fn.get("arguments") or ""
                if ch.get("finish_reason"):
                    job["finish_reason"] = ch["finish_reason"]
            if ev.get("timings"):
                job["timings"] = {k: ev["timings"].get(k) for k in ("prompt_n", "predicted_n", "predicted_per_second")}
    job["tool_calls"] = [calls[i] for i in sorted(calls)]


def _runner() -> None:
    while True:
        jid = QUEUE.get()
        job = JOBS.get(jid)
        if not job or job.get("cancel"):
            if job:
                job.update(status="cancelled", finished=time.time())
            continue
        while STATE["phase"] != "ready":
            time.sleep(2)
        job.update(status="running", started=time.time())
        try:
            _stream(job)
            job.update(status="cancelled" if job.get("cancel") else "done", finished=time.time())
        except Exception as exc:
            job.update(status="error", error=f"{type(exc).__name__}: {str(exc)[:300]}", finished=time.time())
        _gc()


def _queue_pos(jid: str) -> int:
    with JOBS_LOCK:
        waiting = [k for k, j in JOBS.items() if j["status"] in ("queued", "running")]
    return waiting.index(jid) if jid in waiting else -1


def _view(jid: str, offset: int = 0) -> dict:
    job = JOBS.get(jid)
    if not job:
        return {"type": "gone", "job": jid}
    st = job["status"]
    out = {"job": jid, "status": st, "text": job["text"][offset:], "offset": offset, "total": len(job["text"]),
           "reasoning_len": len(job["reasoning"]), "finish_reason": job.get("finish_reason", "")}
    if st in ("queued", "running"):
        out.update(type="pending", queue_pos=_queue_pos(jid), phase=STATE["phase"])
    elif st == "done":
        out.update(type="done", tool_calls=job.get("tool_calls") or [], timings=job.get("timings") or {})
    elif st == "cancelled":
        out.update(type="cancelled")
    else:
        out.update(type="error", error=job.get("error", ""))
    return out


def _num(x, default: float) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def chat(messages: str, tools: str = "", max_tokens: float = 0, think: str = "", temperature: float = 0.6, wait_s: float = 20) -> str:
    """Queue one chat completion; wait up to wait_s (max 50) for it, else answer pending + job id."""
    try:
        msgs = json.loads(messages) if isinstance(messages, str) else messages
        tls = json.loads(tools) if isinstance(tools, str) and tools.strip() else (tools or [])
        assert isinstance(msgs, list) and msgs
    except Exception as exc:
        return json.dumps({"type": "error", "error": f"bad messages: {exc}"[:200]})
    jid = uuid.uuid4().hex
    job = {"messages": msgs, "tools": tls, "max_tokens": int(_num(max_tokens, 0)), "think": str(think).lower() in ("1", "true", "yes", "on"),
           "temperature": _num(temperature, 0.6), "status": "queued", "text": "", "reasoning": "", "created": time.time()}
    with JOBS_LOCK:
        JOBS[jid] = job
    QUEUE.put(jid)
    deadline = time.time() + max(0.0, min(50.0, _num(wait_s, 20)))
    while time.time() < deadline and job["status"] in ("queued", "running"):
        time.sleep(0.5)
    return json.dumps(_view(jid), ensure_ascii=False)


def job_result(job_id: str, offset: float = 0) -> str:
    return json.dumps(_view(str(job_id).strip(), max(0, int(_num(offset, 0)))), ensure_ascii=False)


def cancel(job_id: str) -> str:
    job = JOBS.get(str(job_id).strip())
    if job:
        job["cancel"] = True
    return json.dumps({"type": "cancelled" if job else "gone", "job": job_id})


def status() -> str:
    with JOBS_LOCK:
        q = sum(1 for j in JOBS.values() if j["status"] in ("queued", "running"))
    return json.dumps(dict(STATE, queue=q, uptime_s=int(time.time() - STATE["started_at"])), ensure_ascii=False)


def start_background() -> None:
    threading.Thread(target=_supervisor, daemon=True).start()
    threading.Thread(target=_runner, daemon=True).start()


def build_ui():
    import gradio as gr
    tabs = [
        gr.Interface(chat, [gr.Textbox(label="messages"), gr.Textbox(label="tools"), gr.Number(label="max_tokens", value=0),
                            gr.Textbox(label="think"), gr.Number(label="temperature", value=0.6), gr.Number(label="wait_s", value=20)],
                     gr.Textbox(label="json"), api_name=f"{PREFIX}chat", flagging_mode="never"),
        gr.Interface(job_result, [gr.Textbox(label="job_id"), gr.Number(label="offset", value=0)], gr.Textbox(label="json"),
                     api_name=f"{PREFIX}job_result", flagging_mode="never"),
        gr.Interface(cancel, [gr.Textbox(label="job_id")], gr.Textbox(label="json"), api_name=f"{PREFIX}cancel", flagging_mode="never"),
        gr.Interface(status, None, gr.Textbox(label="status"), api_name=f"{PREFIX}status", flagging_mode="never"),
    ]
    return gr.TabbedInterface(tabs, ["chat", "job_result", "cancel", "status"], title="coder")


if __name__ == "__main__":
    start_background()
    build_ui().queue(default_concurrency_limit=8).launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", 7860)))
