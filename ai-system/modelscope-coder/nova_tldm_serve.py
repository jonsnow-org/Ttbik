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
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
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
    # the Studio has no settable environment: the deploy workflow writes the marker file nova_tldm.on next to app.py for the Studios listed in NOVA_TLDM_STUDIOS (owner order 2026-11-23: Nova carries T-LDM)
    return os.environ.get("NOVA_TLDM", "0").strip() == "1" or (HERE / "nova_tldm.on").is_file() or (HERE / "tldm_reader.on").is_file()


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


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect is read as data (the storage URL), never followed with the token attached."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


def _http_download(repo: str, pattern: str, dest: Path) -> Path | None:
    """One file straight from the international site with the account's token: the SDK's own route cannot be relied on here
    (live 2026-11-26: its login goes to modelscope.cn while the token and the private head repo are on modelscope.ai, and the
    download then answers 404). A redirect to storage is followed WITHOUT the token, so nothing is sent to the file host."""
    token = os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN") or ""
    if not token or "*" in pattern:
        return None
    site = (os.environ.get("MODELSCOPE_ENDPOINT") or "https://www.modelscope.ai").rstrip("/")
    url = f"{site}/api/v1/models/{repo}/repo?Revision=master&FilePath={pattern}"
    try:
        dest.mkdir(parents=True, exist_ok=True)
        out = dest / pattern
        opener = urllib.request.build_opener(_NoRedirect)
        try:
            with opener.open(urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"}), timeout=60) as r:
                data, status = r.read(), r.status
        except urllib.error.HTTPError as eh:
            if eh.code not in (301, 302, 303, 307, 308):
                raise
            where = eh.headers.get("Location") or ""
            with urllib.request.urlopen(where, timeout=600) as r:      # the storage URL is already signed: no token goes with it
                data, status = r.read(), r.status
        if status != 200 or len(data) < 1000:
            return None
        out.write_bytes(data)
        print(f"nova_tldm: {repo}/{pattern} fetched directly ({len(data) / 1e6:.1f} MB)", flush=True)
        return out
    except Exception as exc:  # noqa: BLE001
        print(f"nova_tldm: direct download {repo}/{pattern} failed ({type(exc).__name__}: {str(exc)[:120]})", flush=True)
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
        return _http_download(repo, pattern, dest)


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


def loop_key(heads: dict) -> str:
    keys = sorted(k for k in heads if str(k).startswith("loop_seed") and isinstance(heads[k], dict))
    return keys[0] if keys else ""


def _text_ids(encode, text: str, n: int) -> list:
    return [i for i in encode(text, n) if i][:n] or [0]


def loop_ids(encode, task: str, hist, n: int) -> list:
    """= train_sham2.loop_ids: the task (first 64 chars -> 32 ids), a newline, then the TAIL of the terminal history."""
    t = _text_ids(encode, task[:64], 32)
    h_text = "".join(f"$ {c}\n> {r}\n" for c, r in hist)
    h = _text_ids(encode, h_text, 4096) if h_text else []
    room = n - len(t) - 1
    return t + _text_ids(encode, "\n", 1) + (h[-room:] if room > 0 else [])


def _load_writer(model_path: str = ""):
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
    sys.path.insert(0, str(HERE / "tldm" / "data"))
    import augment as AUG
    payload = torch.load(str(path), map_location="cpu")
    made_for = str((payload.get("meta") or {}).get("gguf") or "")
    served = Path(model_path).name if model_path else ""
    if made_for and served and made_for.lower() != served.lower():             # review note #1198 §5.4: a head made for another body is refused, never served
        raise RuntimeError(f"the head was made for {made_for} but this Studio serves {served}")
    cfg = payload["cfg"]
    heads = payload["heads"]
    d_in = int(payload["feature_width"])
    block, n = int(cfg["block"]), int(cfg["in_len"])

    def build(state, blk):
        pw = state["proj.weight"]
        if int(pw.shape[1]) != d_in:
            raise RuntimeError(f"head reads width {int(pw.shape[1])}, the head file says {d_in}")
        h = FeatureTLDM(d_in=d_in, d=int(pw.shape[0]), latents=int(cfg.get("latents", 16)), think_steps=int(cfg.get("think_steps", 5)), block=int(blk),
                        writer_layers=int(cfg.get("writer_layers", 3)), heads=int(cfg.get("heads", 4)))
        h.load_state_dict(state, strict=True)
        h.eval()
        return h

    head = build(heads["writer"], block) if isinstance(heads.get("writer"), dict) else None
    lk = loop_key(heads)
    loop = build(heads[lk], int(cfg.get("loop_block", 64))) if lk else None            # the agent-loop head (Sham Pro's recipe, on Nova's own GGUF features)
    if head is None and loop is None:
        raise RuntimeError("the head file has neither a writer nor a loop head")
    tok_path = _download(TOKENIZER_REPO, "tokenizer.json", HERE / "tok")
    if tok_path is None:
        raise RuntimeError("no tokenizer")
    tk = Tokenizer.from_file(str(tok_path))
    # the head reads the features it was TRAINED on: the 35B's final layer (llama-gguf, the embedding server) or Nova's own token_embd rows (gguf-token-embd,
    # the cn trainer's head: no server, read from the same GGUF). Serving one with the other reader's features would be a silent wrong answer, so the kind is followed.
    if str(payload.get("reader") or "") == "gguf-token-embd":
        from sham_tldm.gguf_embed_reader import GgufEmbedReader
        sc = payload.get("feature_scale")
        reader = GgufEmbedReader(model_path, scale=float(sc) if sc else None)
    else:
        reader = LlamaReader(f"http://127.0.0.1:{EMBED_PORT}")
    steps, confident = int(cfg.get("diffusion_steps", 10)), float(cfg.get("confident", 0.0))
    encode = lambda text, k: (tk.encode(text).ids[:k] + [0] * k)[:k]               # noqa: E731  (the trainer's encode: ids padded with 0)

    def write(hd, ids, k):
        h, pad = reader.feats([ids], k)
        with torch.no_grad():
            out, _ = hd.generate(h, pad, steps=steps, confident=confident)
        return decode_bytes(out[0].tolist())

    def writer(task: str, hist) -> str:
        pairs = [(str(x[0]), str(x[1])) for x in (hist or []) if isinstance(x, (list, tuple)) and len(x) >= 2]
        if loop is not None:
            # the multi-step loop: task (argument slots) + the tail of the terminal history -> "$ command" or the final reply, exactly as the loop head was trained
            dt, _, slots = AUG.delex(task or "")
            dh = [(AUG.apply_slots(c, slots), AUG.apply_slots(r, slots)) for c, r in pairs]
            ln = int(cfg.get("loop_in_len", 96))
            return AUG.relex(write(loop, loop_ids(encode, dt, dh, ln), ln), slots)
        if pairs:                                              # no loop head: a command already ran, its result is the reply (the single-command writer writes one command per task)
            return pairs[-1][1].strip() or "Done."
        ids = [i for i in tk.encode(task or "").ids[:n] if i][:n] or [0]
        cmd = write(head, ids, n).strip()
        return cmd if cmd.startswith("$ ") else ("$ " + cmd if cmd else "")

    writer.mode = "loop" if loop is not None else "writer"
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


def load(llama_exe: str, model_path: str, threads: int = 2):
    with _LOCK:
        if _STATE["writer"] is not None:
            embed = _STATE.get("embed")
            if embed is None or embed.poll() is None:
                return _STATE["writer"], ""
            # The feature reader exited (memory, or the box killed it): the head is still loaded and valid, so the reader is restarted and
            # the SAME head keeps serving. Before 2026-11-25 the cached writer was returned as it was and every T-LDM call failed (the reader's
            # HTTP client had nothing to talk to) until the whole Studio was restarted.
            if ensure_embed_server(llama_exe, model_path, threads):
                print("nova_tldm: the feature reader exited and restarted; the loaded head keeps serving", flush=True)
                return _STATE["writer"], ""
            return None, "خادم القراءة الثاني لنوفا توقف ولم يعد يبدأ. لم يُستخدم نموذج آخر."
        bad = _ensure_deps()
        if bad:
            return None, bad + " لم يُستخدم نموذج آخر."
        try:
            if not ensure_embed_server(llama_exe, model_path, threads):
                return None, "خادم القراءة الثاني لنوفا لم يبدأ. لم يُستخدم نموذج آخر."
            _STATE["writer"] = _load_writer(model_path)
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
                with _LOCK:
                    _PENDING[resume_tool_request_id] = pending                  # a wrong answer must not destroy the real request
                return error_json("معاملات الاستكمال لا تطابق الطلب الأصلي.")
        except Exception:  # noqa: BLE001
            with _LOCK:
                _PENDING[resume_tool_request_id] = pending
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

    enc = lambda text, k: ([ord(c) % 250 + 1 for c in text][:k] + [0] * k)[:k]  # noqa: E731
    v = loop_ids(enc, "list files in a" * 9, [("ls", "a.txt")], 96)                # the trained view: <=32 task ids, a newline id, then the TAIL of "$ cmd\n> result\n"
    assert v[:32] == _text_ids(enc, ("list files in a" * 9)[:64], 32) and v[32] == _text_ids(enc, "\n", 1)[0] and v[33:] == _text_ids(enc, "$ ls\n> a.txt\n", 4096)[-63:], v
    assert loop_key({"writer": {}, "loop_seed1": {"a": 1}, "loop_seed0": {"a": 1}}) == "loop_seed0" and loop_key({"writer": {}}) == ""
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
