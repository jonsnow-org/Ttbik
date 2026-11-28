"""Thinking that is a PROCESS, not a longer answer. Qalam spends inference compute where it pays and checks its own work with things that are not itself:

  direct        one attempt (cheap tasks stop here)
  consensus     k independent samples, majority vote; the agreement rate is the confidence (self-consistency)
  plan + solve  write a plan, solve the steps IN ORDER, check each step, and when one fails, REFLECT on the failure and retry, then REPLAN (sequential reasoning with backtracking)
  search        beam search over partial thoughts, ranked by a scorer, pruned, deepened (tree of thoughts)
  reflect       a critique of the best answer, a revision, accepted only if it is verified better

Everything is driven by a `Policy` (propose candidate texts for a prompt) and, when one exists, a VERIFIER that is not the model (tests, an executor, a calculation, a file check).
An answer is called `verified` only when a verifier said yes; otherwise the result says how confident the vote was and nothing more. Compute is bounded by a `Budget`
(calls and seconds). Every run leaves a `Trace`; a verified trace is training data for the next version (`Trace.to_pair`). The machinery is code and is tested; how good the
THOUGHTS are comes from training the model (notebook N07), and the notes in docs/REASONING.md say so."""
from __future__ import annotations

import re
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Callable, Protocol


class Policy(Protocol):
    def propose(self, prompt: str, n: int = 1, start: int = 0) -> list[str]:
        """n candidate continuations; candidate i of a call is sample number start+i (a sampler uses it as its seed, so repeated runs are reproducible)."""


@dataclass
class Budget:
    calls: int = 32
    seconds: float = 120.0
    used: int = 0
    t0: float = field(default_factory=time.monotonic)

    def left(self) -> int:
        if time.monotonic() - self.t0 > self.seconds:
            return 0
        return max(0, self.calls - self.used)

    def take(self, n: int) -> int:
        """Reserve up to n calls; returns how many were granted."""
        g = min(n, self.left())
        self.used += g
        return g


@dataclass
class Trace:
    task: str
    events: list[dict] = field(default_factory=list)

    def add(self, kind: str, text: str = "", **kw) -> None:
        self.events.append({"kind": kind, "text": text[:2000], **kw})

    def to_pair(self) -> tuple[str, str] | None:
        """(task, a thinking text ending in the verified answer) from a SUCCESSFUL path only: failed attempts are used as the 'what went wrong' lines of a retry, never as the answer."""
        final = [e for e in self.events if e["kind"] == "answer" and e.get("verified")]
        if not final:
            return None
        keep = [e for e in self.events if e["kind"] in ("plan", "step", "reflect", "critique") and e.get("ok", True)]
        body = "\n".join(f"[{e['kind']}] {e['text']}" for e in keep)
        return self.task, (body + "\n" if body else "") + f"ANSWER: {final[-1]['text']}"


@dataclass
class Result:
    answer: str | None
    verified: bool
    mode: str
    confidence: float
    calls: int
    exhausted: bool
    trace: Trace


def _last_line(s: str) -> str:
    s = s.strip()
    m = re.findall(r"ANSWER:\s*(.+)", s)
    return (m[-1] if m else (s.splitlines() or [""])[-1]).strip()


class Thinker:
    def __init__(self, policy: Policy, verify: Callable[[str, str], bool] | None = None, extract: Callable[[str], str] = _last_line,
                 critic: Callable[[str, str], str] | None = None, scorer: Callable[[str, str], float] | None = None,
                 step_check: Callable[[str, str, str], bool] | None = None, is_final: Callable[[str], bool] = lambda s: "ANSWER:" in s,
                 threads: int = 1) -> None:
        self.policy, self.verify, self.extract, self.critic, self.scorer = policy, verify, extract, critic, scorer
        self.step_check, self.is_final, self.threads = step_check, is_final, max(1, threads)

    # ------------------------------------------------------------------ building blocks
    def _sample(self, prompt: str, n: int, start: int, budget: Budget) -> list[str]:
        n = budget.take(n)
        if n <= 0:
            return []
        if self.threads > 1 and n > 1:                                   # independent samples can be drawn in parallel; each keeps its own sample number
            with ThreadPoolExecutor(min(self.threads, n)) as ex:
                return [r[0] for r in ex.map(lambda i: self.policy.propose(prompt, 1, start + i), range(n)) if r]
        return list(self.policy.propose(prompt, n, start))[:n]

    def _ok(self, task: str, text: str) -> bool:
        return bool(self.verify and self.verify(task, text))

    # ------------------------------------------------------------------ the escalation ladder
    def solve(self, task: str, budget: Budget | None = None, samples: int = 5, tau: float = 0.6, retries: int = 2, replans: int = 2, beam: int = 3, depth: int = 4,
              modes: tuple[str, ...] = ("direct", "consensus", "plan_solve", "search", "reflect")) -> Result:
        budget = budget or Budget()
        tr = Trace(task)
        cands: list[tuple[str, str]] = []                                  # (raw, extracted)
        best: str | None = None
        conf = 0.0

        def done(ans: str | None, ok: bool, mode: str, c: float) -> Result:
            tr.add("answer", ans or "", verified=ok, mode=mode)
            return Result(ans, ok, mode, c, budget.used, budget.left() == 0 and not ok, tr)

        for mode in modes:
            if budget.left() == 0:
                break
            if mode == "direct":
                for raw in self._sample(task, 1, 0, budget):
                    ans = self.extract(raw)
                    cands.append((raw, ans))
                    tr.add("direct", raw)
                    if self._ok(task, ans):
                        return done(ans, True, "direct", 1.0)
            elif mode == "consensus":
                for raw in self._sample(task, samples, len(cands), budget):
                    cands.append((raw, self.extract(raw)))
                votes = Counter(a for _, a in cands if a)
                tr.add("consensus", str(dict(votes)))
                for _, a in cands:
                    if a and self._ok(task, a):
                        return done(a, True, "consensus", votes[a] / max(1, len(cands)))
                if votes:
                    best, cnt = votes.most_common(1)[0]
                    conf = cnt / len(cands)
                    if self.verify is None and conf >= tau and len(cands) >= 3:      # no checker: agreement is all there is, and it is reported as such
                        return done(best, False, "consensus", conf)
            elif mode == "plan_solve":
                r = self._plan_solve(task, budget, tr, retries, replans)
                if r is not None:
                    cands.append((r, r))
                    if self._ok(task, r):
                        return done(r, True, "plan_solve", 1.0)
                    best = best or r
            elif mode == "search" and self.scorer is not None:
                r = self._search(task, budget, tr, beam, depth)
                if r is not None:
                    cands.append((r, r))
                    if self._ok(task, r):
                        return done(r, True, "search", 1.0)
                    best = best or r
            elif mode == "reflect" and self.critic is not None and (best or cands):
                cur = best or cands[-1][1]
                for r_i in range(max(1, retries)):
                    if budget.left() == 0:
                        break
                    note = self.critic(task, cur)
                    tr.add("critique", note, ok=bool(note))
                    if not note:
                        break
                    fixes = self._sample(f"{task}\nPREVIOUS ANSWER: {cur}\nCRITIQUE: {note}\nREVISED ANSWER:", 1, 100 + r_i, budget)
                    if not fixes:
                        break
                    cur = self.extract(fixes[0])
                    tr.add("reflect", cur)
                    if self._ok(task, cur):
                        return done(cur, True, "reflect", 1.0)
                best = best or cur
        return done(best, False, "exhausted" if budget.left() == 0 else "unverified", conf)

    # ------------------------------------------------------------------ sequential reasoning with backtracking
    @staticmethod
    def parse_plan(text: str) -> list[str]:
        steps = [re.sub(r"^\s*(\d+[.)]|[-*•])\s*", "", ln).strip() for ln in text.splitlines() if re.match(r"^\s*(\d+[.)]|[-*•])\s+\S", ln)]
        return steps[:12]

    def _plan_solve(self, task: str, budget: Budget, tr: Trace, retries: int, replans: int) -> str | None:
        failure = ""
        for attempt in range(replans + 1):
            plan_prompt = f"PLAN: {task}" + (f"\nTHE PREVIOUS PLAN FAILED: {failure}\nMake a different plan." if failure else "")
            got = self._sample(plan_prompt, 1, 200 + attempt, budget)
            steps = self.parse_plan(got[0]) if got else []
            tr.add("plan", "\n".join(steps), ok=bool(steps))
            if not steps:
                failure = "the plan had no numbered steps"
                continue
            done: list[str] = []
            ok_all = True
            for i, st in enumerate(steps, 1):
                feedback, out = "", None
                for r_i in range(retries + 1):
                    ctx = f"TASK: {task}\nPLAN:\n" + "\n".join(f"{j}. {s}" for j, s in enumerate(steps, 1)) + "\nDONE:\n" + "\n".join(done) + f"\nSTEP {i}: {st}" + (f"\nFEEDBACK: {feedback}" if feedback else "")
                    got = self._sample(ctx, 1, 300 + 10 * i + r_i, budget)
                    if not got:
                        return None
                    cand = got[0].strip()
                    good = bool(cand) and (self.step_check is None or self.step_check(task, st, cand))
                    tr.add("step", f"{i}. {st} -> {cand}", ok=good)
                    if good:
                        out = cand
                        break
                    feedback = f"your answer to step {i} was rejected: {cand[:200]}"
                    tr.add("reflect", feedback, ok=False)
                if out is None:
                    ok_all, failure = False, f"step {i} ('{st}') could not be solved"
                    break
                done.append(f"{i}. {out}")
            if ok_all:
                got = self._sample(f"TASK: {task}\nSTEPS DONE:\n" + "\n".join(done) + "\nGive the final ANSWER:", 1, 900 + attempt, budget)
                return self.extract(got[0]) if got else None
        return None

    # ------------------------------------------------------------------ beam search over partial thoughts
    def _search(self, task: str, budget: Budget, tr: Trace, beam: int, depth: int) -> str | None:
        frontier = [("", 0.0)]
        for d in range(depth):
            nxt: list[tuple[str, float]] = []
            for fi, (state, _) in enumerate(frontier):
                if self.is_final(state):
                    nxt.append((state, self.scorer(task, state)))
                    continue
                for th in self._sample(f"{task}\nTHOUGHTS SO FAR:\n{state}\nNEXT THOUGHT:", beam, 500 + 20 * d + fi * 7, budget):
                    s2 = (state + "\n" + th.strip()).strip()
                    nxt.append((s2, self.scorer(task, s2)))
            if not nxt:
                break
            nxt.sort(key=lambda x: -x[1])
            frontier = nxt[:beam]                                          # prune: only the best partial thoughts survive
            tr.add("step", f"depth {d + 1}: best score {frontier[0][1]:.2f}", ok=True)
            fin = [s for s, _ in frontier if self.is_final(s)]
            if fin:
                return self.extract(fin[0])
        fin = [s for s, _ in frontier if self.is_final(s)]
        return self.extract(fin[0]) if fin else None


class ModelPolicy:
    """A `Policy` backed by a Qalam model: sampled at a temperature with a per-sample seed (diverse AND reproducible), reading the prompt as text."""

    def __init__(self, model, encode: Callable[[str], list[int]], decode: Callable[[list[int]], str], temperature: float = 0.8, max_new: int = 128, top_p: float = 0.95) -> None:
        self.model, self.encode, self.decode, self.t, self.max_new, self.top_p = model, encode, decode, temperature, max_new, top_p

    def propose(self, prompt: str, n: int = 1, start: int = 0) -> list[str]:
        import torch
        cfg = self.model.cfg
        ids = torch.tensor([[cfg.special_id("BOS")] + self.encode(prompt)])
        outs = []
        for i in range(n):
            gen = self.model.generate(ids, self.max_new, temperature=self.t if (start + i) else 0.0, top_p=self.top_p, stop_id=cfg.special_id("EOS"), seed=start + i)
            outs.append(self.decode([t for t in gen[0].tolist() if t < cfg.text_vocab]))
        return outs
