"""
A PROBE (an experiment that publishes nothing) of the step-by-step reasoning curriculum (sham_reasoning_data) on a copy of
the current best weights, run on the free GitHub CPU runner after the merge job:

  1. measure, on fresh worked problems never trained on: the loss on the SOLUTION tokens (teacher-forced: it moves within
     minutes, long before generation gets the digits right) and the exact-match rate when Sham writes the solution itself;
  2. train a COPY for a few minutes on a mixture of those worked solutions and ordinary text (the text is the replay that
     keeps the rest of the model from drifting);
  3. measure the same things again, and the held-out ordinary-text loss, so a gain in reasoning bought with a loss on
     everything else is visible.

Nothing here changes any published weight. It answers one question before the owner is asked to switch the curriculum on in
the long GPU sessions: does this model LEARN the procedure from these examples at all, and what does it cost?

    SHAM_PROBE_MINUTES (default 25)   training budget of the probe
"""

from __future__ import annotations

import copy
import os
import random
import time
from pathlib import Path

import torch


def _solution_loss(model, examples, device, batch_size=8) -> float:
    from sham_chat import batch_examples
    from sham_merge import batches_loss
    return batches_loss(model, batch_examples(examples, batch_size), device)


@torch.no_grad()
def _exact_match(model, tokenizer, device, n=16, seed=991) -> tuple[float, dict]:
    os.environ["SHAM_REASONING_SHARE"] = os.environ.get("SHAM_REASONING_SHARE") or "0.1"
    import sham_grpo
    from sham_reasoning_data import make_problem
    rng = random.Random(seed)
    model.eval()
    hits, by_kind = 0, {}
    for _ in range(n):
        p = make_problem(rng)
        _, rows = sham_grpo._attempts(model, tokenizer, p["question"], device, 1, temperature=0.2)
        ok = sham_grpo.check(rows[0][2], p["truth"])
        hits += ok
        k = by_kind.setdefault(p["kind"], [0, 0])
        k[0] += ok
        k[1] += 1
    return hits / n, {k: f"{v[0]}/{v[1]}" for k, v in sorted(by_kind.items())}


def probe(model, tokenizer, device: str = "cpu", minutes: float | None = None, workdir: str = "/tmp/sham_probe") -> dict:
    out: dict = {"ok": False}
    t0 = time.time()
    minutes = float(os.environ.get("SHAM_PROBE_MINUTES", 25)) if minutes is None else minutes
    try:
        from sham_chat import batch_examples, build_chat_example
        from sham_merge import batches_loss
        from sham_reasoning_data import make_problem, reasoning_examples
        import sham_text_mix

        enc = tokenizer.encode
        trial = copy.deepcopy(model).to(device)

        # held-out: fresh worked problems (a seed training never uses) and ordinary text (the gate's own fixed sample)
        rng = random.Random(424242)
        held = [build_chat_example(enc(p["question"]), enc(p["solution"]), max_len=384)
                for p in (make_problem(rng) for _ in range(48))]
        files = sham_text_mix.stream_mix(str(Path(workdir) / "gate_text"), max_documents=140, seed=4242, documents_per_file=70)
        text = "\n".join(Path(f).read_text(encoding="utf-8") for f in files if str(f).endswith(".txt"))
        ids = tokenizer.encode(text)
        L = 256
        wins = [ids[i:i + L] for i in range(0, len(ids) - L + 1, L)][:24]
        text_gate = [torch.tensor(wins[i:i + 4]) for i in range(0, len(wins) - 3, 4)][:6]

        before = {"reason_loss": _solution_loss(trial, held, device), "text_loss": batches_loss(trial, text_gate, device)}
        before["exact"], before["by_kind"] = _exact_match(trial, tokenizer, device)
        print(f"🔬 المسبار قبل: خسارة الحلول {before['reason_loss']:.3f} | نص {before['text_loss']:.3f} | إصابة {before['exact']:.0%}")

        # training mixture: worked solutions + replay text (a DIFFERENT text sample from the gate's)
        files2 = sham_text_mix.stream_mix(str(Path(workdir) / "replay_text"), max_documents=200, seed=777, documents_per_file=100)
        ids2 = tokenizer.encode("\n".join(Path(f).read_text(encoding="utf-8") for f in files2 if str(f).endswith(".txt")))
        replay = [ids2[i:i + L] for i in range(0, len(ids2) - L + 1, L)]
        random.Random(1).shuffle(replay)
        train_ex = reasoning_examples(enc, 4000, seed=1234)
        from train import build_optimizer
        opt = build_optimizer(trial, lr=2e-4, weight_decay=0.1)
        trial.train()
        step, losses = 0, {"reason": [], "text": []}
        rb = batch_examples(train_ex, 8)
        deadline = t0 + minutes * 60
        while time.time() < deadline and step < 4000:
            if step % 4 == 3 and replay:
                w = replay[(step // 4) % len(replay)]
                x = torch.tensor([w], dtype=torch.long, device=device)
                _, loss = trial(x, labels=x)
                losses["text"].append(float(loss))
            else:
                ids_b, lab_b = rb[step % len(rb)]
                _, loss = trial(ids_b.to(device), labels=lab_b.to(device))
                losses["reason"].append(float(loss))
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(trial.parameters(), 1.0)
            for g in opt.param_groups:
                g["lr"] = 2e-4 * min(1.0, (step + 1) / 20)
            opt.step()
            step += 1
        trial.eval()
        after = {"reason_loss": _solution_loss(trial, held, device), "text_loss": batches_loss(trial, text_gate, device)}
        after["exact"], after["by_kind"] = _exact_match(trial, tokenizer, device)
        out.update(ok=True, steps=step, minutes=round((time.time() - t0) / 60, 1), before=before, after=after,
                   train_reason_tail=round(sum(losses["reason"][-20:]) / max(len(losses["reason"][-20:]), 1), 3))
        print(f"🔬 المسبار بعد {step} خطوة: خسارة الحلول {before['reason_loss']:.3f} → {after['reason_loss']:.3f} | "
              f"نص {before['text_loss']:.3f} → {after['text_loss']:.3f} | إصابة {before['exact']:.0%} → {after['exact']:.0%} "
              f"| حسب النوع {after['by_kind']}")
    except Exception as exc:     # an experiment that cannot run is a finding, never a failure of the job
        out["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
        print(f"🔬 المسبار تعذّر: {out['error']}")
    return out
