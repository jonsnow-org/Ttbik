"""T-LDM serving hook for Sham 2 only.

SHAM_TLDM stays off by default. When it is on (Studio env SHAM_TLDM=1, or an owner
request flag on the Sham 2 Studio), this module loads the trained head from the
private repo (default novaai2026/sham2-tldm-head) or SHAM_TLDM_CKPT and runs the
hidden terminal through Sham 2's existing embedded computer (ShamEmbeddedBackend).

If the head is missing or cannot be loaded, a clear error is returned. Nothing
here talks to Sham 1, and there is no silent fallback to the old model.

Head files (2026-11-18):
  * sham2_heads.pt (what the trainer Studio publishes, training/train_sham2.py --cached):
    {"cfg", "heads": {"writer", "loop_seed<k>", "identity_lora"}}. writer/loop are FeatureTLDM
    state dicts (proj: body width -> head_d, then the core at head_d) fed the body's final-norm
    hidden states exactly as training's BodyReader reads them. identity_lora is the body's LoRA
    (Sham Pro / «شام برو»); apply_identity() puts it into the live body at server start, for every
    chat, not only T-LDM. No answer is rewritten.
  * head_and_adapters.pt (legacy full-LoRA mode): {"cfg", "head_and_adapters"}; still accepted.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_REPO = "novaai2026/sham2-tldm-head"
HEAD_FILE = "sham2_heads.pt"                 # trainer Studio output (modelscope-trainer/app.py run_sham2)
LEGACY_HEAD_FILE = "head_and_adapters.pt"     # train_sham2.py full-LoRA mode
HEAD_FILES = (HEAD_FILE, LEGACY_HEAD_FILE)
MISSING = (
    "مسار T-LDM لشام 2 غير جاهز: لم يُعثر على رأس التدريب في المستودع الخاص "
    "{repo} (أو في SHAM_TLDM_CKPT). لم يُستخدم شام 1، ولا يوجد تحويل صامت."
)
LOAD_FAIL = (
    "مسار T-LDM لشام 2 تعذّر تحميل رأس التدريب ({why}). لم يُستخدم شام 1، ولا يوجد تحويل صامت."
)


def _on_path() -> None:
    for p in (HERE, HERE / "tldm", HERE / "tldm" / "data", HERE / "tldm" / "memory", HERE / "terminal", HERE / "sham_small"):
        s = str(p)
        if p.is_dir() and s not in sys.path:
            sys.path.insert(0, s)


def enabled() -> bool:
    return os.environ.get("SHAM_TLDM", "0").strip() == "1"


def requested(flag: bool = False) -> bool:
    return enabled() or bool(flag)


def repo_id() -> str:
    return (os.environ.get("SHAM_TLDM_REPO") or DEFAULT_REPO).strip() or DEFAULT_REPO


def ckpt_override() -> str:
    return (os.environ.get("SHAM_TLDM_CKPT") or "").strip()


def missing_message(repo: str | None = None) -> str:
    return MISSING.format(repo=repo or repo_id())


def load_fail_message(why: str) -> str:
    return LOAD_FAIL.format(why=(why or "unknown")[:180])


def error_json(text: str) -> str:
    return json.dumps({"type": "error", "text": text, "tldm": True, "fallback": "none"}, ensure_ascii=False)


def _find_local_head() -> Path | None:
    direct = ckpt_override()
    if direct and os.path.isfile(direct):
        return Path(direct)
    for folder in (HERE / "tldm_head", Path("/mnt/workspace/sham2_tldm")):
        for name in HEAD_FILES:
            cand = folder / name
            if cand.is_file():
                return cand
    return None


def download_head(token: str | None = None) -> Path | None:
    """Fetch the head (sham2_heads.pt, or legacy head_and_adapters.pt) from the private ModelScope repo. None if it is not there."""
    local = _find_local_head()
    if local is not None:
        return local
    tok = (token or os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN") or "").strip()
    repo = repo_id()
    cache = Path(os.environ.get("SHAM_TLDM_CACHE") or (Path("/mnt/workspace/sham2_tldm_cache") if Path("/mnt/workspace").is_dir() else (HERE / "tldm_head_cache")))
    cache.mkdir(parents=True, exist_ok=True)
    try:
        try:
            from modelscope_hub.compat import snapshot_download
        except ImportError:
            from modelscope import snapshot_download  # type: ignore
        path = Path(snapshot_download(repo, cache_dir=str(cache), token=tok or None))
    except Exception:
        return None
    if not path.is_dir():
        return path if path.is_file() else None
    for name in HEAD_FILES:
        hit = path / name
        if hit.is_file():
            return hit
        found = next(iter(sorted(path.rglob(name))), None)
        if found and found.is_file():
            return found
    return None


def _encode(tok, text: str, n: int, pad: int = 0) -> list[int]:
    ids: list[int] = []
    if tok is None:
        ids = list(text.encode("utf-8"))
    elif hasattr(tok, "encode"):
        out = tok.encode(text)
        if hasattr(out, "ids"):
            ids = list(out.ids)
        elif isinstance(out, dict) and "ids" in out:
            ids = list(out["ids"])
        elif isinstance(out, (list, tuple)):
            ids = list(out)
    elif callable(tok):
        try:
            ids = list(tok(text, n))
        except TypeError:
            ids = list(tok(text))
    return (ids[:n] + [pad] * n)[:n]


def _view(task: str, hist) -> str:
    parts = [task or ""]
    for item in hist or []:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            parts.append(f"$ {item[0]}\n{item[1]}")
    return "\n".join(parts)


def _snapshot_adapters(body):
    snaps = []
    for name, param in body.named_parameters():
        if ".adapter_" in name:
            snaps.append((name, param, param.detach().cpu().clone(), bool(param.requires_grad)))
    return snaps


def _restore_adapters(snaps) -> None:
    for name, param, value, rg in snaps:
        param.data.copy_(value.to(param.device, dtype=param.dtype))
        param.requires_grad = rg


def _drop_hooks(body) -> None:
    hook = getattr(getattr(body, "final_norm", None), "_forward_hooks", None)
    if hook is not None:
        hook.clear()


def make_writer(body, tok, cfg: dict, head: dict):
    """Build writer(task, hist) -> text, using a temporary T-LDM head on the live Sham 2 body.

    The live body is not replaced. Adapter weights are snapshotted and restored under the
    Studio lock (the caller holds it). Hooks are removed after the call.
    """
    import torch
    from sham_tldm.model import ShamBodyTLDM, decode_bytes  # noqa: WPS433

    core_sd = {k: v for k, v in head.items() if k.startswith("core.")}
    adapter_sd = {k: v for k, v in head.items() if ".adapter_" in k}
    latents = int(cfg.get("latents", 16))
    think_steps = int(cfg.get("think_steps", 5))
    block = int(cfg.get("block", 32))
    writer_layers = int(cfg.get("writer_layers", 3))
    heads = int(cfg.get("heads", 4))
    in_len = int(cfg.get("in_len", 64))
    steps = int(cfg.get("diffusion_steps", 10))
    pad = int(getattr(getattr(body, "cfg", None), "pad_token_id", 0) or 0)

    def writer(task, hist):
        snaps = _snapshot_adapters(body)
        try:
            model = ShamBodyTLDM(body, latents=latents, think_steps=think_steps, block=block, writer_layers=writer_layers, heads=heads, train_adapters=False)
            if not core_sd:
                raise RuntimeError("checkpoint has no T-LDM core.* weights")
            model.load_state_dict({**core_sd, **adapter_sd}, strict=False)
            ids = torch.tensor([_encode(tok, _view(task, hist), in_len, pad)])
            with torch.no_grad():
                out, _ = model.generate(ids, steps=steps)
            return decode_bytes(out[0] if out.dim() > 1 else out)
        finally:
            _drop_hooks(body)
            _restore_adapters(snaps)
    return writer


def read_payload(path) -> dict:
    """torch.load the head file (tensors + plain cfg only: weights_only) and check it is one of the two known formats."""
    import torch
    try:
        payload = torch.load(str(path), map_location="cpu", weights_only=True)
    except TypeError:                                   # very old torch without weights_only
        payload = torch.load(str(path), map_location="cpu")
    if not isinstance(payload, dict):
        raise RuntimeError("checkpoint is not a Sham 2 head file")
    if isinstance(payload.get("heads"), dict):
        heads = payload["heads"]
        if not isinstance(heads.get("writer"), dict) and not loop_key(heads):
            raise RuntimeError("sham2_heads.pt has no writer or loop head")
        return payload
    if isinstance(payload.get("head_and_adapters"), dict):
        return payload
    raise RuntimeError("checkpoint is not a Sham 2 head file (neither 'heads' nor 'head_and_adapters')")


def loop_key(heads: dict) -> str:
    keys = sorted(k for k in heads if str(k).startswith("loop_seed") and isinstance(heads[k], dict))
    return keys[0] if keys else ""


# ---- identity LoRA: applied to the live body at server start, for every chat ------------------------------------------------
_IDENTITY: dict = {}


def apply_identity(body, path=None, payload: dict | None = None) -> dict:
    """Load heads['identity_lora'] (the body's LoRA trained on data/identity.py: Sham Pro / «شام برو») into the live body's adapters.

    The adapters stay in the body (AdapterLinear: base + low-rank residual, exactly as trained), so every path that runs the
    PyTorch body (generate_chat, the stream, agent_step, T-LDM) answers with it. Nothing is rewritten. Missing head or no
    identity_lora -> the body is unchanged and the status says why. Shapes are all checked before anything is copied."""
    import torch
    status = {"identity_lora": False, "identity_lora_path": str(path or ""), "identity_lora_why": ""}
    try:
        if payload is None:
            if path is None:
                status["identity_lora_why"] = "no head file"
                return _set_identity(status)
            payload = read_payload(path)
        lora = (payload.get("heads") or {}).get("identity_lora") if isinstance(payload.get("heads"), dict) else None
        if not isinstance(lora, dict) or not lora:
            status["identity_lora_why"] = "head file has no identity_lora"
            return _set_identity(status)
        if _IDENTITY.get("identity_lora") and _IDENTITY.get("identity_lora_path") == str(path or "") and _IDENTITY.get("body") == id(body):
            return dict(_IDENTITY)
        downs = [v for k, v in lora.items() if k.endswith(".adapter_down")]
        if not downs:
            raise RuntimeError("identity_lora has no adapter_down tensors")
        rank = int(downs[0].shape[0])
        cfg = payload.get("cfg") or {}
        alpha = float(cfg.get("adapter_alpha", 16.0))          # train_sham2 enables adapters with the model's default alpha (16)
        have = {k for k, _ in body.named_parameters() if ".adapter_" in k}
        if not have:
            body.enable_adapters(rank, alpha)                  # new adapters start as a no-op (adapter_up = 0)
        params = dict(body.named_parameters())
        bad = [k for k, v in lora.items() if k not in params or tuple(params[k].shape) != tuple(v.shape)]
        if bad:
            raise RuntimeError(f"identity_lora does not fit this body ({len(bad)} tensors, e.g. {bad[0]})")
        scale = {round(float(m.scale), 6) for m in body.modules() if hasattr(m, "adapter_down") and hasattr(m, "scale")}
        if scale and scale != {round(alpha / rank, 6)}:
            raise RuntimeError(f"adapter scale {sorted(scale)} != alpha/rank {alpha}/{rank}")
        with torch.no_grad():
            for k, v in lora.items():
                params[k].copy_(v.to(device=params[k].device, dtype=params[k].dtype))
                params[k].requires_grad = False
        status.update(identity_lora=True, identity_lora_tensors=len(lora), identity_lora_rank=rank, body=id(body))
    except Exception as exc:
        status["identity_lora_why"] = f"{type(exc).__name__}: {str(exc)[:160]}"
    return _set_identity(status)


def _set_identity(status: dict) -> dict:
    _IDENTITY.clear()
    _IDENTITY.update(status)
    return dict(status)


def startup_identity(body, token: str | None = None) -> dict:
    """Server start (app._load, Sham 2 only): fetch the head if it is published and apply its identity LoRA. Never raises."""
    try:
        path = download_head(token)
    except Exception as exc:
        return _set_identity({"identity_lora": False, "identity_lora_path": "", "identity_lora_why": f"download: {type(exc).__name__}"})
    return apply_identity(body, path)


# ---- cached-mode heads (FeatureTLDM on the body's final-norm hidden states, as training's BodyReader) ----------------------
def _tok_ids(tok, text: str, n: int) -> list:
    """The tokenizer's ids for text, cut to n (no padding), as train_sham2's donor encode(text, n) before padding."""
    if tok is None:
        ids = list(text.encode("utf-8"))
    elif callable(tok) and not hasattr(tok, "encode"):
        try:
            ids = list(tok(text, n))
        except TypeError:
            ids = list(tok(text))
    else:
        out = tok.encode(text)
        ids = list(getattr(out, "ids", None) or (out.get("ids") if isinstance(out, dict) else out) or [])
    return ids[:n]


def text_ids(tok, text: str, n: int) -> list:
    """= train_sham2.text_ids: pad (0) dropped, at most n, never empty."""
    return [i for i in _tok_ids(tok, text, n) if i][:n] or [0]


def loop_ids(tok, task: str, hist, n: int) -> list:
    """= train_sham2.loop_ids: task (first 64 chars -> 32 ids), a newline, then the TAIL of the terminal history."""
    t = text_ids(tok, task[:64], 32)
    h_text = "".join(f"$ {c}\n> {r}\n" for c, r in hist)
    h = text_ids(tok, h_text, 4096) if h_text else []
    room = n - len(t) - 1
    nl = text_ids(tok, "\n", 1)
    return t + nl + (h[-room:] if room > 0 else [])


class BodyFeatures:
    """Final-norm hidden states of the live body for one id list (its own length, no padding), as train_sham2.BodyReader.
    The hook lives only for the call; the body and its weights (identity LoRA included) are used as they are."""

    def __init__(self, body):
        self.body = body
        self.d = int(body.cfg.d_model)

    def feats(self, ids: list, n: int):
        import torch
        got = []
        handle = self.body.final_norm.register_forward_hook(lambda mod, inp, out: got.append(out))
        try:
            dev = next(self.body.parameters()).device
            with torch.no_grad():
                self.body(torch.tensor([list(ids[:n]) or [0]], device=dev))
        finally:
            handle.remove()
        h = got[-1][0].float().cpu()
        out, pad = torch.zeros(1, n, self.d), torch.ones(1, n, dtype=torch.bool)
        out[0, :len(h)] = h
        pad[0, :len(h)] = False
        return out, pad


def build_feature_head(state: dict, cfg: dict, d_in: int, block: int):
    """Rebuild a FeatureTLDM(d_in=body width, d=head_d) from its state dict; every tensor must match (strict)."""
    from sham_tldm.donor import FeatureTLDM
    pw = state.get("proj.weight")
    if pw is None:
        raise RuntimeError("head has no proj.* input layer (not a cached-mode FeatureTLDM head)")
    if int(pw.shape[1]) != int(d_in):
        raise RuntimeError(f"head reads width {int(pw.shape[1])}, the body has {d_in}")
    head = FeatureTLDM(d_in=int(d_in), d=int(pw.shape[0]), latents=int(cfg.get("latents", 16)), think_steps=int(cfg.get("think_steps", 5)), block=int(block),
                       writer_layers=int(cfg.get("writer_layers", 3)), heads=int(cfg.get("heads", 4)))
    head.load_state_dict(state, strict=True)
    head.eval()
    return head


def make_feature_writer(body, tok, cfg: dict, heads: dict):
    """writer(task, hist) -> "$ <command>" or the reply, from the cached-mode heads.

    loop_seed* (the agent-loop head, trained on task + terminal history with argument slots) drives the loop when present.
    Without it, the single-command writer head writes one command, and the next step returns its result."""
    import augment as AUG
    from sham_tldm.model import decode_bytes
    reader = BodyFeatures(body)
    steps = int(cfg.get("diffusion_steps", 10))
    confident = float(cfg.get("confident", 0.0))
    lk = loop_key(heads)
    loop = build_feature_head(heads[lk], cfg, reader.d, int(cfg.get("loop_block", 64))) if lk else None
    single = build_feature_head(heads["writer"], cfg, reader.d, int(cfg.get("block", 32))) if isinstance(heads.get("writer"), dict) else None

    def write(head, ids, n):
        h, pad = reader.feats(ids, n)
        out, _ = head.generate(h, pad, steps=steps, confident=confident)
        return decode_bytes(out[0].tolist())

    def writer(task, hist):
        pairs = [(str(x[0]), str(x[1])) for x in (hist or []) if isinstance(x, (list, tuple)) and len(x) >= 2]
        if loop is not None:
            dt, _, slots = AUG.delex(task or "")
            dh = [(AUG.apply_slots(c, slots), AUG.apply_slots(r, slots)) for c, r in pairs]
            n = int(cfg.get("loop_in_len", 96))
            return AUG.relex(write(loop, loop_ids(tok, dt, dh, n), n), slots)
        if pairs:
            return pairs[-1][1].strip() or "Done."
        n = int(cfg.get("in_len", 64))
        cmd = write(single, text_ids(tok, task or "", n), n).strip()
        return cmd if cmd.startswith("$ ") else "$ " + cmd

    writer.hints = False          # trained on the bare task: no extra context is appended to it
    writer.mode = "loop" if loop is not None else "writer"
    return writer


def build_chat(body, tok, ckpt_path: Path, confirm=None, memory_root: Path | None = None):
    _on_path()
    from serve_adapter import TLDMChat
    from sham_binding import ShamEmbeddedBackend

    payload = read_payload(ckpt_path)
    cfg = payload.get("cfg") or {}
    if isinstance(payload.get("heads"), dict):
        # the head was trained on the body WITH the identity LoRA: make sure the live body has it (no-op when startup applied it)
        apply_identity(body, ckpt_path, payload)
        writer = make_feature_writer(body, tok, cfg, payload["heads"])
    else:
        writer = make_writer(body, tok, cfg, payload["head_and_adapters"])

    def backend_factory(session: str):
        return ShamEmbeddedBackend(session, model_id="sham_v2")

    memory_factory = None
    if memory_root is not None:
        try:
            from store import memory_for

            def memory_factory(session: str):
                return memory_for(str(memory_root), "sham_v2", session)
        except Exception:
            memory_factory = None
    return TLDMChat(writer, backend_factory, max_steps=int(cfg.get("max_steps", 5)), confirm=confirm, memory_factory=memory_factory, verify=None)


# Process-local cache: the file path we successfully opened (the writer still snapshotted per call).
_LOADED: dict = {}


def load_chat(body, tok, token: str | None = None, confirm=None):
    """-> (chat, error_text). error_text is set when the head cannot be used; chat is then None."""
    path = download_head(token)
    if path is None:
        return None, missing_message()
    key = str(path)
    if _LOADED.get("path") == key and _LOADED.get("chat") is not None:
        return _LOADED["chat"], ""
    try:
        mem = Path(os.environ.get("SHAM_TLDM_MEMORY") or (Path("/mnt/workspace/sham2_tldm_memory") if Path("/mnt/workspace").is_dir() else (HERE / "tldm_memory")))
        chat = build_chat(body, tok, path, confirm=confirm, memory_root=mem)
    except Exception as exc:
        return None, load_fail_message(f"{type(exc).__name__}: {exc}")
    _LOADED.clear()
    _LOADED.update(path=key, chat=chat)
    try:                                                    # terminal mesh node (sham_mesh_node.py); a no-op offline or with SHAM_MESH=0
        import sham_mesh_node
        sham_mesh_node.attach(chat)
    except Exception:
        pass
    return chat, ""


class ApprovalNeeded(Exception):
    """A sensitive command is paused for that chat's allow/deny; it was not run and no sandbox was used."""

    def __init__(self, cmd: str, question: str, hist: list):
        super().__init__(question)
        self.cmd = cmd
        self.question = question
        self.hist = list(hist)


# Per-Studio-process pending approvals, keyed by the chat's T-LDM session (isolated workspace).
_PENDING: dict = {}


def _approval_question(cmd: str, reason: str) -> str:
    try:
        from approvals import question
        return question(cmd, reason)
    except Exception:
        return f"أمر على حاسوب شام برو الداخلي يحتاج موافقتك:\n`{cmd}` ({reason})"


def _flat(r) -> str:
    return ((r.out if getattr(r, "ok", False) else (getattr(r, "refused", None) or getattr(r, "out", "") or "")) or "").strip().replace("\n", " ")


def _denied(cmd: str, reason: str):
    class R:
        ok = False
        out = ""
        needs_confirmation = False
        refused = f"denied by the user: `{cmd}` was not run ({reason})"
    return R()


def _record_step(session: str, message: str, cmd: str, result, t0: float, owner: bool = False) -> None:
    """After the computer ran (or refused) a command: store one anonymised experience record.

    A verifier, when present, supplies verdict. Exit status alone is stored as unknown
    (not learned). This never blocks or changes work-time execution.
    """
    try:
        from sham_tldm_experience import record_command
        ok = bool(getattr(result, "ok", False))
        out = _flat(result)
        refused = str(getattr(result, "refused", "") or "")
        if refused.startswith("denied") or not ok:
            verdict = False
            rc = int(getattr(result, "code", 1) or 1)
        else:
            verdict = None
            rc = int(getattr(result, "code", 0) or 0)
        record_command(session or "anon", message, cmd, rc, stdout=out if ok else "", stderr="" if ok else (refused or out),
                       verdict=verdict, latency_s=max(0.0, time.time() - t0), source="owner" if owner else "user")
    except Exception:
        return


def drive(chat, session: str, message: str, hist=None, pending_cmd=None, approved=None, deny_list=None, owner: bool = False):
    """Hidden-terminal loop on Sham 2's existing embedded computer (ShamEmbeddedBackend / model_computer).

    Sensitive commands pause with ApprovalNeeded so THIS chat can allow or deny.
    Owner deny-list and writes outside the isolated workspace are hard-refused and
    cannot be overridden. The platform owner is exempt: their commands always run.
    Commands are never sent to a separate sandbox.
    """
    backend = chat.backend_factory(session)
    if owner:
        if hasattr(backend, "owner"):
            backend.owner = True
        if hasattr(backend, "deny_list"):
            backend.deny_list = []
    elif deny_list is not None and hasattr(backend, "deny_list"):
        backend.deny_list = list(deny_list)
    hist = list(hist or [])
    max_steps = int(getattr(chat, "max_steps", 5) or 5)
    hint_ctx = ""
    try:
        from sham_tldm_experience import evo_hints
        hint = evo_hints(message)
        hint_ctx = str((hint or {}).get("context") or "").strip()
    except Exception:
        hint_ctx = ""
    if pending_cmd:
        t0 = time.time()
        if approved:
            r = backend.run(pending_cmd, confirm=True)
            ok = bool(getattr(r, "ok", False)) and not str(getattr(r, "refused", "") or "").startswith("denied")
            hist.append((pending_cmd, _flat(r), ok))
            _record_step(session, message, pending_cmd, r, t0, owner=owner)
        else:
            r = _denied(pending_cmd, "denied by the user")
            hist.append((pending_cmd, _flat(r), False))
            _record_step(session, message, pending_cmd, r, t0, owner=owner)
    if not getattr(getattr(chat, "writer", None), "hints", True):
        hint_ctx = ""
    for _ in range(max_steps):
        asked = f"{message}\n{hint_ctx}" if hint_ctx else message
        text = str(chat.writer(asked, hist) or "").strip()
        if not text.startswith("$ "):
            return text, hist
        cmd = text[2:].strip()
        t0 = time.time()
        r = backend.run(cmd)
        if getattr(r, "needs_confirmation", False):
            reason = getattr(r, "refused", None) or "needs approval"
            if isinstance(reason, str) and ": " in reason:
                reason = reason.split(": ", 1)[-1]
            raise ApprovalNeeded(cmd, _approval_question(cmd, reason), hist)
        hist.append((cmd, _flat(r), bool(getattr(r, "ok", False))))
        _record_step(session, message, cmd, r, t0, owner=owner)
    return "I could not finish within the allowed number of steps.", hist


def _parse_deny(raw) -> list:
    try:
        from approvals import parse_deny_list
        return parse_deny_list(raw)
    except Exception:
        if isinstance(raw, list):
            return [str(x) for x in raw]
        return [x.strip() for x in str(raw or "").splitlines() if x.strip() and not x.strip().startswith("#")]


def respond(body, tok, session: str, message: str, token: str | None = None, confirm=None, confirm_cmd: str = "", confirm_ok: bool = False, deny_list=None, owner: bool = False) -> str:
    """Run or resume a T-LDM turn. `confirm` is accepted for compatibility but approvals
    go through confirm_cmd/confirm_ok so THIS chat's allow/deny UI can decide."""
    chat, err = load_chat(body, tok, token=token, confirm=confirm)
    if err or chat is None:
        return error_json(err or missing_message())
    sid = session or "default"
    hist = None
    pending_cmd = None
    approved = None
    deny = [] if owner else _parse_deny(deny_list)
    t0 = time.time()
    if confirm_cmd:
        pending = _PENDING.get(sid)
        if not pending or pending.get("cmd") != confirm_cmd:
            return error_json("انتهت صلاحية طلب الموافقة أو لا يطابق الأمر المنتظر. لم يُنفَّذ الأمر، ولم يُستخدم صندوق معزول.")
        hist = list(pending.get("hist") or [])
        message = pending.get("message") or message
        pending_cmd = confirm_cmd
        approved = bool(confirm_ok)
        _PENDING.pop(sid, None)
    try:
        reply, done_hist = drive(chat, sid, message, hist=hist, pending_cmd=pending_cmd, approved=approved, deny_list=deny, owner=owner)
    except ApprovalNeeded as exc:
        _PENDING[sid] = {"message": message, "hist": exc.hist, "cmd": exc.cmd, "question": exc.question}
        return json.dumps({
            "type": "confirm",
            "text": exc.question,
            "command": exc.cmd,
            "session": sid,
            "tldm": True,
            "computer": "model_computer",
        }, ensure_ascii=False)
    success = bool(reply) and reply != "I could not finish within the allowed number of steps."
    steps = done_hist or []
    if steps:
        try:
            from sham_tldm_experience import log_episode
            log_episode(message, str(reply or ""), steps, success, time.time() - t0, verified=True, session=sid, source="owner" if owner else "user")
        except Exception:
            pass
    return json.dumps({"type": "text", "text": str(reply or ""), "tldm": True, "computer": "model_computer"}, ensure_ascii=False)


def status_fields() -> dict:
    local = _find_local_head()
    head = str(_IDENTITY.get("identity_lora_path") or "") or (str(local) if local else "")
    return {
        "tldm": enabled(),
        "tldm_repo": repo_id(),
        "tldm_ckpt": str(local) if local else "",
        "tldm_head": bool(head),
        "tldm_loaded": bool(_LOADED.get("chat")),
        "identity_lora": bool(_IDENTITY.get("identity_lora")),
        "identity_lora_why": str(_IDENTITY.get("identity_lora_why") or ""),
        "tldm_mesh": _mesh_status(),
    }


def _mesh_status() -> dict:
    try:
        import sham_mesh_node
        return sham_mesh_node.status()
    except Exception as exc:
        return {"enabled": False, "error": type(exc).__name__}


if __name__ == "__main__":
    # Self-test: no network, no weights, no fallback.
    assert enabled() is False
    os.environ["SHAM_TLDM"] = "1"
    assert enabled() is True and requested(False) is True
    os.environ.pop("SHAM_TLDM", None)
    assert requested(True) is True and requested(False) is False
    assert DEFAULT_REPO in missing_message()
    assert "شام 1" in missing_message() and "تحويل صامت" in missing_message()
    err = json.loads(error_json(missing_message()))
    assert err["type"] == "error" and err["fallback"] == "none" and "شام 1" in err["text"]
    os.environ["SHAM_TLDM_CKPT"] = "/tmp/does-not-exist-sham2-head.pt"
    assert _find_local_head() is None
    os.environ.pop("SHAM_TLDM_CKPT", None)
    print("sham_tldm_serve self-test ok")
