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

    # Multi-block writing (2026-11-18): a command longer than one block is written as a CHAIN of blocks. Every block but the last ends with CONT (shell
    # line-continuation style); the next block is written for the input "<task> SEP <previous block>". At most `max_blocks` blocks (cfg "max_blocks", 4).
    CONT = " \\"
    SEP = " \u27eb "

    def __init__(self, model, cfg, tok):
        self.model, self.cfg, self.tok = model, cfg, tok
        self.delex = bool(cfg.get("delex", False))
        self.donor = bool(cfg.get("donor"))
        self.max_blocks = int(cfg.get("max_blocks", 4))

    def _inputs(self, tasks):
        dl = [AUG.delex(t) if self.delex else (t, None, {}) for t in tasks]
        if self.donor:
            return [d[0] for d in dl], dl
        return torch.tensor([self.tok.encode(d[0], self.cfg["in_len"]) for d in dl]), dl

    @torch.no_grad()
    def _blocks(self, texts, temperature: float = 0.0) -> list:
        out_all = []
        for i in range(0, len(texts), 64):
            ids, dl = self._inputs(texts[i:i + 64])
            out, _ = self.model.generate(ids, steps=self.cfg["diffusion_steps"], temperature=temperature)
            out_all += [AUG.relex(self.tok.decode(row), d[2]) for row, d in zip(out, dl)]
        return out_all

    @torch.no_grad()
    def commands(self, tasks, temperature: float = 0.0) -> list:
        if not tasks:
            return []
        self.model.eval()
        out_all = self._blocks(list(tasks), temperature)
        parts = {i: [c[:-len(self.CONT)]] for i, c in enumerate(out_all) if c.endswith(self.CONT)}
        pending = list(parts)
        for _ in range(self.max_blocks - 1):                         # continue the chains that asked for another block
            if not pending:
                break
            nxt = self._blocks([self.cont_input(tasks[i], parts[i][-1]) for i in pending], temperature)
            still = []
            for i, c in zip(pending, nxt):
                if c.endswith(self.CONT):
                    parts[i].append(c[:-len(self.CONT)])
                    still.append(i)
                else:
                    parts[i].append(c)
            pending = still
        for i, ps in parts.items():
            out_all[i] = " ".join(p for p in ps if p)
        return out_all

    def cont_input(self, task: str, prev_block: str) -> str:
        return f"{task}{self.SEP}{prev_block}"

    def chunks(self, command: str):
        """-> [block texts] (one block = [command]) or None when the command cannot be written in <= max_blocks blocks (split at spaces only)."""
        if self.fits(command):
            return [command]
        out, cur = [], None
        for w in command.split(" "):
            cand = w if cur is None else cur + " " + w
            if self.fits(cand + self.CONT):
                cur = cand
            elif cur is None:
                return None                                          # one word longer than a block
            else:
                out.append(cur)
                cur = w
        if cur is None or not self.fits(cur):
            return None
        out.append(cur)
        if len(out) > self.max_blocks or " ".join(out) != command:
            return None
        return out

    def fits_chain(self, command: str) -> bool:
        return self.chunks(command) is not None

    def chain_rows(self, rows) -> list:
        """[(task, command)] -> [(input text, block target)]: one row per block (a single-block command stays as it is; unwritable ones are dropped)."""
        out = []
        for t, c in rows:
            ch = self.chunks(c)
            if not ch:
                continue
            for j, b in enumerate(ch):
                out.append((t if j == 0 else self.cont_input(t, ch[j - 1]), b + (self.CONT if j < len(ch) - 1 else "")))
        return out

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
        """[(task, command)] -> (inputs, targets) in the model's training format. A command longer than one block becomes its chain of blocks."""
        if any(not self.fits(c) for _, c in rows):
            rows = [r for row in rows for r in (self.chain_rows([row]) if not self.fits(row[1]) else [row])] or list(rows)
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
