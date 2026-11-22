"""Nova's own T-LDM head, served from Nova's own Studio (owner 2026-11-22: every model carries its own T-LDM; nothing shared with another model).

What it does: a small trained head (a few million parameters) reads the FROZEN features of Nova's own body (the Qwen3.6-35B-A3B GGUF this Studio already serves,
read through a second llama-server in embedding mode on the SAME file: the weights are memory-mapped, so only its compute buffers are extra) and writes the next block:
    "$ <command>"       -> a command for Nova's computer. The head never runs it: this module answers {"type": "tool_request", "tool_name": "computer_run", ...} and the APP runs it
                           on Nova's own computer under Nova's own confirmation rules, then resumes the turn with the result (resume_tool_*), like every other Nova tool.
    "$ @tool NAME {...}" -> one of Nova's read tools (web_search, github_read_file, ...), the same way.
    anything else        -> {"type": "text", "text": <the reply>}.
    nothing usable       -> {"type": "body"}: the head has no answer for this task, so Nova's OWN body (this Studio's normal chat) answers. That is the same model, not a fallback to another one.

Independence: imports nothing from Sham or from another model; the head, its repo and its sessions carry Nova's name. Off unless NOVA_TLDM=1 and a head exists: until then the
endpoint answers an honest error naming Nova (never another model).
"""
from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
EMBED_PORT = int(os.environ.get("NOVA_TLDM_EMBED_PORT", "8099"))
DEFAULT_REPO = "Jonjithup/nova2-tldm-head"
HEAD_FILE = "nova2_heads.pt"
TOKENIZER_REPO = os.environ.get("NOVA_TLDM_TOKENIZER_REPO", "Qwen/Qwen3.6-35B-A3B")

# Nova's read tools a head may call by name (the app owns the real implementations, GitHub tokens and confirmations).
READ_TOOLS = {"web_search", "fetch_page", "deep_research", "github_list_files", "github_read_file", "github_read_files", "github_search_code", "github_repo_scan", "github_prs", "github_ci_status"}

_PENDING: dict = {}                 # request id -> {session, message, hist, tool, arguments, at}: several requests of one session can wait at once (review note #1198 §5.7); each is used once
_PENDING_TTL_S, _PENDING_MAX = 3600, 200
_STATE: dict = {"writer": None, "err": "", "reader": None, "embed": None}
_LOCK = threading.Lock()


def enabled() -> bool:
    return os.environ.get("NOVA_TLDM", "0").strip() == "1"


def error_json(text: str) -> str:
    return json.dumps({"type": "error", "text": text, "tldm": True, "fallback": "none"}, ensure_ascii=False)


def missing_message() -> str:
    return "مسار T-LDM لنوفا غير جاهز بعد (الرأس غير منشور أو الخادم لم يُفعَّل). لم يُستخدم نموذج آخر."


# ------------------------------------------------------------------ the head and the reader
def _find_head() -> Path | None:
    for cand in (os.environ.get("NOVA_TLDM_HEAD", ""), str(HERE / HEAD_FILE), "/mnt/workspace/" + HEAD_FILE):
        if cand and Path(cand).is_file():
            return Path(cand)
    return None


def _download(repo: str, pattern: str, dest: Path) -> Path | None:
    token = os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN") or None
    try:
        from modelscope import snapshot_download
        got = Path(snapshot_download(repo, allow_patterns=[pattern], local_dir=str(dest), token=token) if token else snapshot_download(repo, allow_patterns=[pattern], local_dir=str(dest)))
        hit = next(iter(got.rglob(pattern.replace("*", "")) if "*" in pattern else [got / pattern]), None)
        return hit if hit and hit.is_file() else None
    except Exception as exc:  # noqa: BLE001
        print(f"nova_tldm: download {repo}/{pattern} failed ({type(exc).__name__}: {str(exc)[:120]})", flush=True)
        return None


def ensure_embed_server(llama_exe: str, model_path: str, threads: int = 2) -> bool:
    """Starts llama-server in embedding mode on the SAME GGUF (mmap: the weights are shared with the chat server). Idempotent; False when it could not start."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{EMBED_PORT}/health", timeout=3) as r:
            if r.status == 200:
                return True
    except Exception:
        pass
    if _STATE["embed"] is not None and _STATE["embed"].poll() is None:
        return _wait_health()
    cmd = [llama_exe, "-m", model_path, "--embeddings", "--pooling", "none", "-c", "512", "-ngl", "0", "-t", str(threads), "--host", "127.0.0.1", "--port", str(EMBED_PORT)]
    log = open(HERE / "embed_server.log", "ab")
    _STATE["embed"] = subprocess.Popen(cmd, stdout=log, stderr=log, cwd=str(Path(llama_exe).parent))
    return _wait_health()


def _wait_health(seconds: int = 240) -> bool:
    end = time.time() + seconds
    while time.time() < end:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{EMBED_PORT}/health", timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(2)
    return False


def _load_writer():
    """-> writer(task, hist) built from the published head and the embedding reader, or raises with an honest reason."""
    path = _find_head()
    if path is None:
        path = _download(os.environ.get("NOVA_TLDM_REPO", DEFAULT_REPO), HEAD_FILE, HERE / "head")
    if path is None:
        raise RuntimeError("no head file")
    import torch
    sys.path.insert(0, str(HERE / "tldm"))
    from sham_tldm.donor import FeatureTLDM
    from sham_tldm.llama_reader import LlamaReader
    from sham_tldm.model import decode_bytes
    from tokenizers import Tokenizer
    payload = torch.load(str(path), map_location="cpu")
    cfg = payload["cfg"]
    state = payload["heads"]["writer"]
    d_in = int(payload["feature_width"])
    block, n = int(cfg["block"]), int(cfg["in_len"])
    pw = state["proj.weight"]
    head = FeatureTLDM(d_in=d_in, d=int(pw.shape[0]), latents=int(cfg.get("latents", 16)), think_steps=int(cfg.get("think_steps", 5)), block=block,
                       writer_layers=int(cfg.get("writer_layers", 3)), heads=int(cfg.get("heads", 4)))
    head.load_state_dict(state, strict=True)
    head.eval()
    tok_path = _download(TOKENIZER_REPO, "tokenizer.json", HERE / "tok")
    if tok_path is None:
        raise RuntimeError("no tokenizer")
    tk = Tokenizer.from_file(str(tok_path))
    reader = LlamaReader(f"http://127.0.0.1:{EMBED_PORT}")
    steps, confident = int(cfg.get("diffusion_steps", 10)), float(cfg.get("confident", 0.0))

    def writer(task: str, hist) -> str:
        pairs = [(str(x[0]), str(x[1])) for x in (hist or []) if isinstance(x, (list, tuple)) and len(x) >= 2]
        if pairs:                                              # a command already ran: its result is the reply (the single-command writer head writes one command per task)
            return pairs[-1][1].strip() or "Done."
        ids = [i for i in tk.encode(task or "").ids[:n] if i][:n] or [0]
        h, pad = reader.feats([ids], n)
        with torch.no_grad():
            out, _ = head.generate(h, pad, steps=steps, confident=confident)
        cmd = decode_bytes(out[0].tolist()).strip()
        return cmd if cmd.startswith("$ ") else ("$ " + cmd if cmd else "")

    return writer


def _ensure_deps() -> str:
    """torch (CPU), numpy and tokenizers are installed on FIRST use, not in requirements.txt: a failed install must only cost the T-LDM endpoint, never the Studio's chat build."""
    try:
        import numpy, tokenizers, torch  # noqa: F401,E401
        return ""
    except ImportError:
        pass
    target = str(HERE / "_pydeps")
    for args in (["torch", "--index-url", "https://download.pytorch.org/whl/cpu"], ["numpy", "tokenizers"]):
        r = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--no-input", "--target", target, *args], capture_output=True, text=True, timeout=1500)
        if r.returncode != 0:
            return f"تثبيت اعتماديات T-LDM لنوفا فشل ({args[0]}): {r.stderr.strip()[-160:]}"
    sys.path.insert(0, target)
    try:
        import numpy, tokenizers, torch  # noqa: F401,E401
        return ""
    except Exception as exc:  # noqa: BLE001
        return f"اعتماديات T-LDM لنوفا لم تُحمَّل ({type(exc).__name__})."


def load(llama_exe: str, model_path: str):
    with _LOCK:
        if _STATE["writer"] is not None:
            return _STATE["writer"], ""
        bad = _ensure_deps()
        if bad:
            return None, bad + " لم يُستخدم نموذج آخر."
        try:
            if not ensure_embed_server(llama_exe, model_path):
                return None, "خادم القراءة الثاني لنوفا لم يبدأ. لم يُستخدم نموذج آخر."
            _STATE["writer"] = _load_writer()
            return _STATE["writer"], ""
        except Exception as exc:  # noqa: BLE001
            return None, f"مسار T-LDM لنوفا لم يُحمَّل ({type(exc).__name__}: {str(exc)[:160]}). لم يُستخدم نموذج آخر."


# ------------------------------------------------------------------ one turn
def _parse_deny(raw) -> list:
    return [x.strip() for x in str(raw or "").splitlines() if x.strip() and not x.strip().startswith("#")]


def _denied(cmd: str, deny: list) -> bool:
    low = cmd.lower()
    return any(d.lower() in low for d in deny)


def drive(writer, session: str, message: str, hist: list, deny: list, owner: bool):
    """-> ("text", reply) | ("tool", name, arguments, hist) | ("body", "") ."""
    for _ in range(5):
        text = str(writer(message, hist) or "").strip()
        if not text:
            return ("body", "", hist)                              # the head wrote nothing usable: Nova's own body answers
        if not text.startswith("$ "):
            return ("text", text, hist)
        cmd = text[2:].strip()
        if cmd.startswith("@tool"):
            parts = cmd.split(" ", 2)
            try:
                if len(parts) != 3:
                    raise ValueError("format must be: $ @tool <name> <JSON object>")
                name, args = parts[1].strip(), json.loads(parts[2])
                if not isinstance(args, dict):
                    raise ValueError("arguments must be a JSON object")
            except Exception as exc:  # noqa: BLE001
                hist.append(("@tool", "error: invalid tool request: " + str(exc)[:160], False))
                continue
            if name not in READ_TOOLS:
                hist.append(("@tool " + name, "error: not available through T-LDM", False))
                continue
            return ("tool", name, args, hist)
        if not owner and _denied(cmd, deny):
            hist.append((cmd, "denied: this command is on the owner's list", False))
            continue
        return ("tool", "computer_run", {"command": cmd}, hist)
    return ("text", "لم أستطع إكمال المهمة ضمن عدد الخطوات المسموح.", hist)


def respond(llama_exe: str, model_path: str, session: str, message: str, deny_list: str = "", owner: bool = False,
            resume_tool_name: str = "", resume_tool_arguments_json: str = "", resume_tool_result: str = "", resume_tool_error: bool = False,
            resume_tool_request_id: str = "") -> str:
    writer, err = load(llama_exe, model_path)
    if writer is None:
        return error_json(err or missing_message())
    sid = session or "default"
    hist: list = []
    if resume_tool_name:
        with _LOCK:
            pending = _PENDING.get(resume_tool_request_id)
            if pending and (pending.get("session") != sid or pending.get("tool") != resume_tool_name):
                pending = None                                      # another session's request, or another tool: it is neither answered nor consumed
            elif pending:
                _PENDING.pop(resume_tool_request_id, None)          # consumed exactly once: a second resume of the same request finds nothing
        if not pending:
            return error_json("انتهت صلاحية طلب الأداة أو استُكمل من قبل أو لا يطابق الجلسة. لم تُنفَّذ أداة بديلة.")
        try:
            if json.loads(resume_tool_arguments_json or "{}") != pending["arguments"]:
                return error_json("معاملات الاستكمال لا تطابق الطلب الأصلي.")
        except Exception:  # noqa: BLE001
            return error_json("تعذّر التحقق من معاملات الأداة.")
        hist = list(pending["hist"])
        message = pending["message"] or message
        call = pending["tool"] + " " + json.dumps(pending["arguments"], ensure_ascii=False, sort_keys=True)
        hist.append((call if pending["tool"] != "computer_run" else pending["arguments"].get("command", call), str(resume_tool_result or "")[:8000], not resume_tool_error))
    out = drive(writer, sid, message, hist, [] if owner else _parse_deny(deny_list), owner)
    if out[0] == "tool":
        _, name, args, h = out
        rid = secrets.token_hex(12)
        with _LOCK:
            now = time.time()
            for k in [k for k, v in _PENDING.items() if now - v.get("at", 0) > _PENDING_TTL_S]:
                _PENDING.pop(k, None)
            while len(_PENDING) >= _PENDING_MAX:                    # a bounded table: the oldest abandoned request goes first
                _PENDING.pop(min(_PENDING, key=lambda k: _PENDING[k].get("at", 0)), None)
            _PENDING[rid] = {"session": sid, "message": message, "hist": h, "tool": name, "arguments": args, "at": now}
        return json.dumps({"type": "tool_request", "tool_name": name, "tool_arguments": args, "tool_request_id": rid, "session": sid, "tldm": True}, ensure_ascii=False)
    if out[0] == "body":
        return json.dumps({"type": "body", "tldm": True}, ensure_ascii=False)
    return json.dumps({"type": "text", "text": out[1], "tldm": True}, ensure_ascii=False)


if __name__ == "__main__":
    # self-test: no network, no weights
    assert enabled() is False
    os.environ["NOVA_TLDM"] = "1"
    assert enabled() is True
    os.environ.pop("NOVA_TLDM", None)
    assert "نوفا" in missing_message() and json.loads(error_json("x"))["fallback"] == "none"

    seq = iter(["$ ls -la", "نتيجة", "", "$ @tool web_search {\"query\": \"x\"}", "$ @tool rm {}", "$ rm -rf /"])
    w = lambda t, h: next(seq)  # noqa: E731
    r = drive(w, "s", "list files", [], [], False)
    assert r[0] == "tool" and r[1] == "computer_run" and r[2] == {"command": "ls -la"}, r
    assert drive(w, "s", "q", [], [], False)[:2] == ("text", "نتيجة")
    assert drive(w, "s", "q", [], [], False)[0] == "body"
    r = drive(w, "s", "q", [], [], False)
    assert r[0] == "tool" and r[1] == "web_search" and r[2] == {"query": "x"}, r
    seq2 = iter(["$ @tool rm {}", "تم"])
    assert drive(lambda t, h: next(seq2), "s", "q", [], [], False)[:2] == ("text", "تم")           # an unavailable tool is refused inside the loop, the head tries again
    seq3 = iter(["$ rm -rf /", "لا"])
    assert drive(lambda t, h: next(seq3), "s", "q", [], ["rm -rf"], False)[:2] == ("text", "لا")   # the owner's list blocks it for users
    seq4 = iter(["$ rm -rf /"])
    assert drive(lambda t, h: next(seq4), "s", "q", [], ["rm -rf"], True)[0] == "tool"              # not for the owner
    # two requests of ONE session wait together, each is answered once, and another session cannot answer them
    class _W:
        def __init__(self): self.q = iter(["$ ls", "$ pwd", "ok-a", "ok-b"])
        def __call__(self, t, h): return next(self.q)
    _STATE["writer"] = _W()
    def _first(msg):
        return json.loads(respond("x", "y", "S", msg))
    a, b = _first("m1"), _first("m2")
    assert a["type"] == b["type"] == "tool_request" and a["tool_request_id"] != b["tool_request_id"] and len(_PENDING) == 2
    bad = json.loads(respond("x", "y", "OTHER", "", resume_tool_name="computer_run", resume_tool_arguments_json=json.dumps(a["tool_arguments"]), resume_tool_result="r", resume_tool_request_id=a["tool_request_id"]))
    assert bad["type"] == "error" and len(_PENDING) == 2                                          # another session: refused and NOT consumed
    ok = json.loads(respond("x", "y", "S", "", resume_tool_name="computer_run", resume_tool_arguments_json=json.dumps(a["tool_arguments"]), resume_tool_result="r", resume_tool_request_id=a["tool_request_id"]))
    assert ok["type"] == "text" and len(_PENDING) == 1
    again = json.loads(respond("x", "y", "S", "", resume_tool_name="computer_run", resume_tool_arguments_json=json.dumps(a["tool_arguments"]), resume_tool_result="r", resume_tool_request_id=a["tool_request_id"]))
    assert again["type"] == "error"                                                              # a second resume of the same request does nothing
    print("nova_tldm_serve self-test ok")
