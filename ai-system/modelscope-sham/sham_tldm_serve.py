"""T-LDM serving hook for Sham 2 only.

SHAM_TLDM stays off by default. When it is on (Studio env SHAM_TLDM=1, or an owner
request flag on the Sham 2 Studio), this module loads the trained head from the
private repo (default novaai2026/sham2-tldm-head) or SHAM_TLDM_CKPT and runs the
hidden terminal through Sham 2's existing embedded computer (ShamEmbeddedBackend).

If the head is missing or cannot be loaded, a clear error is returned. Nothing
here talks to Sham 1, and there is no silent fallback to the old model.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_REPO = "novaai2026/sham2-tldm-head"
HEAD_FILE = "head_and_adapters.pt"
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
    for cand in (
        HERE / "tldm_head" / HEAD_FILE,
        Path("/mnt/workspace/sham2_tldm") / HEAD_FILE,
    ):
        if cand.is_file():
            return cand
    return None


def download_head(token: str | None = None) -> Path | None:
    """Fetch head_and_adapters.pt from the private ModelScope repo. Returns None if it is not there."""
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
    hit = path / HEAD_FILE if path.is_dir() else path
    if hit.is_file():
        return hit
    found = next(iter(path.rglob(HEAD_FILE)), None) if path.is_dir() else None
    return found if found and found.is_file() else None


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


def build_chat(body, tok, ckpt_path: Path, confirm=None, memory_root: Path | None = None):
    _on_path()
    import torch
    from serve_adapter import TLDMChat
    from sham_binding import ShamEmbeddedBackend

    payload = torch.load(str(ckpt_path), map_location="cpu")
    if not isinstance(payload, dict) or "head_and_adapters" not in payload:
        raise RuntimeError("checkpoint is not a Sham 2 head_and_adapters file")
    cfg = payload.get("cfg") or {}
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
    return chat, ""


def respond(body, tok, session: str, message: str, token: str | None = None, confirm=None) -> str:
    chat, err = load_chat(body, tok, token=token, confirm=confirm)
    if err or chat is None:
        return error_json(err or missing_message())
    reply, _events = chat.respond(session or "default", message)
    return json.dumps({"type": "text", "text": str(reply or ""), "tldm": True}, ensure_ascii=False)


def status_fields() -> dict:
    local = _find_local_head()
    return {
        "tldm": enabled(),
        "tldm_repo": repo_id(),
        "tldm_ckpt": str(local) if local else "",
        "tldm_loaded": bool(_LOADED.get("chat")),
    }


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
