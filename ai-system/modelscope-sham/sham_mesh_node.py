"""Sham 2 / «شام برو» (Sham Pro) serving side as a node of the terminal mesh (ai-system/terminal/mesh_net.py).

Presence: start_presence() (called by the Studio wrapper at start-up) joins the mesh as soon as the Studio runs: heartbeat, the lesson
index, idle pure jobs. The chat hooks below are reached only from the T-LDM path (sham_tldm_serve.load_chat), which is owner-only during
testing (bot `/tldm on`, app owner switch; later SHAM_TLDM_OPEN). With the mesh attached, each chat's hidden-terminal turn gains, on the chat's OWN embedded computer (ShamEmbeddedBackend,
same approvals, nothing new restricts the owner):
  * recall: the first step of a turn reuses a verified lesson (own or from the mesh, re-vetted) instead of a model call;
  * help from peers: after a failed step, peers PROPOSE a command (first one this node's policy accepts); drive() then runs it on the chat's
    own computer with the usual allow/deny. A peer never runs anything here and nothing of the chat's files/outputs leaves the Studio;
  * knowledge out: a command that ran successfully for a task with no PII is published as a signed lesson;
  * evolution: peer lessons that then succeed here are recorded with source="mesh" (evolution.api.record), still behind consensus + the gate.
Env: SHAM_MESH=0 disables it; SHAM_MESH_URL (default the deployed Worker); SHAM_MESH_NAME (default "sham2");
SHAM_MESH_SERVE_PEERS=1 lets the Studio's model also answer peers' proposal requests (off by default: the same weights serve users).
Offline / relay down: everything works exactly as without the mesh."""
from __future__ import annotations

import os
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODEL_ID = "sham2-tldm"
SELF_NAME = "شام برو"
_STATE: dict = {"net": None, "error": "", "chat": None, "propose": None}
_LOCAL = threading.local()
_MODEL_LOCK = threading.Lock()
_START_LOCK = threading.Lock()


def enabled() -> bool:
    return os.environ.get("SHAM_MESH", "1").strip() != "0"


def _paths() -> None:
    for p in (HERE / "terminal", HERE.parent / "terminal"):
        if p.is_dir() and str(p) not in sys.path:
            sys.path.insert(0, str(p))


def _root() -> Path:
    return Path("/mnt/workspace/sham2_mesh") if Path("/mnt/workspace").is_dir() else HERE / "tldm_mesh"


def _evolution() -> dict:
    root = os.environ.get("SHAM_TLDM_EVOLUTION_ROOT") or ("/mnt/workspace/sham2_tldm_evolution" if Path("/mnt/workspace").is_dir() else str(HERE / "tldm_evolution"))
    return {"root": root, "model_id": MODEL_ID}


def proposer_from(chat):
    """task -> command text from the T-LDM writer (first step, no history), or None. Serialised: one model call at a time from the mesh."""
    write = chat.writer                                    # the unwrapped writer (attach() wraps chat.writer afterwards)

    def propose(task: str):
        if not _MODEL_LOCK.acquire(timeout=1.0):
            return None
        try:
            text = str(write(task, []) or "").strip()
        except Exception:
            return None
        finally:
            _MODEL_LOCK.release()
        return text[2:].strip() if text.startswith("$ ") else None
    return propose


class _LessonTerm:
    """The process node's 'terminal' for lessons only: vets with the strict book policy (what this node accepts from peers); never runs."""

    def __init__(self, folder: Path):
        from sandbox_terminal import SandboxTerminal
        folder.mkdir(parents=True, exist_ok=True)
        self._v = SandboxTerminal(workdir=str(folder))
        self.dir, self.task, self.log_path = str(folder), "", None

    def vet(self, command: str):
        return self._v.vet(command)

    def run(self, command: str, confirm: bool = False):
        from sandbox_terminal import Result
        return Result(command, False, "", 126, refused="the mesh node of the Studio never runs commands itself")


def _first_line(message: str) -> str:
    return (message or "").split("\n", 1)[0].strip()


def _failed(step) -> bool:
    if len(step) >= 3:
        return not step[2]
    out = str(step[1] if len(step) > 1 else "")
    return out.startswith(("denied", "error")) or "refused" in out[:80]


def _serve_peers() -> bool:
    return os.environ.get("SHAM_MESH_SERVE_PEERS", "0").strip() == "1"


def _proposer(task: str):
    """The node's proposer. None until a T-LDM chat is attached AND SHAM_MESH_SERVE_PEERS=1 (the same weights serve users)."""
    p = _STATE.get("propose")
    return p(task) if p is not None else None


FALLBACK_URL = "https://89-168-89-15.sslip.io/api/mesh"     # the site's pass-through to the same Worker (src/app/api/mesh), for hosts that cannot reach workers.dev


def _relay_url(MN) -> str:
    """The first relay this Studio can reach: SHAM_MESH_URL, else the Worker, else the site's pass-through. The reason for each miss is kept."""
    tried = []
    for url in [u for u in (os.environ.get("SHAM_MESH_URL"), MN.DEFAULT_URL, os.environ.get("SHAM_MESH_FALLBACK_URL") or FALLBACK_URL) if u]:
        try:
            import urllib.request
            with urllib.request.urlopen(urllib.request.Request(url.rstrip("/") + "/m/sham2/health", headers=MN.UA), timeout=12) as r:
                if r.status == 200:
                    _STATE["relay"] = url
                    _STATE["relay_misses"] = tried
                    return url
        except Exception as exc:
            tried.append(f"{url.split('/')[2]}: {type(exc).__name__}")
    _STATE["relay_misses"] = tried
    return os.environ.get("SHAM_MESH_URL") or MN.DEFAULT_URL


def _net():
    """The one node of this Studio process (created once; joining runs in the background threads of NetMesh). Raises on a missing module."""
    with _START_LOCK:
        if _STATE.get("net") is not None:
            return _STATE["net"]
        _paths()
        from mesh import Node
        from mesh_crypto import Identity
        import mesh_net as MN
        ident = Identity.load_or_create(str(_root() / "node.key"))
        serve = _serve_peers()
        node = Node(ident.id, _LessonTerm(_root() / "vet"), _proposer, slots=1)
        relay = MN.RelayClient(_relay_url(MN), os.environ.get("SHAM_MESH_NAME", "sham2"), ident)
        net = MN.NetMesh(node, ident, relay, serve_peers=serve, serve_jobs=True, evolution=_evolution(), propose_timeout=12.0).start()
        _STATE.update(net=net, error="")
        return net


def start_presence() -> bool:
    """Join the mesh at Studio start-up (heartbeat, lesson index, idle pure jobs), before any T-LDM chat exists, so Sham 2 is a live node
    whenever its Studio runs. Proposals stay off unless SHAM_MESH_SERVE_PEERS=1 and a T-LDM chat is loaded. Never raises, never blocks
    the caller (the first hello runs in a daemon thread). SHAM_MESH=0 or SHAM_MESH_PRESENCE=0 turns it off."""
    if not enabled() or os.environ.get("SHAM_MESH_PRESENCE", "1").strip() == "0":
        return False

    def go():
        try:
            _net()
        except Exception as exc:
            _STATE["error"] = f"{type(exc).__name__}: {exc}"[:200]
    threading.Thread(target=go, daemon=True, name="sham-mesh-presence").start()
    return True


def attach(chat):
    """Wrap chat.writer / chat.backend_factory once per loaded head. Never raises; on any failure the chat is left untouched."""
    if not enabled() or chat is None or getattr(chat, "_mesh_attached", False):
        return chat
    try:
        net = _net()                                       # reuses the start-up node when start_presence() already joined
        if _serve_peers():
            _STATE["propose"] = proposer_from(chat)
    except Exception as exc:
        _STATE["error"] = f"{type(exc).__name__}: {exc}"[:200]
        return chat
    orig_writer, orig_factory = chat.writer, chat.backend_factory

    def writer(message, hist):
        task = _first_line(message)
        _LOCAL.task = task
        if not hist:
            ls = net.me.recall(task) or net._mesh_recall(net.me, task)
            if ls is not None:
                _LOCAL.via = ("recall", ls.h)
                return "$ " + ls.command
        elif _failed(hist[-1]) and len(hist) <= 3:
            cmd, peer = net.first_proposal(task)
            if cmd and all(cmd != h[0] for h in hist):
                _LOCAL.via = ("peer", peer)
                return "$ " + cmd
        _LOCAL.via = ("model", None)
        with _MODEL_LOCK:
            return orig_writer(message, hist)

    def backend_factory(session: str):
        b = orig_factory(session)
        run = b.run

        def run_and_share(command: str, confirm: bool = False):
            r = run(command, confirm=confirm)
            try:
                task = getattr(_LOCAL, "task", "")
                if getattr(r, "ok", False) and task:
                    via = getattr(_LOCAL, "via", ("model", None))
                    net._publish(task, command)                                     # signed lesson, only after a successful run, only without PII
                    if via[0] == "recall" and via[1] in net.by:
                        net._feed_evolution(task, r, net.by[via[1]])
            except Exception:
                pass
            return r
        b.run = run_and_share
        return b

    for attr in ("hints", "mode"):                         # drive() reads these off the writer (e.g. hints=False: the head was trained on the bare task)
        if hasattr(orig_writer, attr):
            setattr(writer, attr, getattr(orig_writer, attr))
    chat.writer, chat.backend_factory = writer, backend_factory
    chat._mesh_attached = True
    _STATE.update(net=net, chat=chat, error="")
    return chat


def status() -> dict:
    net = _STATE.get("net")
    if net is None:
        return {"enabled": enabled(), "online": False, "error": _STATE.get("error", "")}
    return {"enabled": True, "online": bool(net.online), "relay": str(_STATE.get("relay") or "").split("/")[2:3], "relay_misses": _STATE.get("relay_misses", []), "node": net.ident.id[:12], "peers": len(net.nodes) - 1, "slots": net.slots(),
            "lessons": len(net.pool), "stats": dict(net.stats), "self_name": SELF_NAME}
