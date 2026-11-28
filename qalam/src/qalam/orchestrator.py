"""Agents and threads. One model is a thinker; a TEAM of workers is what finishes big jobs. This module runs a task graph (a DAG) of sub-agents:

  parallel      every node whose dependencies are done runs now, in its own thread (up to `workers` at once); independent work never waits on other work
  narrower      a child may use only a SUBSET of its parent's tools (it can never gain power by being delegated to), and a spawn depth and a total node count are capped
  safe          a failed node is retried, then marked failed, and everything that depends on it is skipped with a reason (never run on missing inputs); a node has a deadline
  one truth     workers share a thread-safe blackboard (versioned writes); results flow to dependants as inputs
  stoppable     the emergency stop cancels everything not yet started and tells the running ones through their context
  accountable   every node start/finish/failure goes to the audit log

`run_batch` does the same for tool calls inside one agent turn: consecutive READ-ONLY calls run in parallel, anything that changes something runs alone and in order, and the
results come back in the order of the calls. The workers themselves (a model loop, a script) are supplied by the caller: this is the scheduler, and it is tested on its own."""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Callable

from . import tools


class OrchestrationError(Exception):
    pass


@dataclass
class Node:
    id: str
    prompt: str
    deps: tuple[str, ...] = ()
    tools: frozenset[str] = frozenset()          # tool NAMES this node may call (must be within its parent's)
    seconds: float = 120.0
    retries: int = 1
    depth: int = 0


@dataclass
class Outcome:
    id: str
    status: str                                   # done | failed | skipped | cancelled
    output: str = ""
    error: str = ""
    attempts: int = 0
    seconds: float = 0.0


class Blackboard:
    def __init__(self) -> None:
        self._d: dict[str, tuple[int, object]] = {}
        self._lock = threading.Lock()

    def put(self, key: str, value: object, expect_version: int | None = None) -> int:
        """Versioned write: with `expect_version` it fails if somebody else wrote since (no lost updates between threads)."""
        with self._lock:
            ver = self._d.get(key, (0, None))[0]
            if expect_version is not None and expect_version != ver:
                raise OrchestrationError(f"{key}: changed by another worker (have v{expect_version}, now v{ver})")
            self._d[key] = (ver + 1, value)
            return ver + 1

    def get(self, key: str, default: object = None) -> tuple[int, object]:
        with self._lock:
            return self._d.get(key, (0, default))

    def snapshot(self) -> dict:
        with self._lock:
            return {k: v for k, (_, v) in self._d.items()}


@dataclass
class Context:
    node: Node
    inputs: dict[str, str]
    board: Blackboard
    cancelled: threading.Event
    deadline: float

    def time_left(self) -> float:
        return self.deadline - time.monotonic()

    def check(self) -> None:
        """Workers call this between steps: it raises when the node was cancelled or ran out of time."""
        if self.cancelled.is_set():
            raise OrchestrationError("cancelled")
        if self.time_left() <= 0:
            raise OrchestrationError("deadline reached")


class Orchestrator:
    def __init__(self, workers: int = 4, max_nodes: int = 32, max_depth: int = 3, audit=None, stop=None) -> None:
        self.workers, self.max_nodes, self.max_depth, self.audit, self.stop = max(1, workers), max_nodes, max_depth, audit, stop
        self.board = Blackboard()

    # ------------------------------------------------------------------ validation
    def check_graph(self, nodes: list[Node], parent_tools: frozenset[str] | None = None, parent_depth: int = -1) -> None:
        if not 1 <= len(nodes) <= self.max_nodes:
            raise OrchestrationError(f"a graph has 1 to {self.max_nodes} nodes")
        ids = [n.id for n in nodes]
        if len(set(ids)) != len(ids):
            raise OrchestrationError("duplicate node id")
        for n in nodes:
            if n.depth <= parent_depth:
                n.depth = parent_depth + 1
            if n.depth > self.max_depth:
                raise OrchestrationError(f"{n.id}: delegation depth {n.depth} exceeds {self.max_depth}")
            unknown = [t for t in n.tools if t not in tools.REGISTRY]
            if unknown:
                raise OrchestrationError(f"{n.id}: unknown tool {unknown[0]!r}")
            if parent_tools is not None and not n.tools <= parent_tools:
                raise OrchestrationError(f"{n.id}: a sub-agent cannot use tools its parent lacks ({sorted(n.tools - parent_tools)[0]})")
            for d in n.deps:
                if d not in ids:
                    raise OrchestrationError(f"{n.id}: unknown dependency {d}")
        seen: set[str] = set()                                              # cycle check (Kahn)
        left = {n.id: set(n.deps) for n in nodes}
        while left:
            ready = [k for k, v in left.items() if v <= seen]
            if not ready:
                raise OrchestrationError("the graph has a cycle")
            for k in ready:
                seen.add(k)
                left.pop(k)

    # ------------------------------------------------------------------ run
    def run(self, nodes: list[Node], worker: Callable[[Node, Context], str], parent_tools: frozenset[str] | None = None, parent_depth: int = -1) -> dict[str, Outcome]:
        self.check_graph(nodes, parent_tools, parent_depth)
        by_id = {n.id: n for n in nodes}
        out: dict[str, Outcome] = {}
        running: dict[str, object] = {}
        cancel = threading.Event()
        lock = threading.Condition()

        def log(kind: str, **kw) -> None:
            if self.audit is not None:
                self.audit.append(kind, **kw)

        def attempt(n: Node) -> Outcome:
            t0 = time.monotonic()
            err = ""
            for a in range(1, n.retries + 2):
                ctx = Context(n, {d: out[d].output for d in n.deps}, self.board, cancel, time.monotonic() + n.seconds)
                try:
                    ctx.check()
                    res = worker(n, ctx)
                    log("node_done", node=n.id, attempts=a)
                    return Outcome(n.id, "done", str(res), "", a, time.monotonic() - t0)
                except Exception as exc:  # noqa: BLE001  (a worker's failure is data for the scheduler, never a crash of the others)
                    err = f"{type(exc).__name__}: {str(exc)[:300]}"
                    if cancel.is_set() or str(exc) == "cancelled":
                        return Outcome(n.id, "cancelled", "", err, a, time.monotonic() - t0)
                    log("node_failed", node=n.id, attempt=a, error=err)
            return Outcome(n.id, "failed", "", err, n.retries + 1, time.monotonic() - t0)

        with ThreadPoolExecutor(self.workers) as ex:
            futures: dict[str, object] = {}
            while len(out) < len(nodes):
                if self.stop is not None and self.stop.engaged():
                    cancel.set()
                for n in nodes:
                    if n.id in out or n.id in futures:
                        continue
                    if cancel.is_set():
                        out[n.id] = Outcome(n.id, "cancelled", "", "emergency stop")
                        continue
                    bad = [d for d in n.deps if d in out and out[d].status != "done"]
                    if bad:
                        out[n.id] = Outcome(n.id, "skipped", "", f"dependency {bad[0]} did not finish ({out[bad[0]].status})")
                        log("node_skipped", node=n.id, because=bad[0])
                    elif all(d in out for d in n.deps):
                        log("node_start", node=n.id, tools=sorted(n.tools), depth=n.depth)
                        futures[n.id] = ex.submit(attempt, n)
                for nid, fut in list(futures.items()):
                    if fut.done():
                        out[nid] = fut.result()
                        del futures[nid]
                if len(out) < len(nodes):
                    time.sleep(0.005)
        return out


# ------------------------------------------------------------------ tool calls inside one turn
def run_batch(calls: list[tuple[str, dict]], runner: Callable[[str, dict], tuple[bool, str]], workers: int = 4, loaded: set[str] | None = None) -> list[tuple[bool, str]]:
    """Results in call order. Consecutive read-only calls run together in threads; any call that is not read-only waits for everything before it and runs alone, so order-dependent
    work (write then read) is never reordered."""
    results: list[tuple[bool, str] | None] = [None] * len(calls)
    i = 0
    while i < len(calls):
        j = i
        while j < len(calls) and tools.validate(calls[j][0], calls[j][1], loaded if loaded is not None else set(tools.GROUPS)).risk == "read":
            j += 1
        if j - i > 1:
            with ThreadPoolExecutor(min(workers, j - i)) as ex:
                for k, r in zip(range(i, j), ex.map(lambda c: runner(*c), calls[i:j])):
                    results[k] = r
            i = j
        else:
            results[i] = runner(*calls[i])
            i += 1
    return [r for r in results if r is not None]
