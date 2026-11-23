"""Episodic memory: knowledge the model can WRITE at inference time and use at once, with no gradient step (a k-nearest-neighbour datastore over its own hidden
states, the kNN-LM idea). A fact is stored as (hidden state of the context -> the token that followed). When a later context is (nearly) identical to a stored
one, the stored continuation takes over; a context that is not close to anything stored is left entirely to the model, so memory cannot corrupt unrelated answers.
Entries carry a tag, so a wrong or retracted fact can be forgotten exactly."""
from __future__ import annotations

import torch
import torch.nn.functional as F

from .model import Qalam


class EpisodicMemory:
    def __init__(self, width: int, capacity: int = 100_000) -> None:
        self.width, self.capacity = width, capacity
        self.keys = torch.zeros(0, width)
        self.values = torch.zeros(0, dtype=torch.long)
        self.tags: list[str] = []

    def __len__(self) -> int:
        return int(self.values.shape[0])

    def add(self, keys: torch.Tensor, values: torch.Tensor, tag: str = "") -> None:
        if keys.ndim != 2 or keys.shape[1] != self.width or keys.shape[0] != values.shape[0]:
            raise ValueError("keys must be [n, width] with one value each")
        self.keys = torch.cat([self.keys, F.normalize(keys.detach().float().cpu(), dim=-1)])
        self.values = torch.cat([self.values, values.detach().cpu().long()])
        self.tags += [tag] * keys.shape[0]
        if len(self) > self.capacity:                               # oldest out
            drop = len(self) - self.capacity
            self.keys, self.values, self.tags = self.keys[drop:], self.values[drop:], self.tags[drop:]

    def forget(self, tag: str) -> int:
        keep = [i for i, t in enumerate(self.tags) if t != tag]
        removed = len(self) - len(keep)
        idx = torch.tensor(keep, dtype=torch.long)
        self.keys, self.values, self.tags = self.keys[idx], self.values[idx], [self.tags[i] for i in keep]
        return removed

    def lookup(self, query: torch.Tensor, k: int = 4) -> tuple[torch.Tensor, torch.Tensor]:
        """query [width] -> (values [k'], cosine similarities [k']) of its nearest stored contexts."""
        if not len(self):
            return torch.zeros(0, dtype=torch.long), torch.zeros(0)
        sims = self.keys @ F.normalize(query.detach().float().cpu(), dim=-1)
        top = sims.topk(min(k, len(self)))
        return self.values[top.indices], top.values

    def save(self, path) -> None:
        torch.save({"keys": self.keys, "values": self.values, "tags": self.tags, "width": self.width, "capacity": self.capacity}, path)

    @classmethod
    def load(cls, path) -> "EpisodicMemory":
        d = torch.load(path, weights_only=True)
        m = cls(d["width"], d["capacity"])
        m.keys, m.values, m.tags = d["keys"], d["values"], list(d["tags"])
        return m


@torch.no_grad()
def memorize(model: Qalam, mem: EpisodicMemory, ids: torch.Tensor, tag: str = "", last: int = 0) -> int:
    """Write what `ids` says: every position's context -> the token that follows it. `last` > 0 stores only the final `last` transitions (the new fact)."""
    was = model.training
    model.eval()
    try:
        h, _ = model.forward_causal(ids)
    finally:
        model.train(was)
    keys, vals = h[0, :-1], ids[0, 1:]
    if last:
        keys, vals = keys[-last:], vals[-last:]
    mem.add(keys, vals, tag)
    return int(vals.shape[0])


@torch.no_grad()
def generate_with_memory(model: Qalam, prefix: torch.Tensor, mem: EpisodicMemory, max_new: int, k: int = 4, tau: float = 0.98, lam: float = 0.95,
                         temperature: float = 0.05, allowed: list[int] | None = None) -> tuple[list[int], int]:
    """Greedy decoding where a stored continuation overrides the model when the context matches a stored one with cosine >= tau. Returns (tokens, how many came from memory)."""
    cfg = model.cfg
    allowed = allowed or cfg.text_and_end_ids()
    keep = torch.full((cfg.vocab_size,), float("-inf"), dtype=model.embed.weight.dtype)
    keep[allowed] = 0.0
    was = model.training
    model.eval()
    try:
        h, cache = model.forward_causal(prefix)
        out, used = [], 0
        for _ in range(max_new):
            logits = model.lm_head(h[:, -1])[0] + keep
            p = torch.softmax(logits, dim=-1)
            vals, sims = mem.lookup(h[0, -1], k)
            if len(vals) and float(sims[0]) >= tau:
                w = torch.softmax(sims / temperature, dim=-1).to(p.dtype)
                knn = torch.zeros_like(p)
                knn.index_add_(0, vals.to(p.device), w)
                p = (1 - lam) * p + lam * knn
                used += 1
            t = int(p.argmax())
            out.append(t)
            h, cache = model.forward_causal(torch.tensor([[t]]), cache)
        return out, used
    finally:
        model.train(was)
