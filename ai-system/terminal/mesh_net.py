"""The terminal mesh over a real network: every user's terminal is a node (server AND client); a free Cloudflare Worker + Durable Object
(cloudflare/sham-mesh-worker.js, https://sham-mesh.jonsnowx1r.workers.dev) is only the rendezvous / relay.

    from mesh_net import NetMesh, RelayClient
    from mesh_crypto import Identity
    ident = Identity.load_or_create("~/.sham_mesh/key")                     # node id = ed25519 public key
    me = Node(ident.id, SandboxTerminal(workdir), proposer, slots=2)          # mesh.Node, unchanged
    net = NetMesh(me, ident, RelayClient(URL, "sham2", ident)).start()       # joins; falls back to alone/offline silently
    net.ask("count the lines in the log")                                    # recall | mesh-recall | local | race | none

What each node gives and gets (the reports' "every new user adds compute and knowledge"):
  * KNOWLEDGE: verified lessons (task, command) signed by the node that ran them successfully; a newcomer pulls the whole index on join.
    Every receiver re-verifies the signature and the hash, re-vets the command with ITS OWN policy (+ the owner deny list and the adversarial
    patterns of the evolution pipeline) and reports a refused lesson to the relay (3 distinct reports hide it for everybody).
    Accepted lessons that then really run in the receiver's own sandbox feed evolution.api.record(source="mesh"), so they reach
    training_pairs() only through the usual consensus + PII + deny checks and, later, the adapter no-regression gate.
  * ADAPTERS: LoRA adapter files are announced with (family, version, sha256, size, base model, metrics) signed by the publisher and fetched
    peer-to-peer through the relay (or from a public URL); the receiver checks hash + signature and runs ITS OWN gate before installing.
  * COMPUTE: (1) hedged race: when the local proposal fails, up to `hedge` peers PROPOSE at once and the first command that really succeeds in
    MY sandbox wins; (2) idle jobs: pure eval / training-shard jobs whose results the requester verifies (spot-check recompute, redundancy,
    or local run) before accepting; a forged result is rejected and its sender distrusted.
Safety rules kept from mesh.py: a peer only proposes text, nobody executes for anybody else; no file, output or result of a user's command ever
leaves a node; a task is sent to peers only if the PII scrubber finds nothing in it; with no relay / no peers / no network everything still works
alone. The relay is not trusted: all bodies are signed end to end (mesh_crypto). Signed objects carry ints/strings only (no floats).
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import queue
import random
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mesh import Mesh, Node, Lesson, SECRETISH, norm, similarity  # noqa: E402
from mesh_crypto import Identity, canon, verify_obj, sha256_file  # noqa: E402
from sandbox_terminal import SandboxTerminal  # noqa: E402

DEFAULT_URL = os.environ.get("SHAM_MESH_URL", "https://sham-mesh.jonsnowx1r.workers.dev")
UA = {"user-agent": "sham-mesh-client/1"}         # Cloudflare answers 403 to the default Python-urllib agent
CHUNK = 96 * 1024


def _evo():
    """The evolution package (ai-system/tldm/evolution) when it is present; None on a bare device."""
    for p in (os.path.join(HERE, "..", "tldm", "evolution"), os.path.join(HERE, "..", "evolution"), os.path.join(HERE, "..", "tldm", "tldm", "evolution")):
        if os.path.isfile(os.path.join(p, "api.py")) and p not in sys.path:
            sys.path.insert(0, os.path.abspath(p))
    try:
        import api as evo_api  # noqa: F401
        import experience as evo_ex  # noqa: F401
        return evo_api, evo_ex
    except Exception:
        return None, None


def shareable(text: str) -> bool:
    """True if `text` may leave this node: nothing secret-looking, and the evolution PII scrubber changes nothing."""
    if not text or SECRETISH.search(text):
        return False
    _, ex = _evo()
    if ex is not None:
        try:
            return ex.scrub(text) == text and not ex.has_pii(text)
        except Exception:
            return False
    return True


def lesson_hash(task: str, command: str) -> str:
    return Lesson(task, command).h


class MeshError(Exception):
    pass


# =================================================================== transports
class RelayClient:
    """HTTP client of the sham-mesh Worker. Every request is signed (x-mesh-node / x-mesh-ts / x-mesh-sig). stdlib only."""

    def __init__(self, url: str, mesh: str, ident: Identity, timeout: float = 15.0):
        self.base = url.rstrip("/") + "/m/" + mesh + "/"
        self.root = url.rstrip("/")
        self.ident, self.timeout = ident, timeout

    def _req(self, method: str, route: str, body=None, query: str = "", timeout: float | None = None) -> dict:
        data = b"" if body is None else json.dumps(body, ensure_ascii=False).encode()
        url = self.base + route + (("?" + query) if query else "")
        # signed path is relative to the relay root, so a proxy mount (e.g. https://site/api/mesh -> the Worker) verifies the same bytes
        pathq = urllib.request.urlparse(url).path[len(urllib.request.urlparse(self.root).path.rstrip("/")):] + (("?" + query) if query else "")
        ts = str(int(time.time() * 1000))
        msg = f"{method}\n{pathq}\n{ts}\n{hashlib.sha256(data).hexdigest()}".encode()
        req = urllib.request.Request(url, data=data if method != "GET" else None, method=method, headers={
            "content-type": "application/json", "x-mesh-node": self.ident.id, "x-mesh-ts": ts, "x-mesh-sig": self.ident.sign(msg),
            "user-agent": "sham-mesh-client/1"})
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                why = json.loads(e.read()).get("error", "")
            except Exception:
                why = ""
            raise MeshError(f"{e.code} {why}".strip()) from None
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise MeshError(f"offline: {type(e).__name__}") from None

    def health(self) -> dict:
        with urllib.request.urlopen(urllib.request.Request(self.base + "health", headers=UA), timeout=self.timeout) as r:
            return json.loads(r.read())

    def hello(self, slots: int, caps: dict) -> dict:
        return self._req("POST", "hello", {"slots": int(slots), "caps": caps})

    def bye(self) -> dict:
        return self._req("POST", "bye", {})

    def peers(self) -> list:
        return self._req("GET", "peers").get("peers", [])

    def send(self, to, kind: str, body: dict) -> int:
        return int(self._req("POST", "send", {"to": to, "kind": kind, "body": body}).get("delivered", 0))

    def poll(self, wait: int = 20) -> list:
        return self._req("GET", "poll", query=f"wait={int(wait)}", timeout=wait + 15).get("msgs", [])

    def put_lesson(self, lesson: dict) -> dict:
        return self._req("POST", "lessons", {"lesson": lesson})

    def lessons(self, since: int = 0, limit: int = 200) -> dict:
        return self._req("GET", "lessons", query=f"since={int(since)}&limit={int(limit)}")

    def report(self, h: str, why: str) -> dict:
        return self._req("POST", "report", {"h": h, "why": why[:200]})

    def put_adapter(self, entry: dict) -> dict:
        return self._req("POST", "adapters", {"adapter": entry})

    def adapters(self, since: int = 0) -> dict:
        return self._req("GET", "adapters", query=f"since={int(since)}")


class LocalHub:
    """In-process stand-in for the Worker (same semantics, no network): offline unit tests and a LAN/single-host mesh."""

    def __init__(self):
        self.lock, self.cv = threading.Lock(), threading.Condition()
        self.nodes, self.boxes, self.lessons, self.reports, self.adapters = {}, {}, [], {}, []


class LocalRelay:
    def __init__(self, hub: LocalHub, ident: Identity):
        self.hub, self.ident, self.down = hub, ident, False

    def _up(self):
        if self.down:
            raise MeshError("offline: simulated")

    def hello(self, slots, caps):
        self._up()
        with self.hub.cv:
            self.hub.nodes[self.ident.id] = {"id": self.ident.id, "slots": slots, "caps": caps, "last": time.time()}
            return {"peers": self.peers(), "lessons_seq": len(self.hub.lessons), "adapters_seq": len(self.hub.adapters)}

    def bye(self):
        with self.hub.cv:
            self.hub.nodes.pop(self.ident.id, None)
        return {"ok": True}

    def peers(self):
        self._up()
        return [dict(n) for k, n in self.hub.nodes.items() if k != self.ident.id]

    def send(self, to, kind, body):
        self._up()
        with self.hub.cv:
            tos = [k for k in self.hub.nodes if k != self.ident.id] if to == "*" else [t for t in to if t in self.hub.nodes]
            for t in tos:
                self.hub.boxes.setdefault(t, []).append({"from": self.ident.id, "kind": kind, "body": body, "ts": time.time()})
            self.hub.cv.notify_all()
            return len(tos)

    def poll(self, wait=20):
        self._up()
        end = time.time() + wait
        with self.hub.cv:
            while not self.hub.boxes.get(self.ident.id) and time.time() < end and not self.down:
                self.hub.cv.wait(min(0.2, max(0.0, end - time.time())))
            msgs, self.hub.boxes[self.ident.id] = self.hub.boxes.get(self.ident.id, []), []
            return msgs

    def put_lesson(self, lesson):
        self._up()
        with self.hub.cv:
            if lesson.get("by") != self.ident.id:
                raise MeshError("400 a lesson must be signed by its sender")
            if any(x["h"] == lesson["h"] for x in self.hub.lessons):
                return {"ok": True, "duplicate": True}
            self.hub.lessons.append(dict(lesson))
            return {"ok": True, "seq": len(self.hub.lessons)}

    def lessons(self, since=0, limit=200):
        self._up()
        with self.hub.cv:
            rows = [dict(seq=i + 1, **x) for i, x in enumerate(self.hub.lessons) if len(self.hub.reports.get(x["h"], ())) < 3][since:since + limit]
            rows = [r for r in rows if r["seq"] > since]
            return {"lessons": rows, "seq": rows[-1]["seq"] if rows else since}

    def report(self, h, why):
        with self.hub.cv:
            self.hub.reports.setdefault(h, set()).add(self.ident.id)
        return {"ok": True}

    def put_adapter(self, entry):
        self._up()
        with self.hub.cv:
            self.hub.adapters.append(dict(entry))
        return {"ok": True}

    def adapters(self, since=0):
        self._up()
        with self.hub.cv:
            rows = [dict(seq=i + 1, **x) for i, x in enumerate(self.hub.adapters) if i + 1 > since]
            return {"adapters": rows, "seq": rows[-1]["seq"] if rows else since}


# =================================================================== idle-compute jobs
def _job_sha256(args):
    return [hashlib.sha256(base64.b64decode(c)).hexdigest() for c in args["chunks"]]


def _job_exact_eval(args):
    return [bool(str(it["pred"]).strip() == str(it["ref"]).strip()) for it in args["items"]]


JOBS: dict = {"sha256": _job_sha256, "exact_eval": _job_exact_eval}     # pure, deterministic: the requester can recompute any item


def register_job(kind: str, fn: Callable[[dict], list]) -> None:
    """Add a job kind this node is willing to run for others. fn(args) -> list (one result per item). Must not touch user files."""
    JOBS[kind] = fn


def _items(kind: str, args: dict) -> list:
    return list(args.get("chunks") or args.get("items") or args.get("tasks") or [])


def _sub(kind: str, args: dict, idx: list) -> dict:
    key = "chunks" if "chunks" in args else ("items" if "items" in args else "tasks")
    return {**{k: v for k, v in args.items() if k != key}, key: [args[key][i] for i in idx]}


# =================================================================== the networked mesh
class RemotePeer:
    """A peer as mesh.Mesh sees it: id + slots + propose(task). propose() sends a signed request through the relay and waits for the signed answer;
    the answer is only TEXT: mesh.Mesh._race vets and runs it in the asker's own sandbox."""

    def __init__(self, net: "NetMesh", info: dict):
        self.net, self.id, self.slots, self.caps = net, info["id"], int(info.get("slots") or 0), info.get("caps") or {}
        self.lessons, self.model_calls = {}, 0

    def propose(self, task: str):
        if not self.net.online or not shareable(task) or self.id in self.net.distrusted:
            return None
        return self.net._rpc(self.id, "propose", {"task": task}, "proposal", self.net.propose_timeout).get("command")


class NetMesh(Mesh):
    def __init__(self, me: Node, ident: Identity, relay=None, *, share: bool = True, serve_peers: bool = True, serve_jobs: bool = True,
                 hedge: int = 3, propose_timeout: float = 20.0, evolution: dict | None = None, poll_wait: int = 20, heartbeat: float = 25.0,
                 adapter_dir: str | None = None):
        super().__init__(share=share)
        if me.id != ident.id:
            raise ValueError("the local Node's id must be its identity's public key (ident.id)")
        self.me, self.ident, self.relay = me, ident, relay
        self.nodes[me.id] = me
        self.serve_peers, self.serve_jobs, self.hedge, self.propose_timeout = serve_peers, serve_jobs, hedge, propose_timeout
        self.poll_wait, self.heartbeat = poll_wait, heartbeat
        self.evolution = evolution or {}               # {"root": ..., "model_id": ...}: feed accepted mesh lessons into evolution.api.record
        self.online, self.cursor, self.adapter_cursor = False, 0, 0
        self.by: dict = {}                             # lesson hash -> publisher node id
        self.rejected: dict = {}                       # lesson hash -> why (local refusals)
        self.distrusted: set = set()
        self.strikes: dict = {}
        self.adapters_seen: list = []
        self.shared_files: dict = {}                   # sha256 -> path (adapters this node serves)
        self.adapter_dir = adapter_dir
        self.stats = {"proposals_served": 0, "jobs_served": 0, "lessons_in": 0, "lessons_rejected": 0, "lessons_out": 0, "forged_rejected": 0}
        self._waits: dict = {}                         # rid -> Queue
        self._stop = threading.Event()
        self._threads: list = []
        self._serve_sem = threading.Semaphore(max(1, me.slots))
        self._pool = ThreadPoolExecutor(max_workers=max(2, me.slots + 2))
        if not hasattr(me.term, "vet"):                # a ComputerBackend (Sham's embedded computer): lessons are vetted with the strict book policy
            me.term.vet = SandboxTerminal(workdir=str(me.term.dir)).vet

    # ---------------------------------------------------------------- membership
    def caps(self) -> dict:
        return {"propose": bool(self.serve_peers), "jobs": bool(self.serve_jobs), "adapters": bool(self.shared_files)}

    def start(self, threads: bool = True) -> "NetMesh":
        """Join: hello, pull the lesson index (the newcomer receives what the mesh knows), push own lessons, then poll + heartbeat in the background.
        Any network failure leaves the node working alone; the heartbeat keeps retrying."""
        self._join()
        if threads and self.relay is not None:
            for fn in (self._poll_loop, self._beat_loop):
                t = threading.Thread(target=fn, daemon=True, name=f"mesh-{fn.__name__}")
                t.start()
                self._threads.append(t)
        return self

    def _join(self) -> dict:
        if self.relay is None:
            self.online = False
            return {"online": False}
        try:
            info = self.relay.hello(self.me.slots, self.caps())
            self.online = True
            self._set_peers(info.get("peers", []))
            got = self.sync_lessons()
            for ls in list(self.me.lessons.values()):
                self._push_lesson(ls.task, ls.command)
            self.sync_adapters()
            return {"online": True, "peers": len(self.nodes) - 1, "lessons_received": got, "slots": self.slots()}
        except MeshError as e:
            self.online = False
            return {"online": False, "why": str(e)}

    def stop(self) -> None:
        self._stop.set()
        try:
            if self.relay is not None and self.online:
                self.relay.bye()
        except MeshError:
            pass
        self.online = False
        self._pool.shutdown(wait=False, cancel_futures=True)

    def _set_peers(self, peers: list) -> None:
        with self.lock:
            for k in [k for k in self.nodes if k != self.me.id]:
                self.nodes.pop(k)
            for p in peers:
                if p.get("id") and p["id"] != self.me.id and p["id"] not in self.distrusted:
                    self.nodes[p["id"]] = RemotePeer(self, p)

    def _beat_loop(self) -> None:
        while not self._stop.wait(self.heartbeat):
            try:
                info = self.relay.hello(self.me.slots, self.caps())
                was = self.online
                self.online = True
                self._set_peers(info.get("peers", []))
                if not was:
                    for ls in list(self.me.lessons.values()):
                        self._push_lesson(ls.task, ls.command)
                if info.get("lessons_seq", 0) > self.cursor:
                    self.sync_lessons()
                if info.get("adapters_seq", 0) > self.adapter_cursor:
                    self.sync_adapters()
            except MeshError:
                self.online = False
                self._set_peers([])

    def _poll_loop(self) -> None:
        while not self._stop.is_set():
            if not self.online:
                self._stop.wait(1.0)
                continue
            try:
                msgs = self.relay.poll(self.poll_wait)
            except MeshError as e:
                if str(e).startswith("403"):           # the relay forgot us (restart): say hello again
                    self._join()
                else:
                    self._stop.wait(2.0)
                continue
            for m in msgs:
                self._pool.submit(self._handle, m)

    # ---------------------------------------------------------------- messages (signed end to end)
    def _send(self, to: str, kind: str, body: dict) -> bool:
        try:
            return self.relay.send([to], kind, self.ident.sign_obj(body)) > 0
        except MeshError:
            return False

    def _rpc(self, to: str, kind: str, body: dict, reply_kind: str, timeout: float) -> dict:
        rid = uuid.uuid4().hex
        q: queue.Queue = queue.Queue()
        self._waits[rid] = q
        try:
            if not self._send(to, kind, {**body, "rid": rid, "ts": int(time.time() * 1000)}):
                return {}
            try:
                frm, k, b = q.get(timeout=timeout)
            except queue.Empty:
                return {}
            return b if (frm == to and k == reply_kind) else {}
        finally:
            self._waits.pop(rid, None)

    def _handle(self, m: dict) -> None:
        frm, kind, body = m.get("from"), m.get("kind"), m.get("body")
        if not isinstance(body, dict) or not verify_obj(body, by=frm):       # forged / relayed-and-altered: dropped
            self.stats["forged_rejected"] += 1
            return
        if frm in self.distrusted:
            return
        rid = body.get("rid")
        if kind in ("proposal", "job_result", "adapter_chunk", "pong"):
            q = self._waits.get(rid)
            if q is not None:
                q.put((frm, kind, body))
            return
        if kind == "ping":
            self._send(frm, "pong", {"rid": rid})
        elif kind == "propose" and self.serve_peers:
            task = str(body.get("task") or "")[:500]
            cmd = None
            if self._serve_sem.acquire(timeout=0.5):
                try:
                    cmd = self.me.propose(task)
                except Exception:
                    cmd = None
                finally:
                    self._serve_sem.release()
                self.stats["proposals_served"] += 1
            self._send(frm, "proposal", {"rid": rid, "command": (cmd or "")[:1000]})
        elif kind == "job" and self.serve_jobs:
            fn = JOBS.get(str(body.get("job")))
            res, err = None, ""
            if fn is None:
                err = "unknown job"
            else:
                with self._serve_sem:
                    try:
                        res = fn(body.get("args") or {})
                    except Exception as e:
                        err = type(e).__name__
                self.stats["jobs_served"] += 1
            self._send(frm, "job_result", {"rid": rid, "result": res, "error": err})
        elif kind == "adapter_get":
            path = self.shared_files.get(str(body.get("sha256")))
            part = int(body.get("part") or 0)
            if not path:
                self._send(frm, "adapter_chunk", {"rid": rid, "error": "not here"})
                return
            size = os.path.getsize(path)
            parts = max(1, (size + CHUNK - 1) // CHUNK)
            with open(path, "rb") as f:
                f.seek(part * CHUNK)
                data = f.read(CHUNK)
            self._send(frm, "adapter_chunk", {"rid": rid, "part": part, "parts": parts, "data": base64.b64encode(data).decode()})

    # ---------------------------------------------------------------- knowledge: lessons
    def _vet_lesson(self, task: str, command: str) -> str:
        """'' if THIS node accepts the lesson, else why not: its own terminal policy + the owner deny list + adversarial patterns."""
        _, _, why, _ = self.me.term.vet(command)
        if why:
            return "policy: " + why
        _, ex = _evo()
        if ex is not None:
            try:
                d = ex.deny_reason(command)
                if d:
                    return "deny: " + d
            except Exception:
                pass
        if not shareable(task):
            return "pii in task"
        return ""

    def _accept(self, L: dict) -> bool:
        if not verify_obj(L) or L.get("h") != lesson_hash(str(L.get("task", "")), str(L.get("command", ""))):
            self.stats["forged_rejected"] += 1
            return False
        ls = Lesson(L["task"].strip(), L["command"].strip())
        if ls.h in self.pool or ls.h in self.rejected:
            return ls.h in self.pool
        why = self._vet_lesson(ls.task, ls.command)
        if why:
            self.rejected[ls.h] = why
            self.stats["lessons_rejected"] += 1
            try:
                self.relay.report(L["h"], why)
            except Exception:
                pass
            return False
        with self.lock:
            self.pool.setdefault(ls.h, ls)
            self.by[ls.h] = L["by"]
        self.me.lessons.setdefault(ls.h, ls)
        self.stats["lessons_in"] += 1
        return True

    def sync_lessons(self) -> int:
        """Pull the lesson index from the relay since our cursor. -> lessons accepted now."""
        if self.relay is None:
            return 0
        got = 0
        while True:
            try:
                r = self.relay.lessons(self.cursor)
            except MeshError:
                return got
            rows = r.get("lessons", [])
            for L in rows:
                if L.get("by") != self.ident.id:
                    got += self._accept({k: v for k, v in L.items() if k != "seq"})
            self.cursor = max(self.cursor, int(r.get("seq", self.cursor)))
            if len(rows) < 200:
                return got

    def _push_lesson(self, task: str, command: str) -> bool:
        if self.relay is None or not self.online or not self.share or not shareable(task) or SECRETISH.search(command):
            return False
        L = self.ident.sign_obj({"task": task.strip(), "command": command.strip(), "h": lesson_hash(task.strip(), command.strip()), "ts": int(time.time() * 1000)})
        try:
            self.relay.put_lesson(L)
            self.stats["lessons_out"] += 1
            return True
        except MeshError:
            return False

    def _publish(self, task: str, command: str) -> None:            # mesh.Mesh calls this after a SUCCESSFUL run only
        super()._publish(task, command)
        if self.share and not SECRETISH.search(task) and not SECRETISH.search(command):
            self._pool.submit(self._push_lesson, task, command)

    def _mesh_recall(self, me: Node, task: str):
        q, best, score = norm(task), None, 0.0
        for ls in list(self.pool.values()):
            s = similarity(q, norm(ls.task))
            if s > score:
                best, score = ls, s
        if best is None or score < 0.8 or self._vet_lesson(best.task, best.command):
            return None
        me.lessons.setdefault(best.h, best)
        return best

    def _done(self, me: Node, task: str, r, via: str, t0: float, proposals: int) -> dict:
        out = super()._done(me, task, r, via, t0, proposals)
        if via in ("recall", "mesh-recall"):
            h = lesson_hash(task.strip(), r.command) if lesson_hash(task.strip(), r.command) in self.by else None
            if h is None:
                h = next((k for k, ls in self.pool.items() if ls.command.strip() == r.command.strip() and k in self.by), None)
            if h is not None:
                self._feed_evolution(task, r, self.by[h])
        return out

    def _feed_evolution(self, task: str, r, publisher: str) -> None:
        """A peer's lesson that just ran successfully in THIS node's sandbox: two independent executions (the publisher's and ours).
        Stored as source="mesh", voter = the publisher; training admission still needs consensus of distinct publishers, no PII, deny list,
        and any adapter trained on it must pass the no-regression gate."""
        root, model_id = self.evolution.get("root"), self.evolution.get("model_id")
        api, _ = _evo()
        if not root or api is None:
            return
        try:
            api.record(root, model_id, user="mesh:" + publisher, task=task, command=r.command, exit_code=0, stdout=r.out, verdict=True,
                       latency_s=getattr(r, "secs", 0.0) or 0.0, source="mesh")
        except Exception:
            pass

    def ask(self, task: str, confirm=None, hedge: int | None = None, timeout: float | None = None) -> dict:  # type: ignore[override]
        return super().ask(self.me.id, task, confirm=confirm, hedge=self.hedge if hedge is None else hedge, timeout=timeout or self.propose_timeout)

    def ask_many(self, task: str, confirm=None) -> dict:  # type: ignore[override]
        return super().ask_many(self.me.id, task, confirm=confirm)

    def first_proposal(self, task: str, timeout: float | None = None, hedge: int | None = None) -> tuple:
        """Propose-only hedged race for callers that execute on their own (Sham 2's hidden-terminal loop runs the command on the chat's own
        computer with its approvals): the first peer proposal that THIS node's policy accepts. -> (command | None, peer id | None)."""
        peers = [n for n in list(self.nodes.values()) if isinstance(n, RemotePeer) and n.caps.get("propose")][: (self.hedge if hedge is None else hedge)]
        if not peers or not self.online or not shareable(task):
            return None, None
        q: queue.Queue = queue.Queue()
        for p in peers:
            self._pool.submit(lambda p=p: q.put((p.id, p.propose(task))))
        end = time.time() + (timeout or self.propose_timeout)
        for _ in peers:
            try:
                pid, cmd = q.get(timeout=max(0.05, end - time.time()))
            except queue.Empty:
                break
            if cmd and not self.me.term.vet(cmd)[2]:
                return cmd, pid
        return None, None

    # ---------------------------------------------------------------- compute: idle jobs
    def submit_job(self, job: str, args: dict, peers: list | None = None, verify: str = "spot", sample: int = 2, timeout: float = 30.0,
                   local: Callable | None = None, split: int | None = None) -> dict:
        """Send a pure job to idle peers (split into shards, one per peer) and VERIFY every shard before accepting it.
        verify="spot":      recompute `sample` random items of each shard locally (local = JOBS[job] unless given); any mismatch rejects the shard;
        verify="redundant": every shard goes to two peers; it is accepted only if both agree (then spot-checked as well);
        verify="run":       for job results that are commands, the result must vet and run successfully in MY sandbox.
        A rejected shard is recomputed locally (so the answer is always right) and its sender gets a strike (2 strikes = distrusted).
        -> {"result": [...], "shards": [...], "rejected": [peer ids], "local_items": n}"""
        local = local or JOBS.get(job)
        items = _items(job, args)
        cands = [p for p in (peers or [n.id for n in self.nodes.values() if isinstance(n, RemotePeer) and n.caps.get("jobs")]) if p not in self.distrusted]
        if not self.online or not cands or not items:
            return {"result": local(args) if local else [], "shards": [], "rejected": [], "local_items": len(items)}
        n = max(1, min(split or len(cands), len(items)))
        idx = [list(range(i, len(items), n)) for i in range(n)]
        result: list = [None] * len(items)
        shards, rejected, local_items = [], [], 0

        def run_shard(si, peer):
            return peer, self._rpc(peer, "job", {"job": job, "args": _sub(job, args, idx[si])}, "job_result", timeout)

        futs = []
        for si in range(n):
            ps = [cands[si % len(cands)]] + ([cands[(si + 1) % len(cands)]] if verify == "redundant" and len(cands) > 1 else [])
            futs.append((si, [self._pool.submit(run_shard, si, p) for p in ps]))
        for si, fs in futs:
            answers = [f.result() for f in fs]
            ok, why, res = self._check_shard(job, args, idx[si], answers, verify, sample, local)
            peer_ids = [p for p, _ in answers]
            shards.append({"shard": si, "peers": peer_ids, "ok": ok, "why": why})
            if not ok:
                for p in peer_ids:
                    rejected.append(p)
                    self._strike(p)
                res = local(_sub(job, args, idx[si])) if local else [None] * len(idx[si])
                local_items += len(idx[si])
            for j, i in enumerate(idx[si]):
                result[i] = res[j]
        return {"result": result, "shards": shards, "rejected": sorted(set(rejected)), "local_items": local_items}

    def _check_shard(self, job, args, ix, answers, verify, sample, local):
        res = [a.get("result") for _, a in answers]
        if any(r is None or not isinstance(r, list) or len(r) != len(ix) for r in res):
            return False, "missing or malformed result", None
        if verify == "redundant" and len(res) > 1 and canon(res[0]) != canon(res[1]):
            return False, "redundant peers disagree", None
        r0 = res[0]
        if verify == "run":
            for j, i in enumerate(ix):
                cmd = str(r0[j] or "")
                if not cmd or not self.me.term.run(cmd).ok:
                    return False, f"item {i}: command did not run here", None
            return True, "every command ran in my sandbox", r0
        if local is None:
            return True, "unverified (no local recompute available)", r0
        pick = random.sample(range(len(ix)), min(len(ix), max(1, sample)))
        mine = local(_sub(job, args, [ix[j] for j in pick]))
        for k, j in enumerate(pick):
            if canon(mine[k]) != canon(r0[j]):
                self.stats["forged_rejected"] += 1
                return False, f"spot-check mismatch on item {ix[j]}", None
        return True, f"spot-checked {len(pick)} item(s)", r0

    def _strike(self, peer: str) -> None:
        self.strikes[peer] = self.strikes.get(peer, 0) + 1
        if self.strikes[peer] >= 2:
            self.distrusted.add(peer)
            with self.lock:
                self.nodes.pop(peer, None)

    # ---------------------------------------------------------------- knowledge: adapters
    def share_adapter(self, fam: str, vid: str, path: str, base: str, metrics: dict | None = None, url: str = "") -> dict:
        """Announce a LoRA adapter file this node serves. The entry is signed; receivers check sha256 + signature and run their own gate."""
        entry = self.ident.sign_obj({"fam": fam, "vid": vid, "sha256": sha256_file(path), "size": os.path.getsize(path), "base": base,
                                     "metrics": {k: (int(v) if isinstance(v, bool) or isinstance(v, int) else str(v)) for k, v in (metrics or {}).items()},
                                     "url": url, "ts": int(time.time() * 1000)})
        self.shared_files[entry["sha256"]] = path
        if self.relay is not None and self.online:
            try:
                self.relay.hello(self.me.slots, self.caps())
                self.relay.put_adapter(entry)
            except MeshError:
                pass
        return entry

    def sync_adapters(self) -> list:
        if self.relay is None:
            return []
        try:
            r = self.relay.adapters(self.adapter_cursor)
        except MeshError:
            return []
        new = []
        for e in r.get("adapters", []):
            e = {k: v for k, v in e.items() if k != "seq"}
            if e.get("by") != self.ident.id and verify_obj(e):
                self.adapters_seen.append(e)
                new.append(e)
        self.adapter_cursor = max(self.adapter_cursor, int(r.get("seq", self.adapter_cursor)))
        return new

    def fetch_adapter(self, entry: dict, dest_dir: str | None = None, timeout: float = 30.0) -> str:
        """-> local path of the adapter file, hash- and signature-checked. Raises MeshError when it cannot be had intact."""
        if not verify_obj(entry):
            raise MeshError("adapter entry signature is invalid")
        dest_dir = dest_dir or self.adapter_dir or os.path.join(os.path.expanduser("~"), ".sham_mesh", "adapters")
        os.makedirs(dest_dir, exist_ok=True)
        out = os.path.join(dest_dir, f"{entry['fam']}-{entry['vid']}-{entry['sha256'][:16]}.bin")
        tmp = out + ".part"
        h = hashlib.sha256()
        with open(tmp, "wb") as f:
            if entry.get("url"):
                with urllib.request.urlopen(urllib.request.Request(entry["url"], headers=UA), timeout=timeout) as r:
                    for chunk in iter(lambda: r.read(1 << 20), b""):
                        f.write(chunk)
                        h.update(chunk)
            else:
                part, parts = 0, 1
                while part < parts:
                    b = self._rpc(entry["by"], "adapter_get", {"sha256": entry["sha256"], "part": part}, "adapter_chunk", timeout)
                    if not b or b.get("error") or int(b.get("part", -1)) != part:
                        raise MeshError(f"adapter chunk {part} not received ({b.get('error', 'timeout') if b else 'timeout'})")
                    data = base64.b64decode(b["data"])
                    f.write(data)
                    h.update(data)
                    parts = int(b["parts"])
                    part += 1
                    if f.tell() > int(entry["size"]):
                        break
        if h.hexdigest() != entry["sha256"] or os.path.getsize(tmp) != int(entry["size"]):
            os.remove(tmp)
            raise MeshError("adapter file does not match its signed sha256 / size: rejected")
        os.replace(tmp, out)
        return out

    def adopt_adapter(self, entry: dict, gate: Callable[[str, dict], tuple], install: Callable[[str, dict], object] | None = None, base: str = "") -> dict:
        """Fetch, verify, then run THIS node's gate (e.g. evolution.adapters.gate on its own keep/target sets). Installed only if the gate accepts."""
        if base and entry.get("base") != base:
            return {"ok": False, "why": f"adapter is for base {entry.get('base')!r}, not {base!r}"}
        try:
            path = self.fetch_adapter(entry)
        except MeshError as e:
            return {"ok": False, "why": str(e)}
        try:
            ok, why = gate(path, entry)
        except Exception as e:
            ok, why = False, f"gate error: {type(e).__name__}"
        if not ok:
            return {"ok": False, "why": "gate: " + str(why), "path": path}
        installed = install(path, entry) if install else None
        return {"ok": True, "why": str(why), "path": path, "installed": installed}


def registry_installer(registry, metrics_extra: dict | None = None):
    """install() for adopt_adapter: puts an accepted mesh adapter into evolution.adapters.AdapterRegistry as a new version and activates it
    (rollback() moves back). Imports torch lazily."""
    def install(path: str, entry: dict):
        import torch
        state = torch.load(path, map_location="cpu")
        vid = registry.propose(entry["fam"], state, {**(entry.get("metrics") or {}), "source": "mesh", "from": entry["by"][:12], **(metrics_extra or {})})
        registry.accept(entry["fam"], vid, why="mesh adapter passed the local gate")
        return vid
    return install


def connect(node: Node, *, url: str | None = None, mesh: str = "sham2", key_path: str | None = None, ident: Identity | None = None, **kw) -> NetMesh:
    """One-liner for a device: identity from `key_path` (created once, 0600), relay at `url` (default the deployed Worker), joined in the background.
    The returned NetMesh works offline when the relay is unreachable."""
    ident = ident or Identity.load_or_create(key_path or os.path.join(os.path.expanduser("~"), ".sham_mesh", "key"))
    if node.id != ident.id:
        node.id = ident.id
    relay = RelayClient(url or DEFAULT_URL, mesh, ident) if (url or DEFAULT_URL) else None
    return NetMesh(node, ident, relay, **kw).start()
