"""Training recipes that let WEB data in without breaking what the model already knows (2026-11-18, owner: web learning must work, gate stays).

    train_adapter(policy, model, name, new_rows, replay_rows, ratio=3, lr=5e-4, steps=60, l2=0.0, order="random", scale=1.0)
        ratio  : replay rows per new row in every batch (3 = 3 old : 1 web)
        l2     : L2-to-base on the adapter's delta, sum ||dW||^2 (the base is frozen, so this is EWC with a uniform Fisher)
        order  : "random" | "curriculum" (easy -> hard: new rows sorted by the base model's own loss; the pool grows from 30% to 100%)
        scale  : merge with a small weight: the trained delta is multiplied by `scale` (0.5 = half strength)
    WebRouter(embed_fn).fit(base_tasks, web_tasks, web_fams, prefix="web_"); .route(tasks) -> adapter name or None
        a SEPARATE web adapter family per task cluster ("web_count", ...), applied only to requests whose nearest examples (k-NN on the model's own frozen
        reader) are web examples; everything else keeps the unchanged base path. Routing between ADAPTERS of one model, never between models."""
from __future__ import annotations

import os
import sys

import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import adapters as AD  # noqa: E402


def _delta_l2(model, name):
    tot = 0.0
    for m in AD.lora_modules(model):
        if name in m.A:
            A, B = m.A[name], m.B[name]
            tot = tot + ((B @ A) * (m.alpha / A.shape[0])).pow(2).sum()
    return tot


def _row_losses(policy, model, rows):
    out = []
    with torch.no_grad():
        for r in rows:
            x, y = policy.pairs([r])
            torch.manual_seed(0)
            out.append(float(sum(model.loss(x, y) for _ in range(3))) / 3)
    return out


def train_adapter(policy, model, name, new_rows, replay_rows, ratio: int = 3, lr: float = 5e-4, steps: int = 60, l2: float = 0.0, order: str = "random",
                  scale: float = 1.0, rank: int = 8, batch: int = 32, seed: int = 0, init=None):
    AD.drop_adapter(model, name)
    params = AD.add_adapter(model, name, rank)
    if init is not None:
        for (A, B), m in zip(init, AD.lora_modules(model)):
            if A.shape == m.A[name].shape:
                m.A[name].data.copy_(A)
                m.B[name].data.copy_(B)
    rows = list(new_rows)
    if order == "curriculum":
        AD.set_active(model, None)
        ls = _row_losses(policy, model, rows)
        rows = [r for _, r in sorted(zip(ls, rows), key=lambda z: z[0])]
    AD.set_active(model, name)
    g = torch.Generator().manual_seed(seed)
    opt = torch.optim.AdamW(params, lr=lr)
    n_new = max(1, batch // (ratio + 1))
    model.train()
    for t in range(steps):
        pool = rows if order != "curriculum" else rows[:max(1, int(len(rows) * min(1.0, 0.3 + 0.7 * (t + 1) / max(1, steps))))]
        new = [pool[i] for i in torch.randint(0, len(pool), (n_new,), generator=g).tolist()]
        old = [replay_rows[i] for i in torch.randint(0, len(replay_rows), (batch - n_new,), generator=g).tolist()]
        x, y = policy.pairs(new + old)
        opt.zero_grad(set_to_none=True)
        loss = model.loss(x, y)
        if l2:
            loss = loss + l2 * _delta_l2(model, name)
        loss.backward()
        opt.step()
    model.eval()
    if scale != 1.0:
        for m in AD.lora_modules(model):
            m.B[name].data.mul_(scale)
    AD.set_active(model, None)
    return name


class WebRouter:
    def __init__(self, embed_fn, k: int = 5, min_share: float = 0.6):
        self.embed_fn, self.k, self.min_share = embed_fn, k, min_share
        self.X, self.y = None, []

    def fit(self, base_tasks, web_tasks, web_fams, prefix: str = "web_"):
        """web_fams: the family of each web task; the adapter name is prefix + family (prefix="" = the labels already are adapter names)."""
        X = torch.nn.functional.normalize(self.embed_fn(list(base_tasks) + list(web_tasks)), dim=-1)
        self.X, self.y = X, [None] * len(base_tasks) + [prefix + f for f in web_fams]

    def route(self, tasks):
        Q = torch.nn.functional.normalize(self.embed_fn(list(tasks)), dim=-1)
        out = []
        for row in Q @ self.X.t():
            _, idx = row.topk(min(self.k, row.shape[0]))
            labs = [self.y[j] for j in idx.tolist()]
            web = [l for l in labs if l]
            if len(web) / len(labs) >= self.min_share:
                out.append(max(set(web), key=web.count))
            else:
                out.append(None)
        return out
