#!/usr/bin/env python3
"""Sham 2 on T-LDM, the book's recipe: freeze a COPY of the donor body, train only the T-LDM head (Compressor + Latent Thinker + Diffusion Writer) and LoRA rank 16.

  python training/train_sham2.py --config configs/sham2.yaml --tiny                                        # tiny random body: plumbing only (CI)
  python training/train_sham2.py --config configs/sham2.yaml --donor CKPT --tokenizer TOK --gate RESULTS.json   # a real donor: REFUSED unless the gate passes
  ... --cached --dtype bf16 --seeds 3 --loop   # CPU (Studio) mode: the body is frozen and read ONCE per text (bf16); only the T-LDM head trains on those features
                                               # (no LoRA in this mode); --loop also trains the agent-loop head and runs the full-task benchmark on the same body

Rules (owner, 2026-11-17/18):
  * the donor file is only READ (ai-system/colab/sham_small/checkpoint.load_checkpoint), the body in memory is a copy, its weights are frozen; nothing is ever written next to it
    or over it, and the output holds ONLY the new head + the adapters (never the donor weights);
  * a real donor is refused until the writer has passed the gate: held-out AND held-out-2 same-effect >= gate_heldout (default 0.6) in a results json of
    training/train_0.3b.py (TLDM_TERMINAL_SPEC §3: steps 1-4 first). Passed 2026-11-18 (docs/experiments/tldm_heldout_gate_2026-11-18.json: 0.778 / 0.810, 3 seeds,
    head on a frozen pretrained reader), which is the default --gate; the Sham 2 run itself is the trainer Studio job (modelscope-trainer/app.py, name sham2*);
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
import trajectories as J  # noqa: E402
import augment as AUG  # noqa: E402
import identity as ID  # noqa: E402
import retention as RT  # noqa: E402
from sham_tldm.donor import FeatureTLDM  # noqa: E402

SHAM_SMALL = next((p for p in (os.path.join(ROOT, "..", "colab", "sham_small"), os.path.join(ROOT, "..", "sham_small")) if os.path.isdir(p)),
                  os.path.join(ROOT, "..", "colab", "sham_small"))          # repo layout, or the trainer Studio's (sham_small/ next to tldm/)
SHAM_SMALL = os.path.realpath(SHAM_SMALL)
TERMINAL = os.path.realpath(os.path.join(ROOT, "..", "terminal"))


def computer_terminal(model_id: str = "sham_v2"):
    """A fresh workspace of the model's OWN embedded computer (sham_binding.ShamEmbeddedBackend -> sham_embedded_tools.run_call("computer_run")), seeded with the task
    folder. Sham 2's terminal runs through this existing computer (owner, 2026-11-18), not a separate sandbox; its own session key keeps runs apart (separate=True)."""
    import shutil
    import uuid
    for p in (TERMINAL, SHAM_SMALL):
        if p not in sys.path:
            sys.path.insert(0, p)
    from sham_binding import ShamEmbeddedBackend
    b = ShamEmbeddedBackend("tldm_bench_" + uuid.uuid4().hex[:10], model_id, separate=True)
    for name, text in T.FIXTURE.items():
        with open(os.path.join(b.dir, name), "w", encoding="utf-8") as f:
            f.write(text)
    b.close = lambda: shutil.rmtree(b.dir, ignore_errors=True)           # this benchmark session's workspace only
    return b


def _sham_small_module(name):
    spec = importlib.util.spec_from_file_location(f"sham2_ro_{name}", os.path.join(SHAM_SMALL, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    if SHAM_SMALL not in sys.path:
        sys.path.insert(0, SHAM_SMALL)
    spec.loader.exec_module(mod)
    return mod


def tiny_body(rank):
    mod = _sham_small_module("model")
    cfg = mod.ShamSmallConfig(vocab_size=400, d_model=64, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=512)
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
    encode = lambda text, n: (tk.encode(text).ids[:n] + [pad] * n)[:n]       # noqa: E731
    encode.chat = ChatTok(lambda t: tk.encode(t).ids, lambda ids: tk.decode(ids, skip_special_tokens=True), (tk.encode("<|im_end|>").ids or [None])[-1])
    return body, encode


class ChatTok:
    """enc(text) -> ids, dec(ids) -> text, end = the end-of-turn id (Qwen3 layout <|im_end|>, the layout Sham 2's serving uses)."""
    def __init__(self, enc, dec, end):
        self.enc, self.dec, self.end = enc, dec, end

    def prompt(self, q):
        return self.enc(f"<|im_start|>user\n{q}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n")


@torch.no_grad()
def chat_answer(body, ct, q, max_new=40):
    """Greedy answer of the body itself (KV cache), as the donor chat writes it: the identity check reads the MODEL, never a rewritten reply."""
    body.eval()
    ids = torch.tensor([ct.prompt(q)])
    logits, _, past = body(ids, use_cache=True)
    out = []
    for _ in range(max_new):
        nxt = int(logits[0, -1].float().argmax())
        if nxt == ct.end:
            break
        out.append(nxt)
        logits, _, past = body(torch.tensor([[nxt]]), past_key_values=past, use_cache=True)
    return ct.dec(out)


def identity_eval(body, ct):
    rows = [(q, chat_answer(body, ct, q)) for q in ID.HELDOUT]
    return {"ok": round(sum(ID.identity_ok(a) for _, a in rows) / len(rows), 3), "answers": [[q, a[:200]] for q, a in rows]}


@torch.no_grad()
def general_nll(body, ct):
    """Retention: mean next-token loss of the body on a few general texts (must not jump after the identity LoRA)."""
    texts = ["The capital of France is Paris, and the river that runs through it is the Seine.", "def add(a, b):\n    return a + b\n",
             "دمشق هي عاصمة سوريا، وهي من أقدم المدن المأهولة في العالم.", "Water boils at one hundred degrees Celsius at sea level."]
    tot = 0.0
    for t in texts:
        ids = torch.tensor([ct.enc(t)])
        _, loss = body(ids, labels=ids)
        tot += float(loss)
    return round(tot / len(texts), 4)


NLL_RANDOM = 6.0      # a real donor reads general text at ~2; a random-init 150k-vocab body sits near ln(151936) = 11.9


def retention_eval(body, ct, base, max_new=48):
    """After the LoRA: share of held-out RT.CHECKS prompts that still say what the base said (only words the base answer had), and of replay answers kept as is."""
    rows = []
    for q, need in RT.CHECKS.items():
        b, a = base.get(q, ""), chat_answer(body, ct, q, max_new)
        want = [w for w in need if w.lower() in b.lower()]
        rows.append({"q": q[:60], "base": b[:160], "lora": a[:160], "ok": all(w.lower() in a.lower() for w in want)})
    return {"ok": round(sum(r["ok"] for r in rows) / max(1, len(rows)), 3), "rows": rows}


def identity_lora(body, ct, steps=80, lr=2e-4, batch=4, seed=0, log=print, replay=True):
    """Train ONLY the body's LoRA adapters on data/identity.py (loss on the answer), on the in-memory copy. -> results; the adapters stay in `body`.
    replay (default): every batch also holds RT.PROMPTS answered by the body itself BEFORE the LoRA (self-distillation), so the LoRA learns the name
    without forgetting facts or the tool-call format (live 2026-11-18: identity-only LoRA answered Brussels for Syria and dropped computer_run)."""
    torch.manual_seed(seed)
    rng = random.Random(seed)
    ad = [p for n, p in body.named_parameters() if ".adapter_" in n]
    for n, p in body.named_parameters():
        p.requires_grad = ".adapter_" in n
    ex = []
    for q, a in ID.TRAIN:
        pr, t = ct.prompt(q), ct.enc(a) + ([ct.end] if ct.end is not None else [])
        ex.append((pr + t, [-100] * len(pr) + t))
    before = {"identity": identity_eval(body, ct), "general_nll": general_nll(body, ct)}
    if ct.end is not None and before["general_nll"] > NLL_RANDOM:
        raise RuntimeError(f"body looks random (general nll {before['general_nll']} > {NLL_RANDOM}): incomplete donor weights? stopping before training on noise")
    log(f"identity before LoRA: {before['identity']['ok']} (general nll {before['general_nll']})")
    rx, base = [], {}
    if replay:
        t1 = time.time()
        for q in list(RT.PROMPTS) + list(RT.CHECKS):
            base[q] = chat_answer(body, ct, q, 48)        # the body's own answer, no LoRA yet (adapter_up = 0)
        for q in RT.PROMPTS:
            pr, t = ct.prompt(q), ct.enc(base[q]) + ([ct.end] if ct.end is not None else [])
            if t:
                rx.append((pr + t, [-100] * len(pr) + t))
        log(f"retention replay: {len(rx)} self-answers read in {time.time() - t1:.0f}s")
    opt = torch.optim.AdamW(ad, lr=lr, weight_decay=0.0)
    body.train()
    t0 = time.time()
    for step in range(steps):
        if rx:                                              # half identity, half the body's own answers
            half = max(1, batch // 2)
            pick = rng.sample(ex, min(half, len(ex))) + rng.sample(rx, min(batch - half, len(rx)))
        else:
            pick = rng.sample(ex, min(batch, len(ex)))
        n = max(len(x) for x, _ in pick)
        ids = torch.tensor([x + [0] * (n - len(x)) for x, _ in pick])
        lab = torch.tensor([y + [-100] * (n - len(y)) for _, y in pick])
        opt.zero_grad(set_to_none=True)
        _, loss = body(ids, labels=lab)
        loss.float().backward()
        torch.nn.utils.clip_grad_norm_(ad, 1.0)
        opt.step()
        if step % 10 == 0 or step == steps - 1:
            log(f"  identity LoRA step {step} loss {float(loss):.4f} ({time.time() - t0:.0f}s)")
    body.eval()
    for p in body.parameters():
        p.requires_grad = False
    after = {"identity": identity_eval(body, ct), "general_nll": general_nll(body, ct)}
    log(f"identity after LoRA: {after['identity']['ok']} (general nll {after['general_nll']})")
    if replay:
        after["retention"] = retention_eval(body, ct, base)
        log(f"retention after LoRA: {after['retention']['ok']} (held-out facts / tool call still as the base answered)")
    return {"steps": steps, "lr": lr, "train_pairs": len(ex), "replay_pairs": len(rx), "lora_params": sum(p.numel() for p in ad), "secs": round(time.time() - t0), "before": before, "after": after}


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
        dev = next(model.core.parameters()).device
        ids = torch.tensor([encode(t, int(cfg["in_len"])) for t, _ in pick], device=dev)
        tgt = torch.tensor([encode_bytes(c, int(cfg["block"])) for _, c in pick], device=dev)
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
    ids = torch.tensor([encode(t, int(cfg["in_len"])) for t, _ in rows], device=next(model.core.parameters()).device)
    with torch.no_grad():
        out, _ = model.generate(ids, steps=int(cfg["diffusion_steps"]))
    cmds = [decode_bytes(o) for o in out.tolist()]
    return {"same_effect": round(sum(T.same_effect(ref, c) for (_, ref), c in zip(rows, cmds)) / len(rows), 3),
            "exact_text": round(sum(ref == c for (_, ref), c in zip(rows, cmds)) / len(rows), 3)}


# ---- cached-feature mode (CPU / Studio): the frozen body reads each distinct text once; the head trains on the kept features --------------------------------
class BodyReader:
    """Frozen body -> final-norm hidden states for a list of token-id lists (each at its OWN length: no padding goes through the body). Features are cached per input."""

    def __init__(self, body, device="cpu", dtype=torch.float32):
        self.body = body.to(device=device, dtype=dtype).eval()
        for p in self.body.parameters():
            p.requires_grad = False
        self.device, self.cache, self._hs = device, {}, []
        body.final_norm.register_forward_hook(lambda mod, inp, out: self._hs.append(out))
        self.d = body.cfg.d_model
        self.secs = 0.0

    @torch.no_grad()
    def feats(self, id_lists, n):
        """-> (B, n, d) float32 features padded with zeros, and the (B, n) pad mask."""
        out, pad = torch.zeros(len(id_lists), n, self.d), torch.ones(len(id_lists), n, dtype=torch.bool)
        for i, ids in enumerate(id_lists):
            key = tuple(ids[:n])
            if key not in self.cache:
                t0 = time.time()
                self._hs.clear()
                self.body(torch.tensor([list(key) or [0]], device=self.device))
                self.cache[key] = self._hs[-1][0].float().cpu()
                self.secs += time.time() - t0
                if len(self.cache) % 25 == 0:
                    print(f"  body read {len(self.cache)} texts ({self.secs:.0f}s)", flush=True)
            h = self.cache[key]
            out[i, :len(h)] = h
            pad[i, :len(h)] = False
        return out, pad


def text_ids(tk_encode, text, n):
    return [i for i in tk_encode(text, n) if i][:n] or [0]


def loop_ids(tk_encode, task, hist, n):
    """The agent-loop view on the body's tokens: the task (first 32 tokens), then the TAIL of the terminal history (as J.view_ids, with this body's tokenizer)."""
    t = text_ids(tk_encode, task[:64], 32)
    h_text = "".join(f"$ {c}\n> {r}\n" for c, r in hist)
    h = text_ids(tk_encode, h_text, 4096) if h_text else []
    room = n - len(t) - 1
    nl = text_ids(tk_encode, "\n", 1)
    return t + nl + (h[-room:] if room > 0 else [])


def train_head(head, reader, xs, ys, n, cfg, seed, log=print):
    torch.manual_seed(seed)
    rng = random.Random(seed)
    opt = torch.optim.AdamW(head.parameters(), lr=float(cfg["lr"]), weight_decay=0.01)
    head.train()
    steps, bs = int(cfg["steps"]), int(cfg.get("batch", 32))
    for step in range(steps):
        for g in opt.param_groups:
            g["lr"] = float(cfg["lr"]) * min(1.0, (step + 1) / 30) * (0.05 + 0.95 * 0.5 * (1 + __import__("math").cos(__import__("math").pi * step / steps)))
        idx = [rng.randrange(len(xs)) for _ in range(min(bs, len(xs)))]
        h, pad = reader.feats([xs[i] for i in idx], n)
        tgt = torch.tensor([ys[i] for i in idx])
        opt.zero_grad(set_to_none=True)
        loss = head.loss(h, pad, tgt)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(head.parameters(), 1.0)
        opt.step()
        if step % 200 == 0 or step == steps - 1:
            log(f"  step {step} loss {loss.item():.4f}")
    head.eval()
    return loss.item()


def eval_head(head, reader, tk_encode, rows, cfg, delex=False):
    n = int(cfg["in_len"])
    dl = [AUG.delex(t) if delex else (t, None, {}) for t, _ in rows]
    h, pad = reader.feats([text_ids(tk_encode, d[0], n) for d in dl], n)
    out, _ = head.generate(h, pad, steps=int(cfg["diffusion_steps"]), confident=float(cfg.get("confident", 0.0)))
    cmds = [AUG.relex(decode_bytes(o), d[2]) for o, d in zip(out.tolist(), dl)]
    return {"same_effect": round(sum(T.same_effect(ref, c) for (_, ref), c in zip(rows, cmds)) / len(rows), 3),
            "exact_text": round(sum(ref == c for (_, ref), c in zip(rows, cmds)) / len(rows), 3),
            "misses": [[t, c, ref] for (t, ref), c in zip(rows, cmds) if not T.same_effect(ref, c)][:20]}


def loop_data(tk_encode, cfg, episodes, seed=1, term_factory=None):
    """Training views of the agent loop (data/trajectories.py, training file names only), with argument slots (configs/loop.yaml default)."""
    rng = random.Random(seed)
    n, block = int(cfg["loop_in_len"]), int(cfg["loop_block"])
    xs, ys = [], []
    for _ in range(episodes):
        task, plan, reply_t = J.make_episode(rng)
        steps, _, _ = J.run_episode(task, plan, reply_t, term_factory)
        for hist, tgt in steps:
            dt, dh, slots = J.delex_view(task, hist, True)
            xs.append(loop_ids(tk_encode, dt, dh, n))
            ys.append(encode_bytes(AUG.apply_slots(tgt, slots), block))
    # open-argument episodes (data/trajectories.make_open_episode): the head learns to copy tokens/files/numbers/repos from the task and to ask the read-only GitHub tool
    orng = random.Random(seed + 101)
    for _ in range(int(cfg.get("open_episodes", 0))):
        task, plan, reply_t = J.make_open_episode(orng)
        steps, _, _ = J.run_open_episode(task, plan, reply_t, term_factory)
        for hist, tgt in steps:
            dt, dh, slots = J.delex_view(task, hist, True)
            xs.append(loop_ids(tk_encode, dt, dh, n))
            ys.append(encode_bytes(AUG.apply_slots(tgt, slots), block))
    return xs, ys


def loop_benchmark(head, reader, tk_encode, cfg, episodes=60, seed=778, max_steps=5, term_factory=None):
    """The full task (eval/full_task_benchmark.py rule): 60 episodes with file names never seen in training; success = final folder AND reply equal the reference's.
    Reference AND model run on the same kind of terminal (term_factory: Sham 2's embedded computer). A command the approval policy holds is counted, then run as owner-approved."""
    import statistics
    term_factory = term_factory or T.fresh
    approvals = 0
    n = int(cfg["loop_in_len"])
    rng = random.Random(seed)
    rows = []
    for _ in range(episodes):
        task, plan, reply_t = J.make_episode(rng, new_names=True)
        _, ref_reply, ref_snap = J.run_episode(task, plan, reply_t, term_factory)
        term, hist, reply, t0 = term_factory(), [], "", time.perf_counter()
        try:
            for _ in range(max_steps):
                dt, dh, slots = J.delex_view(task, hist, True)
                h, pad = reader.feats([loop_ids(tk_encode, dt, dh, n)], n)
                out, _ = head.generate(h, pad, steps=int(cfg["diffusion_steps"]), confident=float(cfg.get("confident", 0.0)))
                text = AUG.relex(decode_bytes(out[0].tolist()), slots)
                if not text.startswith("$ "):
                    reply = text
                    break
                r = term.run(text[2:].strip())
                if getattr(r, "needs_confirmation", False):
                    approvals += 1
                    r = term.run(text[2:].strip(), confirm=True)
                hist.append((text[2:].strip(), (r.out if r.ok else (r.refused or r.out)).strip().replace("\n", " ")))
            ok = reply == ref_reply and T.snapshot(term) == ref_snap
        finally:
            term.close()
        rows.append({"kind": "multi_step" if len(plan) >= 2 else "simple", "ok": ok, "secs": time.perf_counter() - t0})

    def summ(rs):
        return {"n": len(rs), "success": round(sum(r["ok"] for r in rs) / max(1, len(rs)), 3),
                "median_s_per_task": round(statistics.median(r["secs"] for r in rs), 3) if rs else None}
    return {"all": summ(rows), "simple": summ([r for r in rows if r["kind"] == "simple"]), "multi_step": summ([r for r in rows if r["kind"] == "multi_step"]),
            "approvals_asked": approvals, "terminal": getattr(term_factory, "__name__", str(term_factory))}


def load_loop_extra(path, encode, ln, block, cap=3000, share=0.2, base_rows=0, seed=5):
    """Extra agent-loop views from real executed shell traces (data/snapshots, built by data/sham2_snapshots.py loop): (task, tail of the terminal history) -> "$ <command>".
    At most `cap` rows and at most `share` of the mixed set (so the in-domain episodes stay the bulk). -> (xs, ys, count)."""
    import gzip
    if not path or not os.path.isfile(path):
        return [], [], 0
    opener = gzip.open if str(path).endswith(".gz") else open
    rows = []
    with opener(path, "rt", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            cmd = str(r.get("cmd") or "")
            if cmd and len(("$ " + cmd).encode("utf-8")) <= block:
                rows.append(r)
    random.Random(seed).shuffle(rows)
    room = int(base_rows * share / max(1e-6, 1 - share)) if base_rows else cap
    rows = rows[:max(0, min(cap, room))]
    xs = [loop_ids(encode, str(r.get("task") or ""), [(c, t) for c, t in (r.get("hist") or [])], ln) for r in rows]
    ys = [encode_bytes("$ " + r["cmd"], block) for r in rows]
    return xs, ys, len(rows)


def head_args(cfg, d_in, block):
    return dict(d_in=d_in, d=int(cfg.get("head_d", 256)), latents=int(cfg["latents"]), think_steps=int(cfg["think_steps"]), block=block,
                writer_layers=int(cfg["writer_layers"]), heads=int(cfg["heads"]))


def run_cached(body, encode, cfg, a, log=print):
    """CPU mode: frozen body (bf16 by default), features read once per text, T-LDM head trained on them over --seeds seeds; optional agent loop + full-task benchmark."""
    dtype = torch.bfloat16 if a.dtype == "bf16" else torch.float32
    ident = None
    if a.identity:
        ct = getattr(encode, "chat", None) or ChatTok(lambda t: [i for i in encode(t, 256) if i], lambda ids: "", None)
        ident = identity_lora(body, ct, steps=int(a.identity_steps), log=log)
    reader = BodyReader(body, a.device, dtype)
    n = int(cfg["in_len"])
    rows = list(T.TRAIN) + (RW.generate(per_command=int(cfg.get("rewordings_per_command", 24))) if cfg.get("rewordings", False) else [])
    xs = [text_ids(encode, t, n) for t, _ in rows]
    ys = [encode_bytes(c, int(cfg["block"])) for _, c in rows]
    t0 = time.time()
    reader.feats(xs, n)                                   # every training text through the body once
    log(f"body features: {len(reader.cache)} texts in {time.time() - t0:.0f}s ({a.dtype}, {a.device})")
    res = {"mode": "donor-cached" if a.donor else "tiny-cached", "body_params_M": round(sum(p.numel() for p in body.parameters()) / 1e6, 1), "dtype": a.dtype,
           "device": a.device, "lora": "identity LoRA only (adapters; base weights frozen)" if a.identity else "none in cached mode (body fully frozen)", "writer": [], "loop": []}
    best = None
    for seed in range(int(a.seeds)):
        head = FeatureTLDM(**head_args(cfg, reader.d, int(cfg["block"])))
        loss = train_head(head, reader, xs, ys, n, cfg, seed, log)
        r = {"seed": seed, "final_loss": round(loss, 4), "head_params_M": round(head.count_params() / 1e6, 2), "train": eval_head(head, reader, encode, T.TRAIN, cfg),
             "heldout": eval_head(head, reader, encode, T.HELDOUT, cfg), "heldout2": eval_head(head, reader, encode, RW.HELDOUT2, cfg)}
        log(f"seed {seed}: train {r['train']['same_effect']} heldout {r['heldout']['same_effect']} heldout2 {r['heldout2']['same_effect']}")
        res["writer"].append(r)
        if best is None or r["heldout"]["same_effect"] + r["heldout2"]["same_effect"] > best[0]:
            best = (r["heldout"]["same_effect"] + r["heldout2"]["same_effect"], head)
    for k in ("train", "heldout", "heldout2"):
        res[k] = {"same_effect": round(sum(r[k]["same_effect"] for r in res["writer"]) / len(res["writer"]), 3)}
    heads = {"writer": {k: v.detach().cpu() for k, v in best[1].state_dict().items()}}
    if a.loop:
        ln = int(cfg["loop_in_len"])
        tf = computer_terminal if a.terminal == "computer" else T.fresh
        lx, ly = loop_data(encode, cfg, int(cfg.get("loop_episodes", 500)), term_factory=tf)
        t0 = time.time()
        reader.feats(lx, ln)
        log(f"loop features: {len(lx)} views in {time.time() - t0:.0f}s")
        lcfg = dict(cfg, steps=int(cfg.get("loop_steps", 900)), batch=int(cfg.get("loop_batch", 64)))
        ex, ey, nex = load_loop_extra(getattr(a, "loop_extra", ""), encode, ln, int(cfg["loop_block"]), base_rows=len(lx))
        if nex:
            t0 = time.time()
            reader.feats(ex, ln)
            log(f"loop extra: {nex} real shell views (UltraData) in {time.time() - t0:.0f}s")
        for seed in range(int(a.loop_seeds)):
            head = FeatureTLDM(**head_args(cfg, reader.d, int(cfg["loop_block"])))
            train_head(head, reader, lx, ly, ln, lcfg, seed, log)
            b = loop_benchmark(head, reader, encode, cfg, episodes=int(cfg.get("loop_eval_episodes", 60)), term_factory=tf)
            log(f"loop seed {seed}: full task {b['all']['success']} simple {b['simple']['success']} multi-step {b['multi_step']['success']}")
            entry = {"seed": seed, **b, "variant": "in-domain only"}
            if nex:
                # A/B inside the same run: the head trained with the extra real traces is shipped only if it does NOT lose on the in-domain full-task benchmark (a tie keeps the in-domain head)
                head2 = FeatureTLDM(**head_args(cfg, reader.d, int(cfg["loop_block"])))
                train_head(head2, reader, lx + ex, ly + ey, ln, lcfg, seed, log)
                b2 = loop_benchmark(head2, reader, encode, cfg, episodes=int(cfg.get("loop_eval_episodes", 60)), term_factory=tf)
                log(f"loop seed {seed} +extra: full task {b2['all']['success']} simple {b2['simple']['success']} multi-step {b2['multi_step']['success']}")
                entry["extra_rows"] = nex
                entry["with_extra"] = {"all": b2["all"]["success"], "simple": b2["simple"]["success"], "multi_step": b2["multi_step"]["success"]}
                if b2["all"]["success"] > b["all"]["success"]:
                    head, b, entry = head2, b2, {"seed": seed, **b2, "variant": "with extra real shell traces", "extra_rows": nex,
                                                 "in_domain_only": {"all": entry["all"]["success"]}}
                    log("loop: the head WITH the extra traces wins and is the one shipped")
                else:
                    log("loop: the in-domain head is kept (the extra traces did not win)")
            res["loop"].append(entry)
            heads[f"loop_seed{seed}"] = {k: v.detach().cpu() for k, v in head.state_dict().items()}
    res["body_read_secs"] = round(reader.secs, 1)
    if ident is not None:
        res["identity"] = ident
        heads["identity_lora"] = {k: v.detach().cpu() for k, v in body.state_dict().items() if ".adapter_" in k}
        res["note_identity"] = "LoRA trained first on the copy; the T-LDM head then read the body WITH this LoRA (the final Sham 2)"
    return res, heads


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(ROOT, "configs", "sham2.yaml"))
    ap.add_argument("--tiny", action="store_true")
    ap.add_argument("--donor", default="")
    ap.add_argument("--tokenizer", default="")
    ap.add_argument("--gate", default=os.path.join(ROOT, "..", "..", "docs", "experiments", "tldm_heldout_gate_2026-11-18.json"),
                    help="writer results json with heldout/heldout2 (the Studio uses the identical copy in gate/)")
    ap.add_argument("--steps", type=int, default=0)
    ap.add_argument("--out", default=os.path.join(ROOT, "checkpoints", "sham2_tldm", "head_and_adapters.pt"))
    ap.add_argument("--json", default="")
    ap.add_argument("--device", default="cpu", help="cpu | cuda | auto")
    ap.add_argument("--dtype", default="fp32", help="fp32 | bf16 (the body's compute dtype; the head stays fp32)")
    ap.add_argument("--cached", action="store_true", help="CPU mode: frozen body read once per text, head-only training (no LoRA)")
    ap.add_argument("--seeds", type=int, default=1)
    ap.add_argument("--loop", action="store_true", help="also train the agent-loop head and run the full-task benchmark (with --cached)")
    ap.add_argument("--loop_seeds", type=int, default=1)
    ap.add_argument("--loop_extra", default="", help="(--cached --loop) JSONL(.gz) of real executed shell views (data/sham2_snapshots.py loop); trained as a second loop head, shipped only if it wins the in-domain benchmark")
    ap.add_argument("--identity", action="store_true", help="(--cached) train the body's LoRA on data/identity.py first; check identity before/after")
    ap.add_argument("--identity_steps", type=int, default=80)
    ap.add_argument("--terminal", default="computer", help="computer = Sham's own embedded computer (default, owner 2026-11-18) | sandbox = the test sandbox")
    a = ap.parse_args(argv)
    if a.device == "auto":
        a.device = "cuda" if torch.cuda.is_available() else "cpu"
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
    def fingerprint(sd):
        """Per-tensor (sum, sum of squares) in float64: proves the donor did not change without a second full copy of a 1.7B body (8 GB Studio)."""
        out = {}
        for k, v in sd.items():
            if ".adapter_" in k:
                continue
            flat, s1, s2 = v.detach().reshape(-1), 0.0, 0.0
            for i in range(0, flat.numel(), 1 << 22):                # 4M elements at a time: never a float64 copy of a whole embedding
                c = flat[i:i + (1 << 22)].double()
                s1, s2 = s1 + c.sum().item(), s2 + c.pow(2).sum().item()
            out[k] = (s1, s2)
        return out
    if a.cached:                                                     # the in-memory copy is read in the chosen dtype; the check below is on that copy
        body.to(dtype=torch.bfloat16 if a.dtype == "bf16" else torch.float32)
    donor_before = fingerprint(body.state_dict()) if a.cached else {k: v.clone() for k, v in body.state_dict().items() if ".adapter_" not in k}
    print(f"donor loaded: {sum(p.numel() for p in body.parameters()) / 1e6:.0f}M parameters", flush=True)
    if a.cached:
        res, heads = run_cached(body, encode, cfg, a, lambda m: print(m, flush=True))
        after = body.state_dict()
        res["donor_weights_unchanged"] = fingerprint(after) == donor_before
        assert res["donor_weights_unchanged"], "a donor weight changed"
        os.makedirs(os.path.dirname(os.path.realpath(a.out)), exist_ok=True)
        torch.save({"cfg": cfg, "heads": heads, "mode": res["mode"], "note": "T-LDM heads only (FeatureTLDM state dicts); never a donor weight"}, a.out)
        res["saved_MB"] = round(os.path.getsize(a.out) / 1e6, 2)
        print(json.dumps({k: v for k, v in res.items() if k not in ("writer", "loop")}, ensure_ascii=False), flush=True)
        if a.json:
            json.dump(res, open(a.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        return 0
    if a.device != "cpu" or a.dtype != "fp32":                       # full (LoRA) mode on a runner with a GPU: body in the chosen dtype, head + adapters train
        body.to(device=a.device, dtype=torch.bfloat16 if a.dtype == "bf16" else torch.float32)
    model = ShamBodyTLDM(body, latents=int(cfg["latents"]), think_steps=int(cfg["think_steps"]), block=int(cfg["block"]), writer_layers=int(cfg["writer_layers"]), heads=int(cfg["heads"]))
    model.core.to(a.device)
    rep = model.trainable_report()
    print("trainable:", rep, flush=True)
    rows = list(T.TRAIN) + (RW.generate(per_command=int(cfg.get("rewordings_per_command", 24))) if cfg.get("rewordings", False) else [])
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
