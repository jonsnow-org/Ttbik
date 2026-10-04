"""
Sham's regression guard ("حارس التراجع") — self-healing done for real.

The live trainer trains on fresh web data for hours. Its own reports showed what
can go wrong: the chat skill got WORSE during a session (4.728 → 4.915) and
nothing stopped it, and the published checkpoint was simply "the last weights".

The guard replaces "the last weights" with "the best weights found":
  • the weights the session STARTED with are the reference (score 1.00);
  • every few minutes the current weights (raw and EMA) are scored on held-out
    examples of every skill, each relative to the starting weights' own loss on
    the same examples → one number: below 1.00 = better than the start;
  • a new best is kept (CPU copy); what gets published is always the best;
  • if the score gets clearly worse than the best (more than `tolerance`) the
    model is rolled back to the best weights and its learning rate is reduced;
  • if a single skill (typically chat) drifts above its starting loss, the share
    of rehearsal for that skill is raised until it recovers.

Nothing here writes answers or rules for the model: it only measures and chooses
between weights Sham itself produced.
"""

from __future__ import annotations

import contextlib

import torch


def snapshot(params) -> dict:
    """CPU copy of (name, tensor) pairs."""
    return {n: t.detach().to("cpu", copy=True) for n, t in params}


@torch.no_grad()
def load_state(model, state: dict) -> None:
    for n, p in model.named_parameters():
        p.copy_(state[n].to(p.device))


def relative_score(losses: dict, base: dict) -> tuple[float, dict]:
    """(mean of loss/base over the common skills, per-skill ratios); 1.0 = as at the start."""
    rel = {k: losses[k] / base[k] for k in losses if k in base and base[k] > 0}
    return (sum(rel.values()) / len(rel) if rel else 1.0), rel


class Guard:
    def __init__(self, model, tolerance: float = 0.02, kind_tolerance: float = 0.03,
                 base_rehearsal: float = 0.15, max_rehearsal: float = 0.5):
        self.tolerance, self.kind_tolerance = tolerance, kind_tolerance
        self.init = snapshot(model.named_parameters())
        self.best, self.best_score, self.best_losses, self.best_flavor = self.init, 1.0, {}, "init"
        self.base: dict[str, float] = {}      # the starting weights' loss per skill (same held-out sets)
        self.lr_scale = 1.0
        self.rollbacks = 0
        self.rehearsal, self.base_rehearsal, self.max_rehearsal = base_rehearsal, base_rehearsal, max_rehearsal
        self.last_action = "—"

    # a skill whose held-out set only just became full has no baseline yet: measure it with the
    # starting weights (and with the current best, so both sides are scored on the same set)
    def _extend_baseline(self, model, measure, kinds) -> None:
        missing = sorted(k for k in kinds if k not in self.base)
        if not missing:
            return
        cur = snapshot(model.named_parameters())
        try:
            load_state(model, self.init)
            now = measure(missing)
            self.base.update(now)
            if self.best is self.init:
                self.best_losses.update(now)
            else:
                load_state(model, self.best)
                self.best_losses.update(measure(missing))
        finally:
            load_state(model, cur)

    def evaluate(self, model, ema, measure) -> dict:
        """measure(kinds=None) -> {skill: held-out loss} for the model's CURRENT weights.
        Decides keep / new best / rollback and returns the numbers for the report."""
        raw = measure()
        ema.swap(model)
        smooth = measure()
        ema.swap(model)
        self._extend_baseline(model, measure, set(raw) | set(smooth))
        s_raw, rel_raw = relative_score(raw, self.base)
        s_ema, rel_ema = relative_score(smooth, self.base)
        flavor, losses, score, rel = (("ema", smooth, s_ema, rel_ema) if s_ema <= s_raw
                                      else ("raw", raw, s_raw, rel_raw))
        best_now, _ = relative_score(self.best_losses, self.base) if self.best_losses else (self.best_score, {})
        self.best_score = best_now if self.best_losses else self.best_score
        action = "keep"
        if score < self.best_score - 1e-9:
            self.best = snapshot(ema.shadow.items() if flavor == "ema" else model.named_parameters())
            self.best_score, self.best_losses, self.best_flavor = score, dict(losses), flavor
            action = "best"
        elif score > self.best_score * (1 + self.tolerance):
            load_state(model, self.best)
            with torch.no_grad():
                for n, p in model.named_parameters():
                    ema.shadow[n].copy_(p)
            self.lr_scale *= 0.7
            self.rollbacks += 1
            action = "rollback"
        chat = rel.get("chat")
        if chat is not None:
            if chat > 1 + self.kind_tolerance:
                self.rehearsal = min(self.max_rehearsal, self.rehearsal + 0.10)
            elif chat <= 1.0:
                self.rehearsal = max(self.base_rehearsal, self.rehearsal - 0.05)
        self.last_action = action
        return {"action": action, "flavor": flavor, "score": score, "rel": rel, "current": losses,
                "best_score": self.best_score, "weak": sorted(k for k, v in rel.items() if v > 1 + self.kind_tolerance)}

    @contextlib.contextmanager
    def best_loaded(self, model):
        """Inside the block the model holds the best weights (to be saved/published); afterwards
        its own current weights are put back."""
        cur = snapshot(model.named_parameters())
        load_state(model, self.best)
        try:
            yield
        finally:
            load_state(model, cur)

    def line(self, r: dict) -> str:
        acts = {"best": "✅ أفضل نقطة حتى الآن", "keep": "⏸ لم تتحسن عن أفضل نقطة",
                "rollback": "🩹 تراجُع إلى أفضل نقطة وخُفّض معدل التعلّم"}
        weak = f" | ضعيف: {', '.join(r['weak'])}" if r["weak"] else ""
        return (f"{acts[r['action']]} — المؤشر {r['score']:.3f} (أفضل {self.best_score:.3f}، 1.000 = نقطة البداية)"
                f" | تراجعات {self.rollbacks} | حصة التذكّر {self.rehearsal:.0%}{weak}")


if __name__ == "__main__":
    from model import ShamSmall, ShamSmallConfig

    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=16)
    model = ShamSmall(cfg)

    class FakeEMA:  # the same interface as sham_live.EMA
        def __init__(self, m):
            self.shadow = {n: p.detach().clone() for n, p in m.named_parameters()}

        @torch.no_grad()
        def swap(self, m):
            for n, p in m.named_parameters():
                tmp = p.detach().clone(); p.copy_(self.shadow[n]); self.shadow[n].copy_(tmp)

    ema = FakeEMA(model)
    g = Guard(model)
    init = {n: p.detach().clone() for n, p in model.named_parameters()}
    # a fake yardstick: loss = distance of the weights from a "target" weight vector, per skill
    target = ShamSmall(cfg)
    tgt = {n: p.detach().clone() for n, p in target.named_parameters()}
    dist = lambda m, w: sum(float((p - tgt[n]).pow(2).sum()) for n, p in m.named_parameters()) ** 0.5 * w + 1.0
    state = {"kinds": {"text": 1.0}}
    measure = lambda kinds=None: {k: dist(model, w) for k, w in state["kinds"].items() if kinds is None or k in kinds}

    # 1) weights move toward the target → new best, score below 1
    with torch.no_grad():
        for n, p in model.named_parameters():
            p.copy_(0.5 * p + 0.5 * tgt[n]); ema.shadow[n].copy_(p)
    r = g.evaluate(model, ema, measure)
    assert r["action"] == "best" and r["score"] < 1.0, r
    best_snapshot = {n: t.clone() for n, t in g.best.items()}

    # 2) a new skill (chat) appears, and the weights then get much worse → rollback to the best
    state["kinds"]["chat"] = 1.0
    with torch.no_grad():
        for n, p in model.named_parameters():
            p.add_(5.0 * torch.randn_like(p)); ema.shadow[n].copy_(p)
    r = g.evaluate(model, ema, measure)
    assert r["action"] == "rollback" and g.rollbacks == 1 and abs(g.lr_scale - 0.7) < 1e-9, r
    assert all(torch.equal(p, best_snapshot[n]) for n, p in model.named_parameters()), "rollback must restore the best weights"
    assert set(g.base) == {"text", "chat"} and set(g.best_losses) == {"text", "chat"}, (g.base, g.best_losses)

    # 3) what is published is the best, and the model's own weights come back afterwards
    with torch.no_grad():
        for n, p in model.named_parameters():
            p.add_(1.0)
    cur = {n: p.detach().clone() for n, p in model.named_parameters()}
    with g.best_loaded(model):
        assert all(torch.equal(p, best_snapshot[n]) for n, p in model.named_parameters())
    assert all(torch.equal(p, cur[n]) for n, p in model.named_parameters())

    # 4) a skill drifting above its starting loss raises the rehearsal share; recovering lowers it
    g2 = Guard(model, base_rehearsal=0.15)
    g2.base = {"chat": 1.0, "text": 1.0}
    g2.best_losses = {"chat": 1.0, "text": 1.0}
    state["kinds"] = {"chat": 1.0, "text": 1.0}
    measure2 = lambda kinds=None: {"chat": 1.2, "text": 0.9}
    r = g2.evaluate(model, ema, measure2)
    assert g2.rehearsal > 0.15 and "chat" in r["weak"], (g2.rehearsal, r)
    print(g.line(r))
    print("sham_guard self-test OK")
