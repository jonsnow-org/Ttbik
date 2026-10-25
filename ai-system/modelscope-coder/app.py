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
  * NO answer-length cap: max_tokens 0 (default) = generate until the model stops or the context (-c, default 65536) is full.
  * native tool calling (OpenAI `tools`, `--jinja` chat template): the bot's agent harness (src/lib/coderAgent.ts) runs the tools.

Settings (Studio settings -> environment variables; all optional):
  CODER_MODEL_REPO / CODER_MODEL_FILE   override the GGUF (default: the primary above, then the fallback)
  CODER_MODEL_PATH a GGUF already on disk (skips the download)
  CODER_CTX        context tokens for llama-server -c        (default 65536; never below 8192; 8 GB box: do not go above 65536)
  CODER_THREADS    CPU threads                               (default: all cores)
  CODER_API_PREFIX prefix for the api names ("coder_" in the combined variant, combined_app.py)
  MODELSCOPE_API_TOKEN  only if a private model repo is used (the defaults are public)
  CODER_JOB_HEARTBEAT_S  a job not polled for this long is not live: no queue position, cancelled at once (default 75, min 30)
"""
from __future__ import annotations

import collections
import hashlib
import json
import os
import shutil
import queue
import socket
import http.client
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
# 65,536 since 2026-10-24: measured on this exact model + llama.cpp build with 2 cores (.github/workflows/nova-ctx-probe.yml), peak memory is
# 5.07 GB at 32k, 6.07 GB at 64k, 7.06 GB at 96k, 8.06 GB at 128k. The Studio has 8 GB in total, so 64k is the highest safe value.
CTX = max(8192, int(os.environ.get("CODER_CTX", "65536")))
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
    parts = sorted(HERE.glob(f"llama-{LLAMA_BUILD}.part*"))
    if parts:
        # the release travels as plain 4 MiB parts: ModelScope turns a big *.gz into a Git LFS pointer that a fresh instance cannot resolve
        data = b"".join(p.read_bytes() for p in parts)
        if hashlib.sha256(data).hexdigest() == LLAMA_SHA256:
            tgz.write_bytes(data)
    if tgz.exists() and tgz.stat().st_size < 4096 and b"git-lfs" in tgz.read_bytes()[:200]:
        tgz.unlink()                                                   # an LFS pointer, not the release
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
    for repo, fname in MODELS:          # a restart must not depend on the hub: a GGUF already on this instance's disk is used as it is
        have = next(iter((HERE / "_models").rglob(fname)), None) if (HERE / "_models").is_dir() else None
        if have and have.stat().st_size > 100_000_000:
            STATE.update(model=fname, model_repo=repo, detail="model from disk")
            return have
    errors = []
    for anonymous in (False, True):
        if anonymous:
            # the hub answered 403 ("Check repo_exists return status code 403") to the logged-in call for these PUBLIC repos: a stale / refused token
            # poisons every request, so the second pass drops the login (cookies and env) and downloads anonymously
            os.environ.pop("MODELSCOPE_API_TOKEN", None)
            os.environ.pop("MODELSCOPE_TOKEN", None)
            shutil.rmtree(Path.home() / ".modelscope" / "credentials", ignore_errors=True)
            errors.append("-- retrying without a login --")
        for repo, fname in MODELS:
            STATE.update(detail=f"downloading {repo}/{fname}" + (" (anonymous)" if anonymous else ""), model_repo=repo)
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


_SPEC = {"on": False, "bad": False}


def _start_server(model: Path, bindir: Path) -> None:
    env = dict(os.environ, LD_LIBRARY_PATH=f"{bindir}:{os.environ.get('LD_LIBRARY_PATH', '')}")
    cmd = [str(bindir / "llama-server"), "-m", str(model), "-c", str(CTX), "-t", str(THREADS), "-np", "1", "-n", "-1",
           "--jinja", "--alias", "nova-ai", "--cache-ram", os.environ.get("CODER_CACHE_RAM_MB", "1024"), "--ctx-checkpoints", os.environ.get("CODER_CTX_CHECKPOINTS", "8"), "--host", "127.0.0.1", "--port", str(LLAMA_PORT)]
    # Opt-in experiment, OFF unless CODER_SPEC is set (e.g. "--spec-type ngram-simple"): speculative decoding from the prompt's own n-grams, no draft model, no extra RAM.
    # If the server then fails to come up, the supervisor starts it again without these flags (_SPEC["bad"]), so the experiment can never take a Studio down.
    if os.environ.get("CODER_SPEC", "").strip() and not _SPEC["bad"]:
        cmd += os.environ["CODER_SPEC"].split()
        _SPEC["on"] = True
    else:
        _SPEC["on"] = False
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
            if _SPEC["on"]:
                _SPEC["bad"] = True                      # the experimental flags were on: next start goes without them, at once
                _log("speculative flags failed; restarting without them")
            STATE.update(phase="error", error=f"{type(exc).__name__}: {str(exc)[:300]}")
            _log(traceback.format_exc()[-800:])
            p = _PROC["p"]
            if p is not None and p.poll() is None:
                p.kill()
            _PROC["p"] = None
            time.sleep(5 if _SPEC["bad"] and _SPEC["on"] else 60)
            continue
        time.sleep(10)


# ---------------------------------------------------------------- jobs (shared FIFO queue, one generation at a time)
# A job nobody polls any more (the bot gave up, or its task ended) must not hold the one-at-a-time queue for everyone else.
ABANDON_S = max(60.0, float(os.environ.get("CODER_JOB_ABANDON_S", "180") or 180))
JOB_MAX_S = max(300.0, float(os.environ.get("CODER_JOB_MAX_S", "1800") or 1800))


# The bot polls a live job every few seconds; one not polled for HEARTBEAT_S has no one waiting for it (an orphan of a timed-out call,
# or a task that ended). It no longer counts in anyone's queue position and is cancelled, even mid prompt-processing.
HEARTBEAT_S = max(30.0, float(os.environ.get("CODER_JOB_HEARTBEAT_S", "75") or 75))


def _abandoned(job: dict) -> bool:
    now = time.time()
    return now - job.get("seen", job.get("created", now)) > ABANDON_S or (job.get("started") and now - job["started"] > JOB_MAX_S)


def _stale(job: dict) -> bool:
    """No heartbeat (poll) within HEARTBEAT_S, cancelled, or abandoned: not a live job."""
    now = time.time()
    return bool(job.get("cancel")) or _abandoned(job) or now - job.get("seen", job.get("created", now)) > HEARTBEAT_S


def _purge() -> None:
    """On every read: stale queued / running jobs are marked cancelled, so they never hold the queue or a position."""
    with JOBS_LOCK:
        for j in JOBS.values():
            if j["status"] in ("queued", "running") and _stale(j):
                j["cancel"] = True
                if j["status"] == "queued":
                    j.update(status="cancelled", finished=time.time())


def _gc() -> None:
    now = time.time()
    with JOBS_LOCK:
        for k in [k for k, j in JOBS.items() if j["status"] in ("done", "error", "cancelled") and now - j.get("finished", now) > JOB_TTL]:
            JOBS.pop(k, None)


# Deeper thinking at ~5 tokens/s: measured on a Studio, a trivial coding question with thinking ON used 700 tokens (134 s) of reasoning and had not started its
# answer; with thinking OFF the same question took 23 s. So thinking is bounded: when a step's reasoning passes this many characters with no answer yet, the step
# is stopped and asked again with thinking off (the prompt is already in the Studio's cache, so the second try only writes the answer).
THINK_CAP_CHARS = max(300, int(os.environ.get("CODER_THINK_CAP_CHARS", "1200") or 1200))


def _stream(job: dict) -> None:
    _stream_once(job)
    # a thought that was too long, or one that ended with no answer and no tool call (the answer / call written inside the thinking): ask again, thinking off
    if job["think"] and not job.get("cancel") and (job.get("think_cut") or (not job["text"].strip() and not job.get("tool_calls"))):
        job.update(think=False, think_cut=False, thought_chars=len(job.get("reasoning", "")), text="", reasoning="", finish_reason="", tool_calls=[])
        _stream_once(job)


def _stream_once(job: dict) -> None:
    # cache_prompt: the part of the conversation that did not change since the last step is not read again (a CPU reads ~20-40 prompt tokens/s)
    body = {"messages": job["messages"], "stream": True, "temperature": job["temperature"], "cache_prompt": True, "return_progress": True,
            "chat_template_kwargs": {"enable_thinking": bool(job["think"])}}
    if job["tools"]:
        body["tools"] = job["tools"]
    if job["max_tokens"] > 0:
        body["max_tokens"] = job["max_tokens"]
    calls: dict = {}
    # a plain connection the guard can close: a cancelled / stale job stops at once, even while llama-server is still reading the prompt
    # (no stream line yet); llama-server drops the task when its client goes away, and the runner moves on to the next job
    conn = http.client.HTTPConnection("127.0.0.1", LLAMA_PORT, timeout=24 * 3600)
    done = threading.Event()

    def guard() -> None:
        while not done.wait(2):
            if _stale(job):
                job["cancel"] = True
                job["finish_reason"] = "cancelled"
                try:
                    if conn.sock is not None:
                        conn.sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                return

    threading.Thread(target=guard, daemon=True).start()
    try:
        conn.request("POST", "/v1/chat/completions", body=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        r = conn.getresponse()
        if r.status != 200:
            raise RuntimeError(f"HTTP {r.status}: {r.read(300).decode('utf-8', 'ignore')}")
        for raw in r:
            if job.get("cancel") or _stale(job):
                job["cancel"] = True
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
            pp = ev.get("prompt_progress")                 # llama-server: how much of the prompt is read (the box reads ~10-30 tokens/s)
            if pp:
                job["prefill"] = {k: pp.get(k) for k in ("total", "cache", "processed", "time_ms")}
            for ch in ev.get("choices") or []:
                d = ch.get("delta") or {}
                if d.get("content"):
                    job["text"] += d["content"]
                if d.get("reasoning_content"):
                    job["reasoning"] += d["reasoning_content"]
                    if job["think"] and not job["text"] and not calls and len(job["reasoning"]) > THINK_CAP_CHARS:
                        job["think_cut"] = True                      # too long a thought for this box: the step is asked again, thinking off
                        break
                for tc in d.get("tool_calls") or []:
                    slot = calls.setdefault(tc.get("index", 0), {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                    if tc.get("id"):
                        slot["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    slot["function"]["name"] += fn.get("name") or ""
                    slot["function"]["arguments"] += fn.get("arguments") or ""
                if ch.get("finish_reason"):
                    job["finish_reason"] = ch["finish_reason"]
            if job.get("think_cut"):
                break                                                # leave the stream: closing the connection stops llama-server's generation
            if ev.get("timings"):
                job["timings"] = {k: ev["timings"].get(k) for k in ("prompt_n", "predicted_n", "predicted_per_second")}
    except (OSError, http.client.HTTPException):
        if not job.get("cancel"):
            raise
    finally:
        done.set()
        conn.close()
    job["tool_calls"] = [calls[i] for i in sorted(calls)]


def _runner() -> None:
    while True:
        jid = QUEUE.get()
        job = JOBS.get(jid)
        if not job or job.get("cancel"):
            if job:
                job.update(status="cancelled", finished=time.time())
            continue
        while STATE["phase"] != "ready" and not (job.get("cancel") or _stale(job)):
            time.sleep(2)                                              # the model is loading / in error: a cancelled or abandoned job must not hold the one worker meanwhile
        if job.get("cancel") or _stale(job):
            job.update(status="cancelled", finished=time.time())
            _log("skipped abandoned job", jid)
            continue
        job.update(status="running", started=time.time())
        try:
            _stream(job)
            job.update(status="cancelled" if job.get("cancel") else "done", finished=time.time())
        except Exception as exc:
            if job.get("cancel"):
                job.update(status="cancelled", finished=time.time())
                continue
            job.update(status="error", error=f"{type(exc).__name__}: {str(exc)[:300]}", finished=time.time())
        _gc()


def _queue_pos(jid: str) -> int:
    _purge()
    with JOBS_LOCK:
        waiting = [k for k, j in JOBS.items() if j["status"] in ("queued", "running") and not j.get("cancel") and (k == jid or not _stale(j))]
    return waiting.index(jid) if jid in waiting else -1


def _view(jid: str, offset: int = 0) -> dict:
    job = JOBS.get(jid)
    if not job:
        return {"type": "gone", "job": jid}
    job["seen"] = time.time()
    st = job["status"]
    out = {"job": jid, "status": st, "text": job["text"][offset:], "offset": offset, "total": len(job["text"]),
           "reasoning_len": len(job["reasoning"]), "finish_reason": job.get("finish_reason", ""), "prefill": job.get("prefill")}
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
        job["seen"] = time.time()                                  # its caller is still on the line
        if job["status"] == "queued" and time.time() - job["created"] > 1.2:
            break                                                  # still waiting behind another job: say so NOW (the bot can send the step to an idle Studio) instead of holding the line for wait_s
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
    _purge()
    with JOBS_LOCK:
        q = sum(1 for j in JOBS.values() if j["status"] in ("queued", "running") and not j.get("cancel"))
        now_t = time.time()
        # what is in the queue right now (no text, only facts): lets the bot say WHO is ahead of a step instead of guessing
        active = [dict(status=j["status"], age_s=int(now_t - j.get("created", now_t)), think=bool(j.get("think")), cancelled=bool(j.get("cancel")), prompt_chars=len(json.dumps(j.get("messages", []), ensure_ascii=False)),
                       max_tokens=j.get("max_tokens", 0)) for j in JOBS.values() if j["status"] in ("queued", "running")][:8]
    mem = {}
    try:      # the box's real memory, so the context size can be checked against it (kB -> GB)
        info = dict(l.split(":", 1) for l in open("/proc/meminfo").read().splitlines() if ":" in l)
        mem = {"mem_total_gb": round(int(info["MemTotal"].split()[0]) / 1048576, 2), "mem_available_gb": round(int(info["MemAvailable"].split()[0]) / 1048576, 2)}
    except Exception:
        pass
    return json.dumps(dict(STATE, queue=q, active=active, uptime_s=int(time.time() - STATE["started_at"]), **mem), ensure_ascii=False)


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
