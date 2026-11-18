"""Self-generated curriculum for the T-LDM writer: a failed task is not a dead end.

For every failure: K VARIANTS of the task are made (filler words, dropped words, polite prefixes/suffixes, case; never closer than the decontamination rule
allows to a held-out task), the writer SAMPLES n commands for the task and each variant over a temperature ladder (best-of-n), and every distinct candidate
is RUN in the sandbox and judged by the verifier. A verified command becomes a training pair for the ORIGINAL wording (the one that failed) and for the
variant that found it. Each (task, command) pair carries the sampling seed, so the experience log's consensus rule can count independent finds.

Why the old training/evolve.py and training/lora_failed.py produced 0 verified pairs (2026-11-18 audit): the failures there were file names the loop model had
never seen (before argument slots), so no amount of sampling could write them; and sampling the whole 24-32-token block at T=0.8 in one go garbles most
commands. Here: the argument is copied through slots/the task, the ladder starts at a low temperature, and variants change the reader's view of the task."""
from __future__ import annotations

import os
import random
import re
import sys

import torch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "data"))
import augment as AUG  # noqa: E402

FILLER_PRE = ["please ", "can you ", "now ", "quickly ", "hey, ", "i need to ", "could you "]
FILLER_POST = [" please", " now", " for me", " thanks", " quickly"]


def variants(task: str, rng: random.Random, k: int = 4, too_close=None) -> list:
    """Surface variants of one task (same intent, same arguments). too_close(text) -> '' when the text is allowed (decontamination)."""
    out, tries = [], 0
    words = task.split()
    while len(out) < k and tries < 10 * k:
        tries += 1
        w = list(words)
        op = rng.randrange(6)
        if op == 0 and len(w) > 2:
            i = rng.randrange(len(w))
            if not AUG.FILE.search(w[i]) and not AUG.NUM.search(w[i]):
                w.pop(i)
        elif op == 1:
            w = (rng.choice(FILLER_PRE) + " ".join(w)).split()
        elif op == 2:
            w = (" ".join(w) + rng.choice(FILLER_POST)).split()
        elif op == 3:
            w = [x.lower() if not AUG.FILE.search(x) else x for x in w]
        elif op == 5:                                                # a typo: two neighbouring letters of a non-argument word swapped
            idx = [i for i, x in enumerate(w) if len(x) > 3 and x.isalpha()]
            if idx:
                i = rng.choice(idx)
                j = rng.randrange(len(w[i]) - 1)
                w[i] = w[i][:j] + w[i][j + 1] + w[i][j] + w[i][j + 2:]
        else:
            if len(w) > 3:
                i = rng.randrange(len(w) - 1)
                w[i], w[i + 1] = w[i + 1], w[i]
        v = " ".join(w)
        if v != task and v not in out and not (too_close and too_close(v)):
            out.append(v)
    return out


class WriterPolicy:
    """The single-command writer (DonorTLDM or Sham1_TLDM head) as a policy: greedy/sampled commands for task texts, and training pairs."""

    def __init__(self, model, cfg, tok):
        self.model, self.cfg, self.tok = model, cfg, tok
        self.delex = bool(cfg.get("delex", False))
        self.donor = bool(cfg.get("donor"))

    def _inputs(self, tasks):
        dl = [AUG.delex(t) if self.delex else (t, None, {}) for t in tasks]
        if self.donor:
            return [d[0] for d in dl], dl
        return torch.tensor([self.tok.encode(d[0], self.cfg["in_len"]) for d in dl]), dl

    @torch.no_grad()
    def commands(self, tasks, temperature: float = 0.0) -> list:
        if not tasks:
            return []
        self.model.eval()
        out_all = []
        for i in range(0, len(tasks), 64):
            ids, dl = self._inputs(tasks[i:i + 64])
            out, _ = self.model.generate(ids, steps=self.cfg["diffusion_steps"], temperature=temperature)
            out_all += [AUG.relex(self.tok.decode(row), d[2]) for row, d in zip(out, dl)]
        return out_all

    def sample(self, task: str, n: int = 8, temps=(0.3, 0.6, 1.0), seed: int = 0) -> list:
        """-> [(command, temperature, seed)] distinct commands, greedy first."""
        seen, out = set(), []
        g = self.commands([task])[0]
        seen.add(g)
        out.append((g, 0.0, seed))
        for j, t in enumerate(temps):
            torch.manual_seed(seed * 7919 + j)
            for c in self.commands([task] * n, temperature=t):
                if c not in seen:
                    seen.add(c)
                    out.append((c, t, seed))
        return out

    def pairs(self, rows):
        """[(task, command)] -> (inputs, targets) in the model's training format."""
        dl = [AUG.delex(t, c) if self.delex else (t, c, {}) for t, c in rows]
        tgt = torch.tensor([self.tok.encode(d[1], self.cfg["block"]) for d in dl])
        if self.donor:
            return [d[0] for d in dl], tgt
        return torch.tensor([self.tok.encode(d[0], self.cfg["in_len"]) for d in dl]), tgt

    def fits(self, command: str) -> bool:
        ids = [i for i in self.tok.encode(command, self.cfg["block"] + 8) if i]
        return len(ids) < self.cfg["block"] and self.tok.decode(self.tok.encode(command, self.cfg["block"])) == command


def repair(policy: WriterPolicy, task: str, verify, rng: random.Random, n: int = 8, k_variants: int = 4, seeds=(0, 1), too_close=None) -> list:
    """Best-of-n repair of ONE failed task. verify(command) -> bool runs the command for the task's intent (real execution).
    -> [(text, command, seed, how)] verified pairs (text = the original task or a variant)."""
    found = []
    texts = [task] + variants(task, rng, k_variants, too_close)
    for s in seeds:
        checked = {}
        for t in texts:
            for c, temp, sd in policy.sample(t, n=n, seed=s * 101 + len(found)):
                if c not in checked:
                    checked[c] = bool(c.strip()) and verify(c)
                if checked[c]:
                    found.append((task, c, s, "original" if t == task else "variant"))
                    if t != task:
                        found.append((t, c, s, "variant"))
                    break
            if any(f[2] == s for f in found):
                break
    return found
