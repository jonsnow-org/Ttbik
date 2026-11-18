#!/usr/bin/env python3
"""Sham 2 on T-LDM, the book's recipe: freeze a COPY of the donor body, train only the T-LDM head (Compressor + Latent Thinker + Diffusion Writer) and LoRA rank 16.

  python training/train_sham2.py --config configs/sham2.yaml --tiny                                        # tiny random body: plumbing only (CI)
  python training/train_sham2.py --config configs/sham2.yaml --donor CKPT --tokenizer TOK --gate RESULTS.json   # a real donor: REFUSED unless the gate passes

Rules (owner, 2026-11-17/18):
  * the donor file is only READ (ai-system/colab/sham_small/checkpoint.load_checkpoint), the body in memory is a copy, its weights are frozen; nothing is ever written next to it
    or over it, and the output holds ONLY the new head + the adapters (never the donor weights);
  * a real donor is refused until the writer has passed the gate: held-out AND held-out-2 same-effect >= gate_heldout (default 0.6) in a results json of
    training/train_0.3b.py (TLDM_TERMINAL_SPEC §3: steps 1-4 first). Today the measured held-out is below it, so this script has only ever run on --tiny;
  * old Sham, its weights and its serving are untouched; SHAM_TLDM stays off.
Training data: the 30 terminal tasks (+ held-out-safe rewordings), target = the command, as bytes (the writer's block).
"""
import argparse
import importlib.util
import json
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
from common import ROOT, load_config  # noqa: E402
import torch  # noqa: E402
from sham_tldm import ShamBodyTLDM  # noqa: E402
from sham_tldm.model import decode_bytes, encode_bytes  # noqa: E402
import terminal_tasks as T  # noqa: E402
import rewordings as RW  # noqa: E402

SHAM_SMALL = os.path.realpath(os.path.join(ROOT, "..", "colab", "sham_small"))


def _sham_small_module(name):
    spec = importlib.util.spec_from_file_location(f"sham2_ro_{name}", os.path.join(SHAM_SMALL, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    if SHAM_SMALL not in sys.path:
        sys.path.insert(0, SHAM_SMALL)
    spec.loader.exec_module(mod)
    return mod


def tiny_body(rank):
    mod = _sham_small_module("model")
    cfg = mod.ShamSmallConfig(vocab_size=400, d_model=64, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=128)
    body = mod.ShamSmall(cfg)
    body.enable_adapters(rank)
    return body, (lambda text, n: [(b % 390) + 5 for b in text.encode("utf-8")][:n] + [0] * max(0, n - len(text.encode("utf-8"))))


def donor_body(path, tokenizer, rank):
    ck = _sham_small_module("checkpoint")
    body, _, _ = ck.load_checkpoint(path)                     # read only; the returned model is this process's copy
    body.enable_adapters(rank)
    from tokenizers import Tokenizer
    tk = Tokenizer.from_file(tokenizer)
    pad = getattr(body.cfg, "pad_token_id", 0) or 0
    return body, (lambda text, n: (tk.encode(text).ids[:n] + [pad] * n)[:n])


def gate_ok(path, need):
    """-> (ok, why). The writer's measured held-out results must reach `need` on both frozen held-out sets."""
    if not path or not os.path.isfile(path):
        return False, "no gate results file (--gate): the writer's held-out numbers are required before a real donor"
    r = json.load(open(path, encoding="utf-8"))
    h1, h2 = r.get("heldout", {}).get("same_effect", 0), r.get("heldout2", {}).get("same_effect", 0)
    if h1 >= need and h2 >= need:
        return True, f"held-out {h1}, held-out-2 {h2} >= {need}"
    return False, f"held-out {h1}, held-out-2 {h2}: below the gate {need} (TLDM_TERMINAL_SPEC §3: generalization first)"


def head_and_adapters(model) -> dict:
    """What is saved: the new head and the body's adapters. Never a donor weight."""
    return {k: v.detach().cpu() for k, v in model.state_dict().items() if k.startswith("core.") or ".adapter_" in k}


def train(model, encode, rows, cfg, seed=0, log=print):
    torch.manual_seed(seed)
    rng = random.Random(seed)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=cfg["lr"], weight_decay=0.01)
    model.train()
    t0 = time.time()
    for step in range(int(cfg["steps"])):
        pick = rng.sample(rows, min(int(cfg.get("batch", 32)), len(rows)))
        ids = torch.tensor([encode(t, int(cfg["in_len"])) for t, _ in pick])
        tgt = torch.tensor([encode_bytes(c, int(cfg["block"])) for _, c in pick])
        opt.zero_grad(set_to_none=True)
        loss = model.loss(ids, tgt)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        opt.step()
        if step % 100 == 0 or step == int(cfg["steps"]) - 1:
            log(f"step {step} loss {loss.item():.4f} ({time.time() - t0:.0f}s)")
    model.eval()
    return loss.item()


def evaluate(model, encode, rows, cfg):
    ids = torch.tensor([encode(t, int(cfg["in_len"])) for t, _ in rows])
    with torch.no_grad():
        out, _ = model.generate(ids, steps=int(cfg["diffusion_steps"]))
    cmds = [decode_bytes(o) for o in out.tolist()]
    return {"same_effect": round(sum(T.same_effect(ref, c) for (_, ref), c in zip(rows, cmds)) / len(rows), 3),
            "exact_text": round(sum(ref == c for (_, ref), c in zip(rows, cmds)) / len(rows), 3)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(ROOT, "configs", "sham2.yaml"))
    ap.add_argument("--tiny", action="store_true")
    ap.add_argument("--donor", default="")
    ap.add_argument("--tokenizer", default="")
    ap.add_argument("--gate", default="")
    ap.add_argument("--steps", type=int, default=0)
    ap.add_argument("--out", default=os.path.join(ROOT, "checkpoints", "sham2_tldm", "head_and_adapters.pt"))
    ap.add_argument("--json", default="")
    a = ap.parse_args(argv)
    cfg = load_config(a.config)
    if a.steps:
        cfg["steps"] = a.steps
    if not a.tiny and not a.donor:
        ap.error("choose --tiny or --donor")
    if a.donor:
        ok, why = gate_ok(a.gate, float(cfg.get("gate_heldout", 0.6)))
        if not ok:
            print("REFUSED:", why)
            return 2
        if os.path.realpath(a.out).startswith(os.path.dirname(os.path.realpath(a.donor)) + os.sep):
            print("REFUSED: the output must not be written next to the donor checkpoint")
            return 2
        body, encode = donor_body(a.donor, a.tokenizer, int(cfg["adapter_rank"]))
    else:
        body, encode = tiny_body(int(cfg["adapter_rank"]))
    donor_before = {k: v.clone() for k, v in body.state_dict().items() if ".adapter_" not in k}
    model = ShamBodyTLDM(body, latents=int(cfg["latents"]), think_steps=int(cfg["think_steps"]), block=int(cfg["block"]), writer_layers=int(cfg["writer_layers"]), heads=int(cfg["heads"]))
    rep = model.trainable_report()
    print("trainable:", rep, flush=True)
    rows = list(T.TRAIN) + (RW.generate() if cfg.get("rewordings", False) else [])
    loss = train(model, encode, rows, cfg)
    after = body.state_dict()
    unchanged = all(torch.equal(donor_before[k], after[k]) for k in donor_before)
    assert unchanged, "a donor weight changed"
    res = {"mode": "tiny" if a.tiny else "donor", "trainable": rep, "final_loss": round(loss, 4), "donor_weights_unchanged": unchanged,
           "train": evaluate(model, encode, T.TRAIN, cfg), "heldout": evaluate(model, encode, T.HELDOUT, cfg), "heldout2": evaluate(model, encode, RW.HELDOUT2, cfg)}
    os.makedirs(os.path.dirname(os.path.realpath(a.out)), exist_ok=True)
    torch.save({"cfg": cfg, "head_and_adapters": head_and_adapters(model), "mode": res["mode"]}, a.out)
    res["saved_MB"] = round(os.path.getsize(a.out) / 1e6, 2)
    print(json.dumps(res, ensure_ascii=False), flush=True)
    if a.json:
        json.dump(res, open(a.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
