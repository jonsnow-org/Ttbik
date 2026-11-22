"""Phase 1 of the T-LDM agent system (docs/experiments/TLDM_AGENT_SYSTEM.md): durable tasks, ONE coordinator, workers as capabilities, a verifier that decides.

  * a Task is a record saved as a file after every step (resumable after a crash or a restart);
  * the Coordinator is the only owner of the plan and the state; it runs ready steps (read-only ones in parallel, writing ones one after the other), verifies each result,
    retries a failed step once, then asks the planner to replan THAT step; it stops on a budget (steps / replans / seconds);
  * a step with no check is refused when the plan is made: no measurable result, no acceptance (the report's "the result of the command is the reward");
  * workers: `shell` (the sandboxed terminal), `file` (read/write inside the task folder), `app_tool` and `ask_user` (ports to the web app, which alone holds GitHub / connectors / tokens / the user's confirmation);
    senses and generation (`see` `hear` `write` `make`) plug in here in phase 2 through the same `workers` table.
Waiting for the user (2026-11-18): with `ask_later=True` a step that needs the user (an ask_user question, a command that needs approval, an app call that needs the
user's yes) does not block the coordinator: the step becomes `waiting` with its question, the task becomes `waiting_user` and is saved, and `run()` returns. The app
shows the question with its own ask_user / confirmation; `resume(task, answer)` (even in another process, after `load()`) records the answer and continues.
`planner.plan(goal) -> list[dict]` and `planner.replan(goal, task, failed_step) -> list[dict]` are any callables (the T-LDM writer, Sham v2, Nova, or a scripted double in tests).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, asdict
from typing import Callable

from sandbox_terminal import SandboxTerminal

try:
    from app_port import find_secret
except Exception:                                   # (phase 3 port missing: no credential screen, phase 1 behaviour)
    find_secret = None

WRITES_HINT = ("mkdir", "touch", "cp", "mv", "rm", "tee")

NEEDS_CHECK = {"shell", "file", "see", "hear", "write", "make", "app_tool"}      # ask_user is its own check (the answer)
YES = re.compile(r"(?i)^\s*(?:yes|y|ok|okay|sure|go ahead|confirm(?:ed)?|approve(?:d)?|نعم|اي|أي|ايوه|موافق|تمام|نفّذ|نفذ|✅)(?=$|[\s.!,،؛:])")   # the user's yes, read from the app's ask_user answer
EXTERNAL = {"push", "create_pr", "merge", "send", "delete", "post", "comment"}   # app tools that change the outside world: always confirmed by the user


@dataclass
class Step:
    id: str
    kind: str
    args: dict
    check: dict = field(default_factory=dict)
    needs: list = field(default_factory=list)
    status: str = "pending"          # pending | waiting | done | failed | replaced
    result: str = ""
    tries: int = 0
    question: str = ""               # what the user is asked while the step is `waiting`
    answer: str | None = None        # the user's answer, once given (kept in the task file: the owner's audit trail)


@dataclass
class Task:
    id: str
    goal: str
    steps: list = field(default_factory=list)
    status: str = "new"              # new | running | waiting_user | done | failed | budget
    replans: int = 0
    log: list = field(default_factory=list)
    budget: dict = field(default_factory=lambda: {"max_steps": 40, "max_replans": 3, "max_secs": 600})

    def step(self, sid: str) -> Step:
        return next(s for s in self.steps if s.id == sid)


def save(task: Task, path: str) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(asdict(task), f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def load(path: str) -> Task:
    d = json.load(open(path, encoding="utf-8"))
    d["steps"] = [Step(**s) for s in d["steps"]]
    return Task(**d)


class WaitForUser(Exception):
    """Raised by a worker in ask_later mode: the step cannot go on without the user's answer to `question`."""

    def __init__(self, question: str):
        super().__init__(question)
        self.question = question


class Verifier:
    """A step is accepted only if its check holds. Check kinds: exit0, contains, file(+min_bytes/has/sha256), quality (media gate), json_file, lines_at_least."""

    def __init__(self, folder: str):
        self.dir = folder

    def _path(self, rel: str) -> str:
        p = os.path.realpath(os.path.join(self.dir, rel))
        if not (p == self.dir or p.startswith(self.dir + os.sep)):
            raise ValueError("outside the task folder")
        return p

    def check(self, step: Step, ok: bool, out: str) -> tuple[bool, str]:
        spec = step.check
        if not spec:
            return False, "no check"
        if spec.get("exit0") and not ok:
            return False, "the worker reported failure"
        if "contains" in spec and spec["contains"] not in out:
            return False, f"output lacks {spec['contains']!r}"
        try:
            if "file" in spec:
                p = self._path(spec["file"])
                if not os.path.isfile(p):
                    return False, f"{spec['file']} was not created"
                if os.path.getsize(p) < int(spec.get("min_bytes", 1)):
                    return False, f"{spec['file']} is too small"
                if "sha256" in spec and hashlib.sha256(open(p, "rb").read()).hexdigest() != spec["sha256"]:
                    return False, "sha256 differs"
                if "has" in spec and spec["has"] not in open(p, encoding="utf-8", errors="replace").read():
                    return False, f"{spec['file']} lacks {spec['has']!r}"
            if spec.get("quality"):                          # generated media is judged by the existing gate, independently of the worker that made it
                from media_workers import quality_of
                good, why = quality_of(self._path(spec["file"]))
                if not good:
                    return False, f"quality gate: {why}"
            if "json_file" in spec:
                if not json.load(open(self._path(spec["json_file"]), encoding="utf-8")):
                    return False, "empty json"
            if "lines_at_least" in spec and len([x for x in out.splitlines() if x.strip()]) < int(spec["lines_at_least"]):
                return False, "too few output lines"
        except (OSError, ValueError) as e:
            return False, f"check failed: {str(e)[:80]}"
        return True, "ok"


class Coordinator:
    def __init__(self, folder: str, planner, term: SandboxTerminal | None = None, workers: dict | None = None, slots: int = 3,
                 confirm: Callable[[str], bool] | None = None, app_call: Callable[[str, dict], str] | None = None, ask_later: bool = False):
        self.dir = os.path.realpath(folder)
        os.makedirs(self.dir, exist_ok=True)
        self.planner, self.slots, self.confirm, self.app_call, self.ask_later = planner, slots, confirm, app_call, ask_later
        self.term = term or SandboxTerminal(self.dir)
        self.verify = Verifier(self.term.dir)
        self.workers = {"shell": self._shell, "file": self._file, "app_tool": self._app_tool, "ask_user": self._ask_user}
        self.workers.update(workers or {})
        self.lock = threading.Lock()
        self.executions = 0

    # ---- planning ------------------------------------------------------------------------------------------------------
    def new_task(self, goal: str, tid: str | None = None, budget: dict | None = None) -> Task:
        t = Task(id=tid or hashlib.sha256((goal + str(time.time())).encode()).hexdigest()[:10], goal=goal)
        if budget:
            t.budget.update(budget)
        t.steps = self._accept(self.planner.plan(goal), t)
        t.log.append(f"planned {len(t.steps)} steps")
        save(t, self._file_of(t))
        return t

    def _file_of(self, t: Task) -> str:
        return os.path.join(self.dir, f".task_{t.id}.json")

    def _accept(self, raw: list, t: Task) -> list:
        """The plan is refused step by step: unknown worker kind, or no check, never enters the task."""
        out = []
        for i, d in enumerate(raw or []):
            s = Step(id=d.get("id") or f"s{len(t.steps) + i + 1}", kind=d["kind"], args=d.get("args", {}), check=d.get("check", {}), needs=list(d.get("needs", [])))
            if s.kind not in self.workers:
                t.log.append(f"refused {s.id}: unknown worker {s.kind}")
                continue
            if s.kind in NEEDS_CHECK and not s.check:
                t.log.append(f"refused {s.id}: no check")
                continue
            where = find_secret(s.args) if find_secret else ""
            if where:                                            # a credential never enters a task file, the terminal or the app call: only {{secret:name}} placeholders
                t.log.append(f"refused {s.id}: {where} looks like a credential")
                continue
            out.append(s)
        return out

    def estimate(self, t: Task) -> dict:
        """Cost before distribution: how many steps, how wide the parallel part can be (never wider than the slots; 1 slot = no fake parallelism)."""
        ro = [s for s in t.steps if not self._writes(s)]
        return {"steps": len(t.steps), "read_only": len(ro), "width": max(1, min(self.slots, len(ro))), "within_budget": len(t.steps) <= t.budget["max_steps"]}

    # ---- running -------------------------------------------------------------------------------------------------------
    def _writes(self, s: Step) -> bool:
        if s.kind == "file":
            return s.args.get("op", "read") != "read"
        if s.kind == "shell":
            cmd = s.args.get("command", "")
            return bool(re.search(r">|\b(" + "|".join(WRITES_HINT) + r")\b|python3", cmd))
        return s.kind in ("app_tool", "make", "write")

    def run(self, t: Task, stop_after: int | None = None) -> Task:
        t.status = "running"
        t0, ran = time.time(), 0
        while True:
            pending = [s for s in t.steps if s.status == "pending"]
            if not pending:
                t.status = "done" if t.steps and all(s.status in ("done", "replaced") for s in t.steps) else "failed"
                break
            done_ids = {s.id for s in t.steps if s.status == "done"}
            ready = [s for s in pending if all(n in done_ids for n in s.needs)]
            if not ready:
                t.status = "failed"
                t.log.append("deadlock: steps wait on steps that cannot finish")
                break
            if sum(s.tries > 0 or s.status != "pending" for s in t.steps) >= t.budget["max_steps"] or time.time() - t0 > t.budget["max_secs"]:
                t.status = "budget"
                break
            batch = self._batch(ready)
            if stop_after is not None:
                batch = batch[:max(0, stop_after - ran)]
                if not batch:
                    break
            if len(batch) == 1:
                results = [self._do(batch[0])]
            else:
                with ThreadPoolExecutor(max_workers=min(self.slots, len(batch))) as ex:
                    results = list(ex.map(self._do, batch))
            waiting = False
            for s, (ok, out, why) in zip(batch, results):
                if why == "waiting":                              # not a try: the step pauses until resume() brings the user's answer
                    s.status, s.question = "waiting", out[:1000]
                    t.log.append(f"{s.id} waiting for the user")
                    waiting = True
                    continue
                ran += 1
                s.tries += 1
                s.result = out[:1500]
                if ok:
                    s.status = "done"
                    t.log.append(f"{s.id} ok")
                elif s.tries < 2:
                    t.log.append(f"{s.id} failed ({why}); retry")
                else:
                    t.log.append(f"{s.id} failed ({why}); replan")
                    if not self._replan(t, s, why):
                        s.status = "failed"
                        t.status = "failed"
            if waiting and t.status == "running":
                t.status = "waiting_user"
            save(t, self._file_of(t))
            if t.status in ("failed", "budget", "waiting_user"):
                break
        save(t, self._file_of(t))
        return t

    def waiting(self, t: Task) -> list:
        """[(step_id, question)] the user has to answer before the task can go on."""
        return [(s.id, s.question) for s in t.steps if s.status == "waiting"]

    def resume(self, t: Task, answer: str, step_id: str | None = None, stop_after: int | None = None) -> Task:
        """The user's answer to a waiting step (the first one if no id): recorded on the step, then the task runs on from where it stopped."""
        w = [s for s in t.steps if s.status == "waiting" and (step_id is None or s.id == step_id)]
        if not w:
            raise ValueError("no step of this task is waiting for the user" + (f" (id {step_id})" if step_id else ""))
        s = w[0]
        s.answer, s.status = str(answer)[:400], "pending"
        t.log.append(f"{s.id} answered by the user: {'yes' if YES.match(s.answer) else 'no'}")
        return self.run(t, stop_after=stop_after)

    def _batch(self, ready: list) -> list:
        """Read-only steps together (up to the slots); a writing step runs alone, in plan order."""
        ro = [s for s in ready if not self._writes(s)]
        if ro:
            return ro[:self.slots]
        return ready[:1]

    def _replan(self, t: Task, failed: Step, why: str) -> bool:
        if t.replans >= t.budget["max_replans"] or not hasattr(self.planner, "replan"):
            return False
        t.replans += 1
        new = self._accept(self.planner.replan(t.goal, t, failed), t)
        if not new:
            return False
        failed.status = "replaced"                       # superseded by the new steps: neither a success nor a failure of the task
        for s in t.steps:
            if failed.id in s.needs:                       # whoever waited for the failed step now waits for the replacement's last step
                s.needs = [n for n in s.needs if n != failed.id] + [new[-1].id]
        t.steps.extend(new)
        return True

    def _do(self, s: Step) -> tuple[bool, str, str]:
        with self.lock:
            self.executions += 1
        try:
            ok, out = self.workers[s.kind](s)
        except WaitForUser as w:
            return False, w.question, "waiting"
        except Exception as e:                                  # a worker must never take the coordinator down
            return False, f"worker error: {str(e)[:120]}", "worker error"
        if s.kind == "ask_user":
            return ok, out, "" if ok else "the user said no"
        good, why = self.verify.check(s, ok, out)
        return good, out, why

    # ---- workers -------------------------------------------------------------------------------------------------------
    def _shell(self, s: Step) -> tuple[bool, str]:
        cmd = s.args.get("command", "")
        self.term.task = s.id
        r = self.term.run(cmd)
        if r.needs_confirmation:
            if s.answer is not None:                                    # resumed with the user's answer
                if not YES.match(s.answer):
                    return False, f"denied by the user: `{cmd}` was not run"
                r = self.term.run(cmd, confirm=True)
            elif self.ask_later:
                raise WaitForUser(f"Run this command?\n$ {cmd}\n({r.refused or 'needs approval'})")
            elif self.confirm is not None and self.confirm(cmd):
                r = self.term.run(cmd, confirm=True)
        return r.ok, r.out if r.ok else (r.refused or r.out)

    def _file(self, s: Step) -> tuple[bool, str]:
        op, rel = s.args.get("op", "read"), s.args.get("path", "")
        p = self.verify._path(rel)
        if op == "write":
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "w", encoding="utf-8").write(s.args.get("content", ""))
            return True, f"wrote {rel}"
        if op == "append":
            open(p, "a", encoding="utf-8").write(s.args.get("content", ""))
            return True, f"appended {rel}"
        return True, open(p, encoding="utf-8", errors="replace").read()[:4000]

    def _app_tool(self, s: Step) -> tuple[bool, str]:
        """GitHub, connectors, memory, push: the web app's. Nothing runs here; the call goes out through the runtime port, and a world-changing call needs the user's yes first.
        A port with its own rule (terminal/app_port.AppPort: the web app's shamNeedsOk, the <tool_call> envelope, no credentials) decides and asks itself;
        a plain callable keeps the word rule below."""
        name = s.args.get("name", "")
        if self.app_call is None:
            return False, "no runtime attached: app tools are the web app's"
        args = s.args.get("arguments", {})
        q = f"{name} {json.dumps(args, ensure_ascii=False)[:200]}"
        port_rule = hasattr(self.app_call, "needs_ok")
        needs = self.app_call.needs_ok(name, args) if port_rule else any(w in name.lower() for w in EXTERNAL)
        approved = False
        if needs:
            if s.answer is not None:
                if not YES.match(s.answer):
                    return False, f"denied by the user: {name} was not sent"
                approved = True
            elif self.ask_later:
                raise WaitForUser(f"Allow this action? {q}")
            elif not port_rule and not (self.confirm is not None and self.confirm(q)):
                return False, "needs the user's confirmation"
        try:
            if approved and port_rule:
                return True, str(self.app_call(name, args, approved=True))[:4000]
            return True, str(self.app_call(name, args))[:4000]
        except PermissionError as e:
            return False, str(e)[:300]

    def _ask_user(self, s: Step) -> tuple[bool, str]:
        """With an app port that loads ask_user, the question goes to the user through the app's own ask_user tool; otherwise through confirm()."""
        q = s.args.get("question", "")
        if s.answer is not None:                                        # resumed: the answer the app brought back
            return bool(YES.match(s.answer)), s.answer[:400]
        if self.ask_later:
            raise WaitForUser(q)
        ask = getattr(self.app_call, "ask", None)
        if ask is not None and "ask_user" in getattr(self.app_call, "tools", ()):
            try:
                answer = str(ask(q)).strip()
            except PermissionError as e:
                return False, str(e)[:300]
            return bool(YES.match(answer)), answer[:400]
        return (bool(self.confirm and self.confirm(q)), q)
