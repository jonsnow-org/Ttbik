"""
Sham — QAT lab: does training WITH rounding in the loop beat compressing afterwards? (CPU, real small model, clean train/eval split.)

Fixes a flaw in the first compression lab (sham_quant_recipes.lab): its self-distill repair was trained on the SAME windows it was then
measured on. Here the training windows and the measurement windows come from different documents.

Arms (all compared in the 4-bit format they would ship in; fp32 reference first):
  PTQ g32+clip       compress after training, no further training                       (the baseline)
  repair-KL          groups of 32, rounding in the loop, loss = KL(own fp model || student)   [teacher-free: the teacher is the model itself]
  QAT-CE g32         groups of 32, rounding in the loop, loss = next-token cross entropy on the training windows
  Sham QAT per-row   what sham_qat.py does today: one scale per row, embedding + head rounded too, cross entropy

This is QAT *fine-tuning from a trained model* (the practical, cheap case). QAT from scratch needs a full training run and is not measured here.

    python sham_qat_lab.py [steps=200] [model_id]
"""
from __future__ import annotations

import copy
import math
import sys
import time

import torch
import torch.nn.functional as F

from sham_qat import quantize_
from sham_quant_recipes import _ppl, apply_recipe, unwrap_after_repair, wrap_for_repair


def _windows(tokenizer, n_eval: int = 40, n_train: int = 300, seq: int = 256):
    """(eval, train) token windows per language; the train windows come from documents AFTER the eval ones (never the same text)."""
    from datasets import load_dataset
    specs = {"en": ("HuggingFaceFW/fineweb-edu", "sample-10BT"), "ar": ("wikimedia/wikipedia", "20231101.ar")}
    ev, tr = {}, {}
    for tag, (ds, cfg) in specs.items():
        ids: list[int] = []
        for i, row in enumerate(load_dataset(ds, cfg, split="train", streaming=True)):
            if i < 300:
                continue
            ids += tokenizer(row["text"][:4000])["input_ids"] + [tokenizer.eos_token_id or 0]
            if len(ids) >= (n_eval + n_train) * seq:
                break
        w = torch.tensor(ids[: (n_eval + n_train) * seq]).view(-1, seq)
        ev[tag], tr[tag] = w[:n_eval], w[n_eval:]
    return ev, tr


def _loss_change(p, ref):
    return {k: (math.log(p[k]) - math.log(ref[k])) / math.log(ref[k]) * 100 for k in p}


def _train(student, teacher, train_w, steps, lr, mode, batch=4):
    flat = torch.cat([train_w["en"], train_w["ar"]])
    params = [p for p in student.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=0.0)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / 10) * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * s / max(1, steps)))))
    student.train()
    t0, first, last = time.time(), None, None
    for s in range(steps):
        ids = flat[torch.randperm(len(flat))[:batch]]
        logits = student(ids).logits.float()
        if mode == "kl":
            with torch.no_grad():
                t = teacher(ids).logits.float()
            loss = F.kl_div(F.log_softmax(logits, -1), F.softmax(t, -1), reduction="batchmean")
        else:
            loss = F.cross_entropy(logits[:, :-1].reshape(-1, logits.size(-1)), ids[:, 1:].reshape(-1))
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        opt.step()
        sched.step()
        first = first if first is not None else float(loss)
        last = float(loss)
        if s % 25 == 0:
            print(f"      step {s:4d}/{steps}  loss {float(loss):.3f}  ({time.time() - t0:.0f}s)", flush=True)
    student.eval()
    return first, last


def run(steps: int = 200, model_id: str = "HuggingFaceTB/SmolLM2-135M", threads: int = 4) -> None:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    torch.set_num_threads(threads)
    torch.manual_seed(0)
    tok = AutoTokenizer.from_pretrained(model_id)
    base = AutoModelForCausalLM.from_pretrained(model_id, torch_dtype=torch.float32).eval()
    L = base.config.num_hidden_layers
    ev, tr = _windows(tok)
    ref = _ppl(base, ev)
    print(f"MODEL {model_id}  {sum(p.numel() for p in base.parameters()) / 1e6:.0f}M  | train windows {sum(len(v) for v in tr.values())}, eval windows {sum(len(v) for v in ev.values())} (different documents) | {steps} steps, batch 4x256")
    print(f"{'arm':58s} {'ppl en':>7s} {'ppl ar':>7s}   loss change en / ar")
    print(f"{'full precision (reference)':58s} {ref['en']:7.2f} {ref['ar']:7.2f}   0.0% / 0.0%", flush=True)

    def report(name, p, extra=""):
        d = _loss_change(p, ref)
        print(f"{name:58s} {p['en']:7.2f} {p['ar']:7.2f}   {d['en']:+.1f}% / {d['ar']:+.1f}%  {extra}", flush=True)

    export = dict(bits=4, group=32, clip_search=True, protect_bits=8)
    m = copy.deepcopy(base)
    apply_recipe(m, n_layers=L, **export)
    report("PTQ  int4 g32 + clip (no training)", _ppl(m, ev))

    for name, lr, mode in (("repair-KL  g32, lr 2e-5", 2e-5, "kl"), ("repair-KL  g32, lr 1e-4", 1e-4, "kl"), ("QAT-CE     g32, lr 2e-5", 2e-5, "ce")):
        print(f"  training: {name}", flush=True)
        m = copy.deepcopy(base)
        wrap_for_repair(m, bits=4, group=32, n_layers=L)
        a, b = _train(m, base, tr, steps, lr, mode)
        unwrap_after_repair(m)
        apply_recipe(m, n_layers=L, **export)
        report(f"{name} -> export int4 g32+clip", _ppl(m, ev), f"(train loss {a:.2f} -> {b:.2f})")
        del m

    print("  training: Sham QAT per-row (as sham_qat.py, embedding+head int4 too), lr 1e-4", flush=True)
    m = copy.deepcopy(base)
    m0 = copy.deepcopy(base)
    quantize_(m0, bits=4)
    report("PTQ  per-row int4, everything (no training)", _ppl(m0, ev))
    quantize_(m, bits=4)
    a, b = _train(m, base, tr, steps, 1e-4, "ce")
    report("Sham QAT per-row int4 (embedding+head too), lr 1e-4", _ppl(m, ev), f"(train loss {a:.2f} -> {b:.2f})")


if __name__ == "__main__":     # sham-ci: entrypoint (minutes of CPU + internet: run on purpose)
    run(int(sys.argv[1]) if len(sys.argv) > 1 else 200, sys.argv[2] if len(sys.argv) > 2 else "HuggingFaceTB/SmolLM2-135M")
