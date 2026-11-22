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
  * one shared queue: one generation at a time on the CPU, every other request waits its turn (never refused). First come first served, except that a
    Pro / owner request (`priority` 1) goes ahead of free requests that arrived up to CODER_PRIORITY_BOOST_S (300 s) before it; nobody starves.
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
import itertools
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
_OVR = Path(__file__).resolve().parent / "model.override"      # "<repo> <gguf file> [ctx]": this Studio serves ONLY that model (no fallback to another model)
if _OVR.is_file():
    _parts = _OVR.read_text(encoding="utf-8").split()
    if len(_parts) >= 2:
        MODELS[:] = [(_parts[0], _parts[1])]
        if len(_parts) >= 3 and _parts[2].isdigit():
            os.environ.setdefault("CODER_CTX", _parts[2])
# 65,536 since 2026-10-24: measured on this exact model + llama.cpp build with 2 cores (.github/workflows/nova-ctx-probe.yml), peak memory is
# 5.07 GB at 32k, 6.07 GB at 64k, 7.06 GB at 96k, 8.06 GB at 128k. The Studio has 8 GB in total, so 64k is the highest safe value.
CTX = max(8192, int(os.environ.get("CODER_CTX", "65536")))
THREADS = int(os.environ.get("CODER_THREADS", "0")) or (os.cpu_count() or 2)
PREFIX = os.environ.get("CODER_API_PREFIX", "")
LLAMA_PORT = int(os.environ.get("CODER_LLAMA_PORT", "8081"))
JOB_TTL = 6 * 3600

def _cpu_info() -> dict:
    """What this box's processor offers llama.cpp (model name + the vector features that decide prompt-reading speed); read-only, from /proc/cpuinfo."""
    try:
        txt = open("/proc/cpuinfo").read()
        name = next((l.split(":", 1)[1].strip() for l in txt.splitlines() if l.startswith("model name")), "")
        flags = next((l.split(":", 1)[1].split() for l in txt.splitlines() if l.startswith("flags")), [])
        keep = [f for f in flags if f in ("avx", "avx2", "fma", "f16c", "avx512f", "avx512bw", "avx512vl", "avx512_vnni", "avx512_bf16", "avx_vnni", "amx_tile", "amx_int8", "amx_bf16")]
        return {"cpu": name[:80], "cpu_flags": keep}
    except Exception:
        return {"cpu": "", "cpu_flags": []}


STATE = {**_cpu_info(), "vision": False, "phase": "starting", "detail": "", "model": "", "model_repo": "", "ctx": CTX, "threads": THREADS,
         "llama_build": LLAMA_BUILD, "error": "", "started_at": time.time(), "ready_at": 0}
JOBS: "collections.OrderedDict[str, dict]" = collections.OrderedDict()
JOBS_LOCK = threading.Lock()
# One-at-a-time queue ordered by (arrival time minus the priority boost): a Pro / owner job (priority 1) is served ahead of free jobs that arrived
# up to PRIORITY_BOOST_S before it, and a free job that waited longer than that is never starved. Items: (key, seq, job id).
PRIORITY_BOOST_S = max(0.0, float(os.environ.get("CODER_PRIORITY_BOOST_S", "300") or 300))
QUEUE: "queue.PriorityQueue[tuple]" = queue.PriorityQueue()
_SEQ = itertools.count()


def _job_key(job: dict) -> float:
    if job.get("warm"):
        return float(job.get("created", 0)) + 1e10                 # a background warm-up never stands in front of a person's request
    return float(job.get("created", 0)) - (PRIORITY_BOOST_S if job.get("priority") else 0.0)


def enqueue(jid: str) -> None:
    QUEUE.put((_job_key(JOBS[jid]), next(_SEQ), jid))
_PROC = {"p": None}
_PATHS = {"model": "", "bindir": ""}
_BENCH = {"running": False}


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
_LOCK = {"on": False, "bad": False, "mode": "", "refused": False, "log_at": 0}


def _load_mode(model: Path) -> str:
    """llama.cpp's --load-mode for this box. A model that fills most of the memory (Nova 2: a 12.3 GiB file on a 15.35 GiB Studio) is locked in RAM.
    Measured 2026-11-18 (nova-speed run 44258832132, Studio 16): with plain mmap llama-server took ~2,000 major page faults per short request and its resident
    size fell 12.89 -> 12.09 GB (weights evicted and read back from disk), and the Studio wrote 2-3 tok/s / read 7-8 tok/s against 5.0 / 15.3 for the same file
    on 2 runner cores. CODER_LOAD_MODE overrides it (auto | none | mmap | mlock | mmap+mlock | off); a server that does not start with it is restarted without it."""
    want = os.environ.get("CODER_LOAD_MODE", "auto").strip().lower()
    if want in ("", "off", "default"):
        return ""
    if want != "auto":
        return want
    try:
        total = int(next(l for l in open("/proc/meminfo") if l.startswith("MemTotal")).split()[1]) * 1024
        if model.stat().st_size <= 0.6 * total:
            return ""
        return "none" if _LOCK["refused"] else "mmap+mlock"      # mlock refused by the box: read the weights into the process's own memory instead (no page cache to evict them from)
    except Exception:
        return ""
# Vision (opt-in per Studio): the model's own vision file (mmproj) next to the GGUF lets this Studio read pictures (measured: ~38 s per 448 px picture on 2 cores, +0.7 GB of memory).
# A Studio is a vision Studio when the deploy put a `vision.on` file next to app.py (deploy-modelscope-coder.yml, from ai-system/modelscope-coder/VISION_STUDIOS) or CODER_VISION=on.
# If the server does not come up with it, or it dies while it is on (memory), the next start goes without it (_VIS["bad"]) so a picture never takes a Studio down for good.
MMPROJ_REPO, MMPROJ_FILE = "unsloth/Qwen3.5-4B-GGUF", "mmproj-F16.gguf"
_VIS = {"on": False, "bad": False, "path": ""}


def _vision_wanted() -> bool:
    return not _VIS["bad"] and ((HERE / "vision.on").exists() or os.environ.get("CODER_VISION", "").strip().lower() in ("1", "on", "true", "yes"))


def _download_mmproj() -> str:
    have = next(iter((HERE / "_models").rglob(MMPROJ_FILE)), None) if (HERE / "_models").is_dir() else None
    if have and have.stat().st_size > 100_000_000:
        return str(have)
    from modelscope import snapshot_download
    for anonymous in (False, True):
        if anonymous:
            os.environ.pop("MODELSCOPE_API_TOKEN", None)
            os.environ.pop("MODELSCOPE_TOKEN", None)
        try:
            try:
                d = snapshot_download(MMPROJ_REPO, allow_patterns=[MMPROJ_FILE], cache_dir=str(HERE / "_models"))
            except TypeError:
                d = snapshot_download(MMPROJ_REPO, allow_file_pattern=[MMPROJ_FILE], cache_dir=str(HERE / "_models"))
            p = next(iter(Path(d).rglob(MMPROJ_FILE)), None)
            if p and p.stat().st_size > 100_000_000:
                return str(p)
        except Exception as exc:
            _log("mmproj download:", type(exc).__name__, str(exc)[:120])
    return ""



def _start_server(model: Path, bindir: Path) -> None:
    SLOT_DIR.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, LD_LIBRARY_PATH=f"{bindir}:{os.environ.get('LD_LIBRARY_PATH', '')}")
    cmd = [str(bindir / "llama-server"), "-m", str(model), "-c", str(CTX), "-t", str(THREADS), "-np", "1", "-n", "-1",
           "--jinja", "--alias", "nova-ai", "--cache-ram", os.environ.get("CODER_CACHE_RAM_MB", "1024"), "--slot-save-path", str(SLOT_DIR), "--ctx-checkpoints", os.environ.get("CODER_CTX_CHECKPOINTS", "8"), "--host", "127.0.0.1", "--port", str(LLAMA_PORT)]
    # Opt-in experiment, OFF unless CODER_SPEC is set (e.g. "--spec-type ngram-simple"): speculative decoding from the prompt's own n-grams, no draft model, no extra RAM.
    # If the server then fails to come up, the supervisor starts it again without these flags (_SPEC["bad"]), so the experiment can never take a Studio down.
    # Measured 2026-11-12 (nova-decode-bench.yml, same llama.cpp build and model, 2 cores): ngram-mod writes a file edit / code at 9.3 tokens/s against 3.6 without it (2.6x), free prose
    # is unchanged (3.9), no extra RAM, no draft model; flash attention, a q8 KV cache and bigger batches gave nothing. So it is ON by default, except for a Studio that loads the vision file. CODER_SPEC overrides it ("off" turns it off); a server that does not start with it is restarted without it (the _SPEC["bad"] path below).
    spec = os.environ.get("CODER_SPEC", "").strip()
    if not spec and not _vision_wanted():
        spec = "--spec-type ngram-mod"
    if spec.lower() == "off":
        spec = ""
    lm = "" if _LOCK["bad"] else _load_mode(model)
    if lm:
        cmd += ["--load-mode", lm]
    _LOCK.update(on=bool(lm), mode=lm)
    STATE["load_mode"] = lm or "default"
    if spec and not _SPEC["bad"]:
        cmd += spec.split()
        _SPEC["on"] = True
    else:
        _SPEC["on"] = False
    _VIS["on"] = False
    if _vision_wanted():
        STATE.update(detail="loading the vision file")
        mm = _download_mmproj()
        if mm:
            cmd += ["--mmproj", mm]
            _VIS.update(on=True, path=mm)
        else:
            _VIS["bad"] = True
    STATE["vision"] = bool(_VIS["on"])
    _PATHS.update(model=str(model), bindir=str(bindir))
    try:
        _LOCK["log_at"] = (HERE / "_llama_server.log").stat().st_size
    except OSError:
        _LOCK["log_at"] = 0
    log = open(HERE / "_llama_server.log", "ab")
    _PROC["p"] = subprocess.Popen(cmd, env=env, stdout=log, stderr=log, cwd=str(bindir))


def _supervisor() -> None:
    """Brings the server up, and back up if it ever exits. Never crashes the app: the reason is in `status`."""
    while True:
        try:
            if _PROC["p"] is None or _PROC["p"].poll() is not None:
                if _PROC["p"] is not None and _VIS["on"]:
                    _VIS["bad"] = True                    # the server died while the vision file was loaded (most likely memory): start again without it
                    _log("server exited with vision on; restarting without it")
                if _PROC["p"] is not None and _LOCK["on"]:
                    _LOCK["bad"] = True                   # the server died with the weights locked in RAM (most likely memory): start again with the plain loading
                    _log("server exited with load mode", _LOCK["mode"], "; restarting without it")
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
                if _LOCK["mode"] == "mmap+mlock" and not _LOCK["refused"]:
                    try:
                        with open(HERE / "_llama_server.log", "rb") as fh:
                            fh.seek(_LOCK["log_at"])
                            refused = b"failed to mlock" in fh.read()
                    except OSError:
                        refused = False
                    if refused:                           # llama.cpp only warns: the weights stay evictable. Start once more reading them into its own memory
                        _LOCK["refused"] = True
                        _log("mlock refused; restarting with --load-mode none")
                        _PROC["p"].kill()
                        _PROC["p"].wait(30)
                        _PROC["p"] = None                 # a deliberate restart, not a death: the "died with the load mode" fallback must not fire
                        continue
                STATE.update(phase="ready", detail="", ready_at=time.time())
                _log("ready", STATE["model_repo"], STATE["model"], "ctx", CTX, "threads", THREADS)
        except Exception as exc:
            if _VIS["on"]:
                _VIS["bad"] = True
                _log("vision failed to start; restarting without it")
            if _LOCK["on"]:
                _LOCK["bad"] = True                      # the weights could not be locked in RAM: next start goes with the plain loading, at once
                _log("load mode", _LOCK["mode"], "failed; restarting without it")
            if _SPEC["on"]:
                _SPEC["bad"] = True                      # the experimental flags were on: next start goes without them, at once
                _log("speculative flags failed; restarting without them")
            STATE.update(phase="error", error=f"{type(exc).__name__}: {str(exc)[:300]}")
            _log(traceback.format_exc()[-800:])
            p = _PROC["p"]
            if p is not None and p.poll() is None:
                p.kill()
            _PROC["p"] = None
            time.sleep(5 if (_SPEC["bad"] and _SPEC["on"]) or (_LOCK["bad"] and _LOCK["on"]) else 60)
            continue
        time.sleep(10)


# ---------------------------------------------------------------- conversation state on disk (SessionKV of Sham's memory plan, for llama.cpp's slot save / restore)
# Measured 2026-10-25 (nova-slot-probe.yml, this model, 2 cores): a 1.7k-token conversation = a 267 MB state file; saving 0.09 s, restoring 0.08 s, and a NEW server process that restored it
# read only the 21 new tokens of the follow-up (2.4 s) instead of 84 s from zero. So after every job the conversation's state is saved, and when another conversation (or a restart) has taken the slot,
# the next job of this conversation gets its state back first. The key is the conversation's own start (system + first user message), so the bot needs no change.
# Per Studio only (the file lives on this Studio's disk): it fixes restarts and "another conversation took the slot", not a move to a different Studio.
SLOT_DIR = HERE / "_slots"
SLOTS_ON = os.environ.get("CODER_SLOTS", "on").strip().lower() not in ("0", "off", "false", "no")
SLOT_KEEP = max(1, int(os.environ.get("CODER_SLOT_KEEP", "3") or 3))                 # conversations kept on disk
SLOT_MIN_TOKENS = max(200, int(os.environ.get("CODER_SLOT_MIN_TOKENS", "1500") or 1500))     # shorter ones are cheap to read again
SLOT_MAX_MB = max(100, int(os.environ.get("CODER_SLOT_MAX_MB", "1500") or 1500))     # a state bigger than this is not kept (disk)
_LAST = {"conv": "", "start": ""}                                                    # whose state is in the slot now, and the start it begins with
# 2026-11-16 (nova-base-state-probe.yml, this model, 2 cores): the SHARED START (system + tools, 4.2k tokens in the probe) read from zero takes 346 s; the state saved once (349 MB, 0.1 s) and
# restored into a NEW process lets a DIFFERENT conversation read only its own 19 tokens (2.9 s). So the shared start is kept in its own file, keyed by the hash of the system text + the tool list
# (a different tool list is a different file, never a stale one), and restored first when a fresh server gets a conversation that has no file of its own.
# 2026-11-18: the short "lite" start (greetings: ~300 tokens, no tools) is kept too. Measured (nova-speed.yml, Nova 1 Studio 2) it was read from zero on EVERY greeting: 304 tokens, 14 s
# before the first word (the 35B Nova 2 reads ~9 tokens/s: ~35 s). Restoring a saved state takes ~0.1 s. Starts in use: full / full+GitHub / lite English / lite Arabic, per model.
START_KEEP = max(1, int(os.environ.get("CODER_START_KEEP", "6") or 6))                # shared-start files kept (one per tool list / start text in use)
START_MIN_TOKENS = max(200, int(os.environ.get("CODER_START_MIN_TOKENS", "250") or 250))     # a shorter start is cheap to read again


def _start_key(msgs, tools) -> str:
    sysm = next((m.get("content", "") for m in msgs if isinstance(m, dict) and m.get("role") == "system"), "")
    sysm = sysm if isinstance(sysm, str) else " ".join(str(x.get("text", "")) for x in sysm if isinstance(x, dict))
    import hashlib
    spec = json.dumps(tools or [], sort_keys=True, ensure_ascii=False)
    return hashlib.sha1((sysm[:8000] + "\n" + spec).encode("utf-8", "ignore")).hexdigest()[:20]


def _start_file(key: str):
    return SLOT_DIR / f"_start_{key}.bin"


def _conv_key(msgs) -> str:
    def text(m) -> str:
        c = m.get("content", "") if isinstance(m, dict) else ""
        return c if isinstance(c, str) else " ".join(str(x.get("text", "")) for x in c if isinstance(x, dict))
    sysm = next((text(m) for m in msgs if isinstance(m, dict) and m.get("role") == "system"), "")
    usr = next((text(m) for m in msgs if isinstance(m, dict) and m.get("role") == "user"), "")
    import hashlib
    return hashlib.sha1((sysm[:3000] + "\n" + usr[:3000]).encode("utf-8", "ignore")).hexdigest()[:20]


def _slot_call(action: str, filename: str) -> bool:
    import urllib.request
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{LLAMA_PORT}/slots/0?action={action}", data=json.dumps({"filename": filename}).encode(), headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status == 200
    except Exception as exc:
        _log("slot", action, "failed:", type(exc).__name__, str(exc)[:100])
        return False


def _slot_prune() -> None:
    try:
        files = sorted((f for f in SLOT_DIR.glob("*.bin") if not f.name.startswith("_start_")), key=lambda f: f.stat().st_mtime, reverse=True)
        for f in files[SLOT_KEEP:]:
            f.unlink(missing_ok=True)
        starts = sorted(SLOT_DIR.glob("_start_*.bin"), key=lambda f: f.stat().st_mtime, reverse=True)
        for f in starts[START_KEEP:]:
            f.unlink(missing_ok=True)
    except Exception:
        pass


def _conv_file(job: dict):
    # the conversation's state file carries its start key too: a conversation saved under an OLDER tool list / system text is never restored for a newer one
    # (measured 2026-10-26: such a restore threw the shared start away, 0 of 11,169 tokens reusable)
    conv, start = job.get("conv") or "", job.get("start") or ""
    return SLOT_DIR / (f"{conv}-{start}.bin" if start else f"{conv}.bin")


def _slot_before(job: dict) -> None:
    conv = job.get("conv") or ""
    if not (SLOTS_ON and conv) or _LAST["conv"] == conv:
        return
    start = job.get("start") or ""
    # The live slot already begins with this job's start (system + tools): llama-server's prompt cache reuses it, nothing to restore.
    # Before 2026-11-18 a saved state came back ONLY on a fresh server. Measured that day (nova-speed.yml, Nova 1 Studio 2, 38 h up): once the slot held a DIFFERENT
    # start (a greeting on the short "lite" text, or another chat's tool list), the next full request read its whole 9,074-token start again: 253 s before the first token,
    # against 8 s when the start is shared. So now the saved state is restored whenever the slot holds another start, not only after a restart.
    # This conversation's own saved state (same start, its own turns) always beats the live slot, which holds another conversation.
    f = _conv_file(job)
    if f.is_file() and _slot_call("restore", f.name):
        job["slot_restored"] = True
        _LAST.update(conv=conv, start=start)
        _log("slot restored", conv)
        return
    if _LAST["conv"] and _LAST.get("start") == start:
        return
    if start and _start_file(start).is_file() and _slot_call("restore", _start_file(start).name):       # a conversation never seen here: it still begins with the shared start
        job["slot_restored"] = "start"
        _LAST.update(conv="", start=start)
        _log("shared start restored", start)


def _slot_after(job: dict) -> None:
    conv = job.get("conv") or ""
    if not (SLOTS_ON and conv):
        return
    _LAST.update(conv=conv, start=job.get("start") or "")
    total = int((job.get("prefill") or {}).get("total") or 0)
    if job.get("cancel") or job.get("status") == "error" or total < min(SLOT_MIN_TOKENS, START_MIN_TOKENS):
        return
    SLOT_DIR.mkdir(parents=True, exist_ok=True)
    f = _conv_file(job)
    if _slot_call("save", f.name):
        if f.is_file() and f.stat().st_size > SLOT_MAX_MB * 1048576:
            f.unlink(missing_ok=True)                     # too big for this disk: not kept
        else:
            start = job.get("start") or ""
            if start and total >= START_MIN_TOKENS and f.is_file() and not _start_file(start).is_file():
                try:
                    import shutil
                    shutil.copyfile(f, _start_file(start))      # the saved state begins with the shared start; a different conversation reuses that common part (probe, case 6)
                    _log("shared start kept", start, f"{f.stat().st_size // 1048576} MB")
                except Exception as exc:
                    _log("shared start not kept:", type(exc).__name__, str(exc)[:100])
            if total < SLOT_MIN_TOKENS:
                f.unlink(missing_ok=True)                 # a short conversation is cheap to read again: only its start is kept
            _slot_prune()


# ---------------------------------------------------------------- jobs (shared queue, one generation at a time; FIFO, with a bounded boost for Pro / owner)
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
    if job.get("warm"):                                           # nobody polls a warm-up: only a cancel or the job time limit stop it
        return bool(job.get("cancel")) or bool(job.get("started") and now - job["started"] > JOB_MAX_S)
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


def _llama_faults() -> dict:
    """llama-server's major page faults (model pages read back from disk) and resident size: a box short of memory re-reads the mmapped weights on every token."""
    p = _PROC.get("p")
    out = {}
    try:
        f = open(f"/proc/{p.pid}/stat").read().rsplit(")", 1)[1].split()
        out["majflt"] = int(f[9])                                   # field 12 of /proc/<pid>/stat
        out["rss_gb"] = round(int(open(f"/proc/{p.pid}/statm").read().split()[1]) * os.sysconf("SC_PAGE_SIZE") / 2 ** 30, 2)
    except Exception:
        pass
    for name, path in (("cg_max_gb", "/sys/fs/cgroup/memory.max"), ("cg_now_gb", "/sys/fs/cgroup/memory.current"),
                       ("cg_max_gb", "/sys/fs/cgroup/memory/memory.limit_in_bytes"), ("cg_now_gb", "/sys/fs/cgroup/memory/memory.usage_in_bytes")):
        try:
            v = open(path).read().strip()
            if v.isdigit() and name not in out:
                out[name] = round(int(v) / 2 ** 30, 2)
        except Exception:
            pass
    return out


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
                if not job.get("first_at") and (d.get("content") or d.get("reasoning_content") or d.get("tool_calls")):
                    job["first_at"] = time.time()                    # time to first token, measured here (the speed probe and the bot read it)
                if d.get("content"):
                    job["text"] += d["content"]
                if d.get("reasoning_content"):
                    job["reasoning"] += d["reasoning_content"]
                    if job["think"] and not job["text"] and not calls and len(job["reasoning"]) > (job.get("think_cap") or THINK_CAP_CHARS):
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
                job["timings"] = {k: ev["timings"].get(k) for k in ("prompt_n", "prompt_ms", "prompt_per_second", "cache_n", "predicted_n", "predicted_ms", "predicted_per_second")}
    except (OSError, http.client.HTTPException):
        if not job.get("cancel"):
            raise
    finally:
        done.set()
        conn.close()
    job["tool_calls"] = [calls[i] for i in sorted(calls)]


def _runner() -> None:
    while True:
        jid = QUEUE.get()[-1]
        while _BENCH["running"]:
            time.sleep(1)                                              # a speed measurement (bench) has the box to itself
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
        _slot_before(job)
        f0 = _llama_faults().get("majflt")
        try:
            _stream(job)
            f1 = _llama_faults().get("majflt")
            if f0 is not None and f1 is not None:
                job["majflt"] = f1 - f0                              # weight pages read back from disk during this job (0 = the model stayed in memory)
            job.update(status="cancelled" if job.get("cancel") else "done", finished=time.time())
            _slot_after(job)
        except Exception as exc:
            if job.get("cancel"):
                job.update(status="cancelled", finished=time.time())
                continue
            job.update(status="error", error=f"{type(exc).__name__}: {str(exc)[:300]}", finished=time.time())
        _gc()


def _queue_pos(jid: str) -> int:
    _purge()
    with JOBS_LOCK:
        live = [(k, j) for k, j in JOBS.items() if j["status"] in ("queued", "running") and not j.get("cancel") and (k == jid or not _stale(j))]
        waiting = [k for k, j in sorted(live, key=lambda kj: (kj[1]["status"] != "running", _job_key(kj[1])))]      # the running job first, then the queue's own order
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
    # extra facts only: they never change the type above (2026-11-18: a slot/timing block placed inside this chain turned every pending/done answer into type "error")
    if job.get("started"):
        out["wait_s"] = round(job["started"] - job.get("created", job["started"]), 1)       # queued behind other jobs (or the model loading)
        if job.get("first_at"):
            out["ttft_s"] = round(job["first_at"] - job["started"], 1)                       # prompt reading until the first token
    if job.get("slot_restored"):
        out["restored"] = job["slot_restored"]
    if job.get("majflt") is not None:
        out["majflt"] = job["majflt"]
    return out


def _num(x, default: float) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _think_flag(think) -> "tuple[bool, int]":
    """'1' / 'true' = thinking on with the Studio's default cap; '1:600' = on with that many characters of thought at most (the accuracy mode sets it: fast short, precise long)."""
    t = str(think).strip().lower()
    head, _, cap = t.partition(":")
    on = head in ("1", "true", "yes", "on")
    n = int(cap) if cap.isdigit() else 0
    return on, (max(200, min(6000, n)) if n else 0)


def chat(messages: str, tools: str = "", max_tokens: float = 0, think: str = "", temperature: float = 0.6, wait_s: float = 20, priority: float = 0) -> str:
    """Queue one chat completion; wait up to wait_s (max 50) for it, else answer pending + job id. priority > 0 (Pro / owner) goes ahead in the queue (bounded)."""
    try:
        msgs = json.loads(messages) if isinstance(messages, str) else messages
        tls = json.loads(tools) if isinstance(tools, str) and tools.strip() else (tools or [])
        assert isinstance(msgs, list) and msgs
    except Exception as exc:
        return json.dumps({"type": "error", "error": f"bad messages: {exc}"[:200]})
    jid = uuid.uuid4().hex
    job = {"messages": msgs, "tools": tls, "max_tokens": int(_num(max_tokens, 0)), "think": _think_flag(think)[0], "think_cap": _think_flag(think)[1], "conv": _conv_key(msgs), "start": _start_key(msgs, tls),
           "temperature": _num(temperature, 0.6), "status": "queued", "text": "", "reasoning": "", "created": time.time(),
           "priority": 1 if _num(priority, 0) > 0 else 0}
    with JOBS_LOCK:
        JOBS[jid] = job
        for w in JOBS.values():                                    # a warm-up of ANOTHER start must not hold a person's request; one of the SAME start is kept (the request reuses it)
            if w.get("warm") and w["status"] in ("queued", "running") and w.get("start") != job["start"]:
                w["cancel"] = True
    enqueue(jid)
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


# ---------------------------------------------------------------- warm-up of a shared start (system + tools) while the Studio is idle
# The Studio's disk is new after every restart (the 12 GB model is downloaded again: run log 2026-11-18), so the saved starts are gone and the first request of every
# conversation reads its whole start again: 9,074 tokens = 253 s on Nova 1 (2 cores, 4B), and ~16 min on Nova 2 (35B, ~9 tokens/s). The bot sends its CURRENT start here
# when the Studio does not hold it (status -> starts); the Studio reads it in the background, at the back of the queue, and saves it. A request with the same start
# waits for it and then reads only its own tokens; a request with another start cancels it (a person never waits behind a warm-up).
def warm(messages: str, tools: str = "") -> str:
    try:
        msgs = json.loads(messages) if isinstance(messages, str) else messages
        tls = json.loads(tools) if isinstance(tools, str) and tools.strip() else (tools or [])
        assert isinstance(msgs, list) and msgs
    except Exception as exc:
        return json.dumps({"type": "error", "error": f"bad messages: {exc}"[:200]})
    key = _start_key(msgs, tls)
    if _start_file(key).is_file() or (_LAST.get("start") == key and STATE["phase"] == "ready"):
        return json.dumps({"type": "ready", "start": key})
    with JOBS_LOCK:
        for jid, j in JOBS.items():
            if j.get("start") == key and j["status"] in ("queued", "running") and not j.get("cancel"):
                return json.dumps({"type": "warming", "start": key, "job": jid})
        jid = uuid.uuid4().hex
        JOBS[jid] = {"messages": msgs, "tools": tls, "max_tokens": 1, "think": False, "think_cap": 0, "conv": _conv_key(msgs), "start": key, "temperature": 0.2,
                     "status": "queued", "text": "", "reasoning": "", "created": time.time(), "priority": 0, "warm": True}
    enqueue(jid)
    _log("warm-up queued", key)
    return json.dumps({"type": "warming", "start": key, "job": jid})


def _bench_once(bindir: str, model: str, label: str) -> str:
    """One llama-bench pass over the prompt-reading speed (pp512). Returns the table line and which CPU backend loaded."""
    env = dict(os.environ, LD_LIBRARY_PATH=f"{bindir}:{os.environ.get('LD_LIBRARY_PATH', '')}")
    try:
        r = subprocess.run([str(Path(bindir) / "llama-bench"), "-m", model, "-t", str(THREADS), "-p", "512", "-n", "0", "-r", "1"], env=env, capture_output=True, text=True, timeout=420, cwd=bindir)
        out = (r.stdout or "") + "\n" + (r.stderr or "")
    except Exception as exc:
        return f"{label}: failed {type(exc).__name__}"
    keep = [l.strip()[:200] for l in out.splitlines() if "pp512" in l or "CPU backend" in l or "system_info" in l.lower() or "AMX" in l]
    return f"{label}: " + " | ".join(keep[:4])


def _bench_thread() -> None:
    import shutil
    res = []
    try:
        bindir, model = _PATHS["bindir"], _PATHS["model"]
        res.append(_bench_once(bindir, model, "A default backends"))
        # B: the same files without the Sapphire Rapids / AMX CPU backends (hard links, no copy): what the box reads at without AMX
        alt = HERE / "_bench_noamx"
        shutil.rmtree(alt, ignore_errors=True)
        subprocess.run(["cp", "-al", bindir, str(alt)], check=True, timeout=120)
        for f in alt.rglob("libggml-cpu-*sapphirerapids*.so"):
            f.unlink()
        res.append(_bench_once(str(alt), model, "B without the sapphirerapids backend"))
        shutil.rmtree(alt, ignore_errors=True)
    except Exception as exc:
        res.append(f"failed {type(exc).__name__}: {str(exc)[:120]}")
    finally:
        STATE["bench"] = res
        _BENCH["running"] = False


def bench() -> str:
    """Starts the speed measurement in the background (only when nothing is queued): the answer is in `status` under `bench`."""
    with JOBS_LOCK:
        busy = any(j["status"] in ("queued", "running") for j in JOBS.values())
    if busy or _BENCH["running"] or STATE["phase"] != "ready" or not _PATHS["model"]:
        return json.dumps({"started": False, "reason": "busy or not ready"})
    STATE.pop("bench", None)
    _BENCH["running"] = True
    threading.Thread(target=_bench_thread, daemon=True).start()
    return json.dumps({"started": True})


def status() -> str:
    _purge()
    with JOBS_LOCK:
        q = sum(1 for j in JOBS.values() if j["status"] in ("queued", "running") and not j.get("cancel") and not j.get("warm"))
        now_t = time.time()
        # what is in the queue right now (no text, only facts): lets the bot say WHO is ahead of a step instead of guessing
        active = [dict(status=j["status"], age_s=int(now_t - j.get("created", now_t)), think=bool(j.get("think")), warm=bool(j.get("warm")), cancelled=bool(j.get("cancel")), prompt_chars=len(json.dumps(j.get("messages", []), ensure_ascii=False)),
                       max_tokens=j.get("max_tokens", 0)) for j in JOBS.values() if j["status"] in ("queued", "running")][:8]
    mem = {}
    try:      # the box's real memory, so the context size can be checked against it (kB -> GB)
        info = dict(l.split(":", 1) for l in open("/proc/meminfo").read().splitlines() if ":" in l)
        mem = {"mem_total_gb": round(int(info["MemTotal"].split()[0]) / 1048576, 2), "mem_available_gb": round(int(info["MemAvailable"].split()[0]) / 1048576, 2)}
    except Exception:
        pass
    try:      # the disk the model file lives on (GiB), for the capacity audit
        import shutil
        du = shutil.disk_usage(os.path.dirname(os.path.abspath(__file__)))
        mem["disk"] = {"total_gb": round(du.total / 2 ** 30, 2), "used_gb": round(du.used / 2 ** 30, 2), "free_gb": round(du.free / 2 ** 30, 2)}
    except Exception:
        pass
    try:      # the shared starts this Studio can restore at once (the bot warms its current one when it is missing)
        mem["starts"] = sorted(f.name[len("_start_"):-len(".bin")] for f in SLOT_DIR.glob("_start_*.bin"))
    except Exception:
        mem["starts"] = []
    mem["slot_start"] = _LAST.get("start", "")
    mem["llama"] = _llama_faults()
    return json.dumps(dict(STATE, queue=q, active=active, uptime_s=int(time.time() - STATE["started_at"]), **mem), ensure_ascii=False)


def start_background() -> None:
    threading.Thread(target=_supervisor, daemon=True).start()
    threading.Thread(target=_runner, daemon=True).start()


def generate_tldm(messages_json: str, session: str = "", max_new_tokens: float = 512, tldm_flag: float = 1, confirm_cmd: str = "", confirm_ok: float = 0,
                  deny_list: str = "", owner: float = 0, resume_tool_name: str = "", resume_tool_arguments_json: str = "", resume_tool_result: str = "",
                  resume_tool_error: float = 0, resume_tool_request_id: str = "") -> str:
    """Nova's own T-LDM head (nova_tldm_serve.py): a few-million-parameter head over the frozen features of THIS Studio's own GGUF (a second llama-server in embedding mode on the
    same file). It answers {"type": "text" | "tool_request" | "body" | "error"}. Off unless NOVA_TLDM=1; chat is never affected. Sham and the other models are never used."""
    try:
        import nova_tldm_serve as nt
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"type": "error", "text": f"مسار T-LDM لنوفا غير متاح ({type(exc).__name__}). لم يُستخدم نموذج آخر.", "tldm": True, "fallback": "none"}, ensure_ascii=False)
    if not nt.enabled() or not float(tldm_flag or 0):
        return nt.error_json(nt.missing_message())
    if STATE.get("phase") != "ready" or not _PATHS["model"]:
        return json.dumps({"type": "error", "text": "نوفا يتهيأ بعد. لم يُستخدم نموذج آخر.", "tldm": True, "fallback": "none"}, ensure_ascii=False)
    try:
        msgs = json.loads(messages_json or "[]")
        task = str(msgs[-1]["content"]) if msgs and msgs[-1].get("role") == "user" else ""
    except Exception:  # noqa: BLE001
        return nt.error_json("messages_json غير صالح.")
    if not task and not resume_tool_name:
        return nt.error_json("الرسالة الأخيرة يجب أن تكون من المستخدم.")
    try:
        return nt.respond(str(Path(_PATHS["bindir"]) / "llama-server"), _PATHS["model"], str(session or "default"), task, deny_list=str(deny_list or ""), owner=bool(float(owner or 0)),
                          resume_tool_name=str(resume_tool_name or ""), resume_tool_arguments_json=str(resume_tool_arguments_json or ""), resume_tool_result=str(resume_tool_result or ""),
                          resume_tool_error=bool(float(resume_tool_error or 0)), resume_tool_request_id=str(resume_tool_request_id or ""))
    except Exception as exc:  # noqa: BLE001
        _log("generate_tldm failed", type(exc).__name__, str(exc)[:160])
        return nt.error_json(f"مسار T-LDM لنوفا فشل ({type(exc).__name__}). لم يُستخدم نموذج آخر.")


def build_ui():
    import gradio as gr
    tabs = [
        gr.Interface(chat, [gr.Textbox(label="messages"), gr.Textbox(label="tools"), gr.Number(label="max_tokens", value=0),
                            gr.Textbox(label="think"), gr.Number(label="temperature", value=0.6), gr.Number(label="wait_s", value=20), gr.Number(label="priority", value=0)],
                     gr.Textbox(label="json"), api_name=f"{PREFIX}chat", flagging_mode="never"),
        gr.Interface(job_result, [gr.Textbox(label="job_id"), gr.Number(label="offset", value=0)], gr.Textbox(label="json"),
                     api_name=f"{PREFIX}job_result", flagging_mode="never"),
        gr.Interface(cancel, [gr.Textbox(label="job_id")], gr.Textbox(label="json"), api_name=f"{PREFIX}cancel", flagging_mode="never"),
        gr.Interface(status, None, gr.Textbox(label="status"), api_name=f"{PREFIX}status", flagging_mode="never"),
        gr.Interface(bench, None, gr.Textbox(label="bench"), api_name=f"{PREFIX}bench", flagging_mode="never"),
        gr.Interface(warm, [gr.Textbox(label="messages"), gr.Textbox(label="tools")], gr.Textbox(label="json"), api_name=f"{PREFIX}warm", flagging_mode="never"),
        gr.Interface(generate_tldm, [gr.Textbox(label="messages_json"), gr.Textbox(label="session"), gr.Number(label="max_new_tokens", value=512), gr.Number(label="tldm_flag", value=1),
                                     gr.Textbox(label="confirm_cmd"), gr.Number(label="confirm_ok", value=0), gr.Textbox(label="deny_list"), gr.Number(label="owner", value=0),
                                     gr.Textbox(label="resume_tool_name"), gr.Textbox(label="resume_tool_arguments_json"), gr.Textbox(label="resume_tool_result"),
                                     gr.Number(label="resume_tool_error", value=0), gr.Textbox(label="resume_tool_request_id")],
                     gr.Textbox(label="T-LDM result"), api_name="generate_tldm", flagging_mode="never"),
    ]
    return gr.TabbedInterface(tabs, ["chat", "job_result", "cancel", "status", "bench", "warm", "generate_tldm"], title="coder")


if __name__ == "__main__":
    start_background()
    build_ui().queue(default_concurrency_limit=8).launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", 7860)))
