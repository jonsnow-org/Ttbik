"""One self-evolution engine for the T-LDM writer (the API the serving and Studio workers call).

    eng = EvolutionEngine(model, cfg, tok, workdir, replay_rows=[(task, command)], heldout_tasks=[...])
    # serving (per user request, after the verifier has judged it):
    eng.observe(user, task, command, exit_code, stdout, stderr, verdict, latency_s, reference=None)   # -> record status; failures become lessons
    # evolution step (Studio cycle, or a cron):
    report = eng.evolve_round(verify_for)          # verify_for(task) -> callable(command)->bool (real execution of the task's check) or None
    eng.web_round(fetcher)                          # the web-learning stage (training data only)
    eng.commands(tasks)                             # inference with the router + active adapters (+ lessons when use_lessons=True)
    eng.registry.rollback(family)                   # undo the last accepted adapter of a family

Round: failures of the round -> curriculum repair (best-of-n, verified by execution) -> experience log -> admission (verified, consensus, deny lists, PII,
per-user caps) -> per-family candidate adapters trained on new pairs + replay (original training rows + earlier admitted pairs) -> gate (no loss on
previously-correct items, the dev set and the GUARD set, gain on the family's failed tasks) -> accept (new version active) or reject (kept on disk, not active)."""
from __future__ import annotations

import os
import random
import re
import sys
import time
from collections import defaultdict

import torch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import adapters as AD  # noqa: E402
import curriculum as CU  # noqa: E402
import experience as EX  # noqa: E402
import lessons as LS  # noqa: E402
import web_training as WT  # noqa: E402

# The web-learning recipe measured in docs/experiments/tldm_web_learning_2026-11-18.json (3 seeds): web rows whose command template the model already knows
# ("known": new wordings) -> adapters "kn_<family>", replay-heavy with an L2-to-base (EWC) term; new commands/options ("new") -> "web_<family>". BOTH are
# ROUTED: an adapter serves only requests whose nearest examples (k-NN, the model's own frozen reader) are its web rows; every other request keeps the
# unchanged path. Every adapter still passes the same no-regression gate (previously-correct rows + dev set).
WEB_RECIPE = {"known": dict(ratio=3, lr=5e-4, steps=150, l2=0.1), "new": dict(ratio=1, lr=1e-3, steps=300)}


class CachedExecutor:
    """Runs a command once per distinct text in a fresh sandbox (the fixture is identical every time) -> (ok, normalised output, folder snapshot)."""

    def __init__(self, terminal_tasks):
        self.T, self.cache = terminal_tasks, {}

    def run(self, cmd: str):
        if cmd not in self.cache:
            self.cache[cmd] = self.T.execute(cmd, confirm=True)       # confirm=True: the user approved (the same rule as the held-out metric, T.same_effect)
        return self.cache[cmd]

    def same_effect(self, ref: str, cmd: str) -> bool:
        a = self.run(ref)
        return bool(a[0]) and a == self.run(cmd)


class EvolutionEngine:
    def __init__(self, model, cfg, tok, workdir: str, replay_rows: list, heldout_tasks: list, rank: int = 8, steps: int = 120, lr: float = 1e-3,
                 min_consensus: int = 2, max_lost: float = 0.02, defences: bool = True, use_lessons: bool = False, seed: int = 0, too_close=None, executor=None):
        self.P = CU.WriterPolicy(model, cfg, tok)
        self.model, self.cfg, self.tok = model, cfg, tok
        self.workdir = workdir
        os.makedirs(workdir, exist_ok=True)
        self.log = EX.ExperienceLog(os.path.join(workdir, "experience"))
        self.lessons = LS.LessonStore(os.path.join(workdir, "lessons.json"))
        self.registry = AD.AdapterRegistry(os.path.join(workdir, "adapters"))
        self.replay = [(t, c) for t, c in replay_rows if self.P.fits(c)]
        self.heldout = list(heldout_tasks)
        self.rank, self.steps, self.lr, self.seed = rank, steps, lr, seed
        self.min_consensus, self.max_lost, self.defences, self.use_lessons = min_consensus, max_lost, defences, use_lessons
        self._too_close = too_close
        self.ex = executor
        self.admitted_cache: list = []
        self.rng = random.Random(seed)
        self.pending_failures: list = []                            # (task, wrong command, verify) of the current round
        self.prev_correct: dict = {}                                 # item id -> (task, verify): items the active model got right when first seen
        self.dev: dict = {}                                          # item id -> (task, verify): never trained on
        self.guard: dict = {}                                        # item id -> (task, verify): natural requests for known commands (data/guard.py);
        self._guard_texts: list = []                                 # gate-only, disjoint from held-out, decontaminated from training like held-out
        self.trained_on: set = set()
        AD.wrap(model)
        self.router = AD.Router(self._embed)
        self._refit_router([])
        self.events: list = []
        self.web_router = None

    def too_close(self, task: str) -> str:
        """Training decontamination: '' or why `task` may not be trained on (the caller's held-out/benchmark/dev check, or too close to a GUARD task)."""
        r = self._too_close(task) if self._too_close else ""
        if not r and self._guard_texts:
            w = set(re.findall(r"\w+", task.lower()))
            for g in self._guard_texts:
                h = set(re.findall(r"\w+", g.lower()))
                if task.strip().lower() == g.strip().lower() or (w and len(w & h) / len(w | h) >= 0.5):
                    return "guard"
        return r

    def set_guard(self, rows: list):
        """rows: [(task, reference_command)] -> the gate's GUARD set (needs the executor). Requests a router could misroute to a new adapter."""
        self.guard = {f"g{i}": (t, (lambda o, c=c: self.ex.same_effect(c, o))) for i, (t, c) in enumerate(rows)}
        self._guard_texts = [t for t, _ in rows]

    # ------------------------------------------------------------ inference
    @torch.no_grad()
    def _embed(self, texts):
        m = self.model
        if hasattr(m, "_feats"):
            h, pad = m._feats(list(texts))
            keep = (~pad).float()[..., None]
            return (h * keep).sum(1) / keep.sum(1).clamp(min=1)
        ids = torch.tensor([self.tok.encode(t, self.cfg["in_len"]) for t in texts])
        return m.read(ids).mean(1)

    def _refit_router(self, extra: list) -> None:
        rows = self.replay + [(t, c) for t, c, _ in extra]
        self.router.fit([t for t, _ in rows], [EX.family(c) for _, c in rows])

    def commands(self, tasks: list, use_lessons: bool | None = None) -> list:
        active = self.registry.active()
        fams = [f for f, _ in self.router.route(tasks)] if active else [None] * len(tasks)
        webs = self.web_router.route(tasks) if self.web_router is not None and any(k.startswith(("web_", "kn_")) for k in active) else [None] * len(tasks)
        out = [None] * len(tasks)
        groups = defaultdict(list)
        for i, f in enumerate(fams):                                 # priority: routed web knowledge > the family's user adapter > base
            pick = webs[i] if webs[i] in active else f if f in active else None
            groups[pick].append(i)
        for f, idx in groups.items():
            AD.set_active(self.model, f)
            res = self.P.commands([tasks[i] for i in idx])
            for i, c in zip(idx, res):
                out[i] = c
        AD.set_active(self.model, None)
        if use_lessons if use_lessons is not None else self.use_lessons:
            for i, t in enumerate(tasks):
                f = fams[i] if fams[i] in active else None
                AD.set_active(self.model, f)
                cands = [(c, 0) for c, _, _ in self.P.sample(t, n=6, temps=(0.3,), seed=i)]
                out[i], _ = self.lessons.decide(cands, t)
            AD.set_active(self.model, None)
        return out

    # ------------------------------------------------------------ serving hook
    def observe(self, user: str, task: str, command: str, exit_code: int, stdout: str = "", stderr: str = "", verdict=None, latency_s: float = 0.0,
                verify=None, source: str = "user", meta: dict | None = None, claim=None) -> str:
        """One finished request. verdict = the verifier's judgement (None = unknown: stored, never trained on). verify (optional) = the task's check, used
        by the curriculum to repair a failure. claim = what the user said (kept separately; it never replaces the verifier)."""
        rec = EX.make_record(user, task, command, exit_code, stdout, stderr, verdict, latency_s, adapter=",".join(f"{k}@{v}" for k, v in self.registry.active().items()) or "base",
                             source=source, meta=meta)
        if claim is not None:
            rec["claim"] = claim
        st = self.log.add(rec)
        if verdict is True:
            self.lessons.add_success(task, command)
        elif verdict is False:
            self.lessons.add_failure(task, command)
            if verify is not None:
                self.pending_failures.append((task, command, verify))
        return st

    # ------------------------------------------------------------ training data
    def admitted(self):
        if self.defences:
            pairs, why = self.log.admitted(self.min_consensus, return_reasons=True)
        else:                                                        # ablation only: trust the user's claim, no consensus, no deny list
            pairs = list(dict.fromkeys((r["intent"], r["command"], r["family"]) for r in self.log.records if (r.get("claim") if "claim" in r else r.get("verdict")) is True))
            why = {"admitted": len(pairs), "defences": "OFF"}
        pairs = [(t, c, f) for t, c, f in pairs if self.P.fits(c) and not self.too_close(t)]
        return pairs, why

    def repair_failures(self, user: str = "curriculum") -> dict:
        n_fixed = n_pairs = 0
        for task, wrong, verify in self.pending_failures:
            found = CU.repair(self.P, task, verify, self.rng, too_close=self.too_close)
            n_fixed += bool(found)
            for text, cmd, s, how in found:
                ok, out, _ = self.ex.run(cmd) if self.ex else (True, "", "")
                self.log.add(EX.make_record(user, text, cmd, 0 if ok else 1, out, "", True, 0.0, source="curriculum", meta={"seed": s, "variant_of": task}))
                self.lessons.add_success(text, cmd)
                n_pairs += 1
        r = {"failures": len(self.pending_failures), "repaired": n_fixed, "verified_pairs": n_pairs}
        return r

    # ------------------------------------------------------------ adapters
    def _train(self, fam: str, rows: list):
        name = f"cand_{fam}"
        AD.drop_adapter(self.model, name)
        params = AD.add_adapter(self.model, name, self.rank)
        if fam in self.registry.active():                            # continue from the active version (continual learning)
            for (A, B), m in zip(self.registry.load(fam), AD.lora_modules(self.model)):
                if A.shape == m.A[name].shape:
                    m.A[name].data.copy_(A)
                    m.B[name].data.copy_(B)
        AD.set_active(self.model, name)
        g = torch.Generator().manual_seed(self.seed)
        replay = self.replay + [(t, c) for t, c, _ in self.admitted_cache]
        opt = torch.optim.AdamW(params, lr=self.lr)
        self.model.train()
        for _ in range(self.steps):
            new = [rows[i] for i in torch.randint(0, len(rows), (16,), generator=g).tolist()]
            old = [replay[i] for i in torch.randint(0, len(replay), (16,), generator=g).tolist()]
            x, y = self.P.pairs(new + old)
            opt.zero_grad(set_to_none=True)
            self.model.loss(x, y).backward()
            opt.step()
        self.model.eval()
        AD.set_active(self.model, None)
        return name

    def _system_score(self, items: dict) -> dict:
        if not items:
            return {}
        keys = list(items)
        outs = self.commands([items[k][0] for k in keys], use_lessons=False)
        return {k: bool(items[k][1](o)) for k, o in zip(keys, outs)}

    def learn_web(self, kept: list, recipe: dict | None = None) -> dict:
        """The web-learning stage (training data only). kept: verify_and_filter() output. -> per-adapter gate results."""
        import augment as AUG
        recipe = recipe or WEB_RECIPE
        for k in kept:
            ok, out, _ = self.ex.run(k["command"]) if self.ex else (True, "", "")
            self.observe("web", k["task"], k["command"], 0 if ok else 1, out, "", True, source="web", meta={"url": k["url"], "license": k["license"]})
        rows = [(k["task"], k["command"], k["family"]) for k in kept if self.P.fits(k["command"]) and not self.too_close(k["task"])]
        known_tpl = {AUG.delex(t, c)[1] for t, c in self.replay}
        tier = {(t, c): ("known" if AUG.delex(t, c)[1] in known_tpl else "new") for t, c, _ in rows}
        self.web_router = WT.WebRouter(self._embed)                    # both tiers ROUTED: an adapter only serves requests whose nearest examples are its web rows
        self.web_router.fit([t for t, _ in self.replay], [t for t, _, _ in rows], [("kn_" if tier[(t, c)] == "known" else "web_") + f for t, c, f in rows], prefix="")
        rep = {}
        for which, prefix in (("known", "kn_"), ("new", "web_")):
            sel = [r for r in rows if tier[r[:2]] == which]
            for fam in sorted({f for _, _, f in sel}, key=lambda f: -sum(1 for r in sel if r[2] == f)):
                fr = [(t, c) for t, c, f in sel if f == fam]
                name = prefix + fam
                target = {f"w{i}": (t, (lambda o, ref=c: self.ex.same_effect(ref, o))) for i, (t, c) in enumerate(fr)}
                before = {"prev_correct": self._system_score(self.prev_correct), "dev": self._system_score(self.dev), "guard": self._system_score(self.guard),
                          "target": self._system_score(target)}
                WT.train_adapter(self.P, self.model, name, fr, self.replay, seed=self.seed, **recipe[which])
                self.registry.m["clusters"].setdefault(name, {"active": None, "history": [], "versions": []})
                vid = self.registry.propose(name, AD.adapter_state(self.model, name), {})
                self.registry.accept(name, vid, "candidate")             # tentatively active, so commands() routes to it
                after = {"prev_correct": self._system_score(self.prev_correct), "dev": self._system_score(self.dev), "guard": self._system_score(self.guard),
                         "target": self._system_score(target)}
                ok, why = AD.gate(before, after, "target", ("prev_correct", "dev", "guard"), self.max_lost)
                v = self.registry._v(name, vid)
                v["metrics"] = {k: [sum(before[k].values()), sum(after[k].values()), len(before[k])] for k in before}
                if ok:
                    v.update(status="accepted", why=why)
                    self.registry._save()
                else:
                    self.registry.rollback(name)
                    self.registry.reject(name, vid, why)
                    AD.drop_adapter(self.model, name)
                rep[name] = {"pairs": len(fr), "accepted": ok, "why": why}
        return rep

    def _score(self, items: dict, adapter: str | None) -> dict:
        if not items:
            return {}
        AD.set_active(self.model, adapter)
        keys = list(items)
        outs = self.P.commands([items[k][0] for k in keys])
        AD.set_active(self.model, None)
        return {k: bool(items[k][1](o)) for k, o in zip(keys, outs)}

    def evolve_round(self) -> dict:
        t0 = time.time()
        rep = {"curriculum": self.repair_failures()}
        pairs, why = self.admitted()
        self.admitted_cache = pairs
        rep["admission"] = why
        new = [(t, c, f) for t, c, f in pairs if (t, c) not in self.trained_on]
        by_fam = defaultdict(list)
        for t, c, f in new:
            by_fam[f].append((t, c))
        fails_by_fam = defaultdict(dict)
        for i, (task, wrong, verify) in enumerate(self.pending_failures):
            fails_by_fam[EX.family(next((c for t, c, f in pairs if t == task), wrong))][f"fail{i}"] = (task, verify)
        rep["families"] = {}
        for fam, rows in sorted(by_fam.items()):
            active = self.registry.active().get(fam)
            target = dict(fails_by_fam.get(fam, {}))
            target.update({f"new{i}": (t, (lambda o, ref=c: self.ex.same_effect(ref, o))) for i, (t, c) in enumerate(rows)})
            before = {"prev_correct": self._score(self.prev_correct, fam if active else None), "dev": self._score(self.dev, fam if active else None),
                      "guard": self._score(self.guard, fam if active else None), "target": self._score(target, fam if active else None)}
            # the active adapters of OTHER families do not change; the gate compares this family's adapter slot only (items routed elsewhere are unaffected
            # at inference, but are still checked here: a family adapter must not break anything it would be applied to by a router mistake)
            cand = self._train(fam, rows)
            after = {"prev_correct": self._score(self.prev_correct, cand), "dev": self._score(self.dev, cand), "guard": self._score(self.guard, cand),
                     "target": self._score(target, cand)}
            ok, reason = AD.gate(before, after, "target", ("prev_correct", "dev", "guard"), self.max_lost)
            state = AD.adapter_state(self.model, cand)
            metrics = {k: [sum(before[k].values()), sum(after[k].values()), len(before[k])] for k in before}
            vid = self.registry.propose(fam, state, metrics)
            if ok:
                self.registry.accept(fam, vid, reason)
                AD.load_adapter(self.model, fam, state)
                self.trained_on |= {(t, c) for t, c in rows}
            else:
                self.registry.reject(fam, vid, reason)
            AD.drop_adapter(self.model, cand)
            rep["families"][fam] = {"pairs": len(rows), "version": vid, "accepted": ok, "why": reason, "metrics": metrics,
                                    "adapter_kb": round(AD.size_bytes(state) / 1024, 1)}
        self._refit_router(pairs)
        self.pending_failures = []
        self.lessons.save()
        rep["secs"] = round(time.time() - t0, 1)
        self.events.append(rep)
        return rep
