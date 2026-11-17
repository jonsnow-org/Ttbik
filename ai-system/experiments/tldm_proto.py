#!/usr/bin/env python3
"""T-LDM prototype: the architecture of the owner's report, built small enough to train on a CPU and judged by EXECUTING what it writes.

Pipeline (the report's seven stages):
  1 input        instruction bytes (English / Arabic) for a terminal task ("sum of numbers from 3 to 41", "reverse the word apple", ...)
  2 reader       gated linear recurrence layers (the Mamba-style parallel reader: linear in the length, arch_bench.Rec)
  3 compressor   M learned queries cross-attend to the reader states -> M latent vectors (the report's "1000 latents", here 8)
  4 thinker      T steps of one shared block over the latents: z <- z + f(z), no word is written
  5 writer       masked-DIFFUSION block writer: the whole 64-byte code block starts masked and is filled in S passes (confident bytes first)
  6 executor     the written code is run in a child process (empty env, timeout); the printed result is compared with the truth
  7 evolution    one round of rejection-sampling: successful self-written pairs are added to training, and the accuracy change is measured
Baseline: the same data written one byte at a time by a gated-recurrence decoder (stateful stepping, the best case of an autoregressive writer).
Questions answered by numbers: does it learn? how fast does it write (bytes/s, forward passes per block)? how accurate is the executed result, on new numbers and on NEW words?
Usage: python3 tldm_proto.py --seconds 240 --out result.json
"""
import argparse, json, math, os, random, subprocess, sys, time
import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(__file__))
from arch_bench import Block, D  # noqa: E402  (gated linear recurrence block, width 128)

N = int(os.environ.get("TLDM_N", "64"))      # bytes of the instruction and of the code block (TLDM_N=128 for the long regime)
REGIME = os.environ.get("TLDM_REGIME", "short")   # "short": ~25-byte commands; "long": 60-110 byte one-liners (the report's regime: a block of ~128 tokens)
PAD, MASK = 0, 256
M, T_THINK, S_STEPS = 8, 4, 8
WORDS_TRAIN = ["apple", "table", "green", "water", "house", "light", "stone", "river", "cloud", "bread", "music", "paper", "chair", "plant"]
WORDS_NEW = ["ocean", "tiger", "smile", "dream", "night", "happy"]


# ---------------------------------------------------------------- data: terminal tasks with a checkable result
def make_long(rng: random.Random, words):
    a, b, m = rng.randrange(1, 30), rng.randrange(8, 25), rng.randrange(2, 9)
    lst = [rng.randrange(1, 90) for _ in range(rng.randrange(4, 7))]
    w = rng.choice(words) + rng.choice(words)
    k = rng.randrange(6)
    if k == 0:
        return f"even numbers from {a} to {a + b} each times {m}", f"[x*{m} for x in range({a},{a + b + 1}) if x%2==0]"
    if k == 1:
        return f"sum of squares from {a} to {a + b} plus {m}", f"sum(x*x for x in range({a},{a + b + 1}))+{m}"
    if k == 2:
        return f"the three largest of {lst} from big to small", f"sorted({lst})[::-1][:3]"
    if k == 3:
        return f"alternate upper and lower case in {w}", f"''.join(c.upper() if i%2==0 else c for i,c in enumerate('{w}'))"
    if k == 4:
        return f"length of {w} times {m} plus the sum of {lst}", f"len('{w}')*{m}+sum({lst})"
    return f"numbers in {lst} greater than {a} doubled", f"[x*2 for x in {lst} if x>{a}]"


def make(rng: random.Random, words):
    if REGIME == "long":
        return make_long(rng, words)
    k = rng.randrange(13)
    a, b = rng.randrange(1, 50), rng.randrange(2, 20)
    lst = [rng.randrange(1, 90) for _ in range(rng.randrange(3, 6))]
    w = rng.choice(words)
    c = rng.choice(w)
    if k == 0:
        lo, hi = sorted((a, a + b))
        return f"sum of numbers from {lo} to {hi}", f"sum(range({lo},{hi + 1}))"
    if k == 1:
        return f"reverse the word {w}", f"'{w}'[::-1]"
    if k == 2:
        return f"how many letters in {w}", f"len('{w}')"
    if k == 3:
        return f"largest of {lst}", f"max({lst})"
    if k == 4:
        return f"sort {lst}", f"sorted({lst})"
    if k == 5:
        return f"multiply {a} by {b}", f"{a}*{b}"
    if k == 6:
        return f"uppercase {w}", f"'{w}'.upper()"
    if k == 7:
        return f"count the letter {c} in {w}", f"'{w}'.count('{c}')"
    if k == 8:
        return f"even numbers in {lst}", f"[x for x in {lst} if x%2==0]"
    if k == 9:
        return f"{a} to the power {min(b, 4)}", f"{a}**{min(b, 4)}"
    if k == 10:
        lo, hi = sorted((a, a + b))
        return f"مجموع الأعداد من {lo} إلى {hi}", f"sum(range({lo},{hi + 1}))"
    if k == 11:
        return f"اضرب {a} في {b}", f"{a}*{b}"
    return f"أكبر عدد في {lst}", f"max({lst})"


def pack(s: str):
    b = list(s.encode("utf-8"))[:N]
    return b + [PAD] * (N - len(b))


def batch(rng, words, n):
    xs, ys, ex = [], [], []
    for _ in range(n):
        ins, expr = make(rng, words)
        code = f"print({expr})"
        xs.append(pack(ins)); ys.append(pack(code)); ex.append(str(eval(expr)))
    return torch.tensor(xs), torch.tensor(ys), ex


# ---------------------------------------------------------------- the model
class TLDM(nn.Module):
    def __init__(self):
        super().__init__()
        self.emb = nn.Embedding(257, D)
        self.pos_in, self.pos_out = nn.Embedding(N, D), nn.Embedding(N, D)
        self.reader = nn.ModuleList(Block("rec") for _ in range(2))
        self.rnorm = nn.LayerNorm(D)
        self.queries = nn.Parameter(torch.randn(M, D) * 0.02)
        self.compress = nn.MultiheadAttention(D, 4, batch_first=True)
        self.think = nn.TransformerEncoderLayer(D, 4, 4 * D, dropout=0.0, batch_first=True, norm_first=True)
        self.writer = nn.ModuleList(nn.TransformerDecoderLayer(D, 4, 4 * D, dropout=0.0, batch_first=True, norm_first=True) for _ in range(3))
        self.wnorm = nn.LayerNorm(D)
        self.head = nn.Linear(D, 256)

    def latents(self, ins):                                   # stages 2-4: read, compress, think (no word written)
        h = self.emb(ins) + self.pos_in(torch.arange(N))
        for b in self.reader:
            h = b(h)
        h = self.rnorm(h)
        q = self.queries[None].expand(ins.shape[0], -1, -1)
        z, _ = self.compress(q, h, h, key_padding_mask=(ins == PAD))
        for _ in range(T_THINK):
            z = z + self.think(z)
        return z

    def write(self, tokens, z):                               # stage 5: one pass of the block writer (bidirectional, sees the latents)
        x = self.emb(tokens) + self.pos_out(torch.arange(N))
        for layer in self.writer:
            x = layer(x, z)
        return self.head(self.wnorm(x))

    def loss(self, ins, code):
        z = self.latents(ins)
        r = torch.rand(code.shape[0], 1) * 0.95 + 0.05
        m = torch.rand(code.shape) < r
        m[:, 0] |= ~m.any(1)
        logits = self.write(torch.where(m, torch.full_like(code, MASK), code), z)
        return F.cross_entropy(logits[m], code[m])

    @torch.no_grad()
    def generate(self, ins, steps=S_STEPS):
        z = self.latents(ins)
        tok = torch.full((ins.shape[0], N), MASK)
        for s in range(steps):
            logits = self.write(tok, z)
            p, pred = F.softmax(logits, -1).max(-1)
            masked = tok == MASK
            p = torch.where(masked, p, torch.full_like(p, -1.0))
            keep = N - int(N * (s + 1) / steps)                # masked positions that remain after this pass
            n_commit = masked.sum(1) - keep
            order = p.argsort(1, descending=True)
            for i in range(tok.shape[0]):
                idx = order[i, : max(int(n_commit[i]), 0)]
                tok[i, idx] = pred[i, idx]
        return tok


class ARBaseline(nn.Module):
    """Writes the code one byte at a time with a gated-recurrence decoder; generation uses the recurrent state (cost per byte is constant)."""

    def __init__(self):
        super().__init__()
        self.emb = nn.Embedding(256, D)
        self.blocks = nn.ModuleList(Block("rec") for _ in range(4))
        self.norm = nn.LayerNorm(D)
        self.head = nn.Linear(D, 256)

    def forward(self, x):
        h = self.emb(x)
        for b in self.blocks:
            h = b(h)
        return self.head(self.norm(h))

    @torch.no_grad()
    def generate(self, ins_row):
        seq = [t for t in ins_row.tolist() if t != PAD] + [1]
        x = self.emb(torch.tensor([seq]))
        hs = []
        for b in self.blocks:                                  # prompt pass: keep each layer's final state
            hn = b.n1(x)
            v, g, a = b.mix.p(hn).chunk(3, -1)
            a = 0.6 + 0.399 * torch.sigmoid(a)
            h, outs = torch.zeros(1, D), []
            for t in range(x.shape[1]):
                h = a[:, t] * h + (1 - a[:, t]) * v[:, t]
                outs.append(h)
            hs.append(h)
            y = b.mix.o(torch.stack(outs, 1) * F.silu(g))
            x = x + y
            x = x + b.mlp(b.n2(x))
        out, last = [], x[:, -1]
        for _ in range(N):
            tok = int(self.head(self.norm(last)).argmax(-1))
            if tok == 2:
                break
            out.append(tok)
            h_in = self.emb(torch.tensor([tok]))
            for i, b in enumerate(self.blocks):
                y, hs[i] = b.mix.step(b.n1(h_in), hs[i])
                h_in = h_in + y
                h_in = h_in + b.mlp(b.n2(h_in))
            last = h_in
        return out


def ar_batch(rng, words, n):
    L = 2 * N + 2
    xs, ms = [], []
    for _ in range(n):
        ins, expr = make(rng, words)
        a = [t for t in ins.encode("utf-8")][:N] + [1]
        c = list(f"print({expr})".encode("utf-8"))[:N] + [2]
        s = (a + c + [PAD] * L)[:L]
        xs.append(s)
        ms.append([0] * len(a) + [1] * len(c) + [0] * L)
    return torch.tensor(xs), torch.tensor([m[:L] for m in ms], dtype=torch.bool)


# ---------------------------------------------------------------- stage 6: the terminal executes what was written
def run_code(code: str, timeout=5) -> str:
    if not code.startswith("print(") or any(w in code for w in ("import", "open", "exec", "eval", "__", "os.", "sys")):
        return "<refused>"
    try:
        r = subprocess.run([sys.executable, "-I", "-c", code], env={}, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else "<error>"
    except subprocess.TimeoutExpired:
        return "<timeout>"


def decode(row) -> str:
    out = bytearray()
    for t in row:
        if int(t) == PAD:
            break
        out.append(int(t))
    return out.decode("utf-8", "replace")


def evaluate(gen_block, words, seed, n=150):
    rng = random.Random(seed)
    ok = 0
    for _ in range(n):
        ins, expr = make(rng, words)
        ok += run_code(gen_block(ins)) == str(eval(expr))
    return round(ok / n, 3)


def timeit(gen_block, seed, n=40):
    rng = random.Random(seed)
    lat, nbytes = 0.0, 0
    for _ in range(n):
        ins, _ = make(rng, WORDS_TRAIN)
        t0 = time.time()
        code = gen_block(ins)
        lat += time.time() - t0
        nbytes += len(code.encode("utf-8"))
    return {"ms_per_sample": round(lat / n * 1000, 2), "bytes_per_s": round(nbytes / lat)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=240)
    ap.add_argument("--evolve_seconds", type=float, default=60)
    ap.add_argument("--steps", type=int, default=0, help="train both models for exactly this many steps (equal-steps comparison); 0 = use --seconds")
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    torch.manual_seed(0)
    res = {"regime": REGIME, "N": N, "equal_steps": a.steps, "budget_s": a.seconds, "threads": torch.get_num_threads(), "latents": M, "think_steps": T_THINK, "diffusion_steps": S_STEPS}

    # ---- T-LDM
    model = TLDM()
    res["tldm_params"] = sum(p.numel() for p in model.parameters())
    opt = torch.optim.AdamW(model.parameters(), lr=1.5e-3, weight_decay=0.01)
    rng, t0, steps = random.Random(1), time.time(), 0
    while (steps < a.steps) if a.steps else (time.time() - t0 < a.seconds):
        for g in opt.param_groups:
            g["lr"] = 1.5e-3 * min(1.0, (steps + 1) / 100)
        ins, code, _ = batch(rng, WORDS_TRAIN, 64)
        opt.zero_grad(set_to_none=True)
        loss = model.loss(ins, code)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        steps += 1
        if steps % 200 == 0:
            print("tldm step", steps, "loss", round(loss.item(), 3), flush=True)
    res["tldm_train_steps"] = steps
    model.eval()
    gen_t = lambda ins: decode(model.generate(torch.tensor([pack(ins)]))[0])
    res["tldm"] = {"acc_seen_words": evaluate(gen_t, WORDS_TRAIN, 7), "acc_new_words": evaluate(gen_t, WORDS_NEW, 8), "writer_passes_per_block": S_STEPS, **timeit(gen_t, 9)}
    print("tldm", res["tldm"], flush=True)

    # ---- stage 7: rejection-sampling evolution round (the model's own executed successes are added to training)
    model.train()
    kept, rng2, t1 = [], random.Random(11), time.time()
    model.eval()
    while len(kept) < 256 and time.time() - t1 < 30:
        ins, expr = make(rng2, WORDS_TRAIN + WORDS_NEW)
        code = gen_t(ins)
        if run_code(code) == str(eval(expr)):
            kept.append((pack(ins), pack(code)))
    model.train()
    t2 = time.time()
    while kept and time.time() - t2 < a.evolve_seconds:
        sel = [kept[rng2.randrange(len(kept))] for _ in range(32)]
        ins, code, _ = batch(rng2, WORDS_TRAIN + WORDS_NEW, 32)
        ins = torch.cat([ins, torch.tensor([s[0] for s in sel])]); code = torch.cat([code, torch.tensor([s[1] for s in sel])])
        opt.zero_grad(set_to_none=True)
        model.loss(ins, code).backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
    model.eval()
    res["tldm_after_evolution"] = {"kept_successes": len(kept), "acc_seen_words": evaluate(gen_t, WORDS_TRAIN, 7), "acc_new_words": evaluate(gen_t, WORDS_NEW, 8)}
    print("tldm evolved", res["tldm_after_evolution"], flush=True)

    # ---- baseline: one byte at a time
    torch.manual_seed(0)
    base = ARBaseline()
    res["ar_params"] = sum(p.numel() for p in base.parameters())
    opt = torch.optim.AdamW(base.parameters(), lr=1.5e-3, weight_decay=0.01)
    rng, t0, steps = random.Random(1), time.time(), 0
    while (steps < a.steps) if a.steps else (time.time() - t0 < a.seconds):
        for g in opt.param_groups:
            g["lr"] = 1.5e-3 * min(1.0, (steps + 1) / 100)
        x, m = ar_batch(rng, WORDS_TRAIN, 64)
        opt.zero_grad(set_to_none=True)
        lg = base(x[:, :-1])
        loss = F.cross_entropy(lg[m[:, 1:]], x[:, 1:][m[:, 1:]])
        loss.backward()
        torch.nn.utils.clip_grad_norm_(base.parameters(), 1.0)
        opt.step()
        steps += 1
        if steps % 200 == 0:
            print("ar step", steps, "loss", round(loss.item(), 3), flush=True)
    res["ar_train_steps"] = steps
    base.eval()
    gen_a = lambda ins: bytes(base.generate(torch.tensor(pack(ins)))).decode("utf-8", "replace")
    res["autoregressive"] = {"acc_seen_words": evaluate(gen_a, WORDS_TRAIN, 7), "acc_new_words": evaluate(gen_a, WORDS_NEW, 8), **timeit(gen_a, 9)}
    print("ar", res["autoregressive"], flush=True)
    print(json.dumps(res, indent=1))
    if a.out:
        open(a.out, "w").write(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
