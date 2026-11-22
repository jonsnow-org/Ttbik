"""Collaborative terminal mesh (the "every new user adds compute and knowledge" idea of the T-LDM reports), built on the sandboxed terminal.

What a user's terminal is in the mesh: a NODE. A node has its own sandbox (own working folder, own log), its own proposer (the model that turns a task into a command),
some execution slots (its compute) and a lesson store (its knowledge). Joining the mesh adds all three to everybody and hands the newcomer what the mesh already knows.

Rules that keep it safe (the reports' "work stays local, the network is for hard cases"):
  * a peer only PROPOSES command text; the asking node vets it with its own policy and runs it in ITS OWN sandbox. Nobody executes for anybody else, no file or result ever leaves a node;
  * a shared lesson is (task text, command, hash); it is re-vetted by every receiver and dropped if its policy refuses it, so a poisoned lesson cannot run anywhere;
  * a lesson is published only after the publisher's terminal ran it successfully, and only if the task text carries nothing that looks like a secret or an address;
  * with no peers everything still works alone (local-first / offline).
Speed ideas: (1) recall: a repeated or near-identical task costs no model call; (2) hedged race: several nodes propose at once, the first proposal that really succeeds wins, the rest are dropped,
so the latency is the fastest node's, and each new node lowers the slow tail; (3) multi-agent: a compound task is split, the sub-tasks are PROPOSED in parallel by different nodes and EXECUTED in order when they write.
`proposer(task) -> str | None` is any callable (the T-LDM writer, a local llama-server, a test double).
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable

from sandbox_terminal import SandboxTerminal, Result

SPLIT = re.compile(r"\s*(?:;|\band then\b|\bthen\b|\bafter that\b|\bثم\b|\bبعدها\b|\bو بعدها\b)\s*", re.I)
SECRETISH = re.compile(r"(@[\w.-]+\.\w+|https?://|\b[A-Za-z0-9_\-]{28,}\b|password|passwd|token|secret|كلمة المرور|رمز)", re.I)
WRITES = {"mkdir", "touch", "cp", "mv", "rm"}


FILLER = {"please", "kindly", "now", "the", "a", "an", "me", "my", "can", "you", "could", "للتو", "لو", "سمحت", "فضلك", "من", "ممكن", "الآن"}


def norm(task: str) -> frozenset:
    return frozenset(w for w in re.findall(r"\w+", (task or "").lower()) if w not in FILLER)


def similarity(a: frozenset, b: frozenset) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


@dataclass
class Lesson:
    task: str
    command: str
    uses: int = 1

    @property
    def h(self) -> str:
        return hashlib.sha256((self.task.strip().lower() + "\n" + self.command.strip()).encode()).hexdigest()[:16]


@dataclass
class Node:
    id: str
    term: SandboxTerminal
    proposer: Callable[[str], "str | None"]
    slots: int = 1
    lessons: dict = field(default_factory=dict)       # hash -> Lesson
    model_calls: int = 0
    recalls: int = 0

    def propose(self, task: str):
        self.model_calls += 1
        return self.proposer(task)

    def recall(self, task: str, threshold: float = 0.8):
        q = norm(task)
        best, score = None, 0.0
        for ls in self.lessons.values():
            s = similarity(q, norm(ls.task))
            if s > score:
                best, score = ls, s
        return best if score >= threshold else None

    def learn(self, lesson: Lesson) -> bool:
        """Accept a lesson only if THIS node's policy lets the command run at all."""
        _, _, why, _ = self.term.vet(lesson.command)
        if why:
            return False
        self.lessons.setdefault(lesson.h, lesson)
        return True


class Mesh:
    def __init__(self, share: bool = True):
        self.nodes: dict[str, Node] = {}
        self.share = share
        self.pool: dict[str, Lesson] = {}              # what the mesh knows (replicated, not a server: any node can serve it)
        self.lock = threading.Lock()

    # ---- membership: a new user adds compute and knowledge --------------------------------------------------------------
    def join(self, node: Node) -> dict:
        with self.lock:
            self.nodes[node.id] = node
            taken = sum(node.learn(ls) for ls in list(self.pool.values()))          # the newcomer receives the mesh's knowledge ...
            for ls in node.lessons.values():                                         # ... and brings its own
                self.pool.setdefault(ls.h, ls)
        return {"nodes": len(self.nodes), "slots": self.slots(), "lessons_received": taken, "pool": len(self.pool)}

    def leave(self, node_id: str) -> None:
        with self.lock:
            self.nodes.pop(node_id, None)

    def slots(self) -> int:
        return sum(n.slots for n in self.nodes.values())

    def _publish(self, task: str, command: str) -> None:
        if not self.share or SECRETISH.search(task) or SECRETISH.search(command):
            return
        ls = Lesson(task.strip(), command.strip())
        with self.lock:
            self.pool.setdefault(ls.h, ls)

    # ---- one task --------------------------------------------------------------------------------------------------------
    def ask(self, node_id: str, task: str, confirm: Callable[[str], bool] | None = None, hedge: int = 3, timeout: float = 30.0) -> dict:
        """-> {ok, command, out, via, secs, proposals}. via = recall | mesh-recall | local | race."""
        me = self.nodes[node_id]
        t0 = time.time()
        me.term.task = task[:200]
        ls = me.recall(task)
        via = "recall"
        if ls is None:
            ls = self._mesh_recall(me, task)
            via = "mesh-recall"
        if ls is not None:
            r = self._run(me, ls.command, confirm)
            if r.ok:
                me.recalls += 1
                return self._done(me, task, r, via, t0, 0)
        # local first; the race only starts when the local proposal fails (work stays local, the network is for hard cases)
        cmd = me.propose(task)
        proposals = 1
        if cmd:
            r = self._run(me, cmd, confirm)
            if r.ok:
                return self._done(me, task, r, "local", t0, proposals)
        peers = [n for n in self.nodes.values() if n.id != me.id][:max(0, hedge)]
        if peers:
            r, used = self._race(me, peers, task, confirm, timeout)
            proposals += used
            if r is not None:
                return self._done(me, task, r, "race", t0, proposals)
        return {"ok": False, "command": cmd or "", "out": "", "via": "none", "secs": round(time.time() - t0, 3), "proposals": proposals}

    def _mesh_recall(self, me: Node, task: str):
        q, best, score = norm(task), None, 0.0
        for ls in list(self.pool.values()):
            s = similarity(q, norm(ls.task))
            if s > score:
                best, score = ls, s
        return best if best is not None and score >= 0.8 and me.learn(best) else None

    def _run(self, me: Node, cmd: str, confirm) -> Result:
        r = me.term.run(cmd)
        if r.needs_confirmation and confirm is not None and confirm(cmd):
            r = me.term.run(cmd, confirm=True)
        return r

    def _race(self, me: Node, peers: list, task: str, confirm, timeout: float):
        """Hedged proposals: every peer proposes; the first command that really succeeds in MY sandbox wins. Returns (Result|None, proposals used)."""
        used, winner = 0, None
        ex = ThreadPoolExecutor(max_workers=max(1, len(peers)))
        futs = {ex.submit(p.propose, task): p for p in peers}
        deadline = time.time() + timeout
        try:
            for f in as_completed(futs, timeout=max(0.1, deadline - time.time())):
                used += 1
                try:
                    cmd = f.result()
                except Exception:
                    continue
                if not cmd:
                    continue
                r = self._run(me, cmd, confirm)
                if r.ok:
                    winner = r
                    break
        except Exception:
            pass
        ex.shutdown(wait=False, cancel_futures=True)
        return winner, used

    def _done(self, me: Node, task: str, r: Result, via: str, t0: float, proposals: int) -> dict:
        ls = Lesson(task.strip(), r.command)
        me.lessons.setdefault(ls.h, ls)
        self._publish(task, r.command)
        return {"ok": True, "command": r.command, "out": r.out, "via": via, "secs": round(time.time() - t0, 3), "proposals": proposals}

    # ---- a compound task: several agents -----------------------------------------------------------------------------------
    def ask_many(self, node_id: str, task: str, confirm: Callable[[str], bool] | None = None) -> dict:
        """Split into sub-tasks, PROPOSE them in parallel on different nodes (the slow, model part), EXECUTE in order in the asker's sandbox (writes never race)."""
        me = self.nodes[node_id]
        parts = [p for p in SPLIT.split(task) if p.strip()]
        t0 = time.time()
        if len(parts) <= 1:
            r = self.ask(node_id, task, confirm)
            return {"ok": r["ok"], "steps": [r], "secs": r["secs"], "agents": 1}
        workers = [n for n in self.nodes.values()]
        slots = [n for n in workers for _ in range(n.slots)] or [me]
        proposals: list = [None] * len(parts)
        ex = ThreadPoolExecutor(max_workers=max(1, len(slots)))
        futs = {}
        for i, part in enumerate(parts):
            known = me.recall(part) or self._mesh_recall(me, part)
            if known is not None:
                proposals[i] = ("recall", known.command)
            else:
                futs[ex.submit(self._solve_part, slots, i, part)] = i
        for f in as_completed(futs):
            try:
                proposals[futs[f]] = ("model", f.result())
            except Exception:
                proposals[futs[f]] = ("model", None)
        ex.shutdown(wait=False)
        steps, ok = [], True
        for part, (src, cmd) in zip(parts, proposals):
            me.term.task = part[:200]
            if not cmd:
                steps.append({"ok": False, "task": part, "command": "", "out": "", "via": src})
                ok = False
                continue
            r = self._run(me, cmd, confirm)
            if r.ok:
                self._done(me, part, r, src, t0, 1)
            steps.append({"ok": r.ok, "task": part, "command": cmd, "out": r.out, "via": src})
            ok = ok and r.ok
        return {"ok": ok, "steps": steps, "secs": round(time.time() - t0, 3), "agents": min(len(parts), len(slots))}

    @staticmethod
    def _solve_part(slots: list, i: int, part: str):
        """An agent that cannot answer hands its part to the next node (up to 3 tries) instead of failing the whole task."""
        for j in range(min(len(slots), 3)):
            try:
                cmd = slots[(i + j) % len(slots)].propose(part)
            except Exception:
                cmd = None
            if cmd:
                return cmd
        return None

    # ---- many tasks at once: the compute added by every user ------------------------------------------------------------------
    def run_batch(self, tasks: list[tuple[str, str]]) -> dict:
        """tasks = [(node_id, task)] run concurrently, each node limited to its own slots. -> throughput numbers."""
        sems = {n.id: threading.Semaphore(n.slots) for n in self.nodes.values()}
        t0 = time.time()

        def one(nid: str, task: str):
            with sems[nid]:
                return self.ask(nid, task)
        with ThreadPoolExecutor(max_workers=max(1, self.slots())) as ex:
            res = list(ex.map(lambda a: one(*a), tasks))
        el = time.time() - t0
        return {"tasks": len(tasks), "ok": sum(r["ok"] for r in res), "secs": round(el, 3), "tasks_per_s": round(len(tasks) / el, 2) if el else 0.0,
                "via": {v: sum(r["via"] == v for r in res) for v in {r["via"] for r in res}}}

    def snapshot(self) -> str:
        return json.dumps({"nodes": len(self.nodes), "slots": self.slots(), "pool": len(self.pool)})
