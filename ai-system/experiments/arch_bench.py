#!/usr/bin/env python3
"""Architecture micro-benchmark: turns the claims of the "terminal LDM" report into measurements at a size we can run on a free CPU.

Three claims, three tests (same corpus, same size class, same wall-clock training budget for each model):
  1. "Linear / state-space layers keep the speed at a long context, attention slows down."  -> ms per generated token at context 256 ... 32768, attention (KV cache) vs a gated linear recurrence.
  2. "A small model of this kind learns as well per unit of time."                           -> validation bits per byte after the same training seconds.
  3. "Writing K tokens per forward pass (draft heads + one verifying pass) multiplies the speed." -> tokens obtained per verifying pass with K=4 draft heads (speculative self-drafting).

It does NOT test: diffusion writing, hypernetworks, BitNet training, peer-to-peer experts (each is a research project of its own; see docs/experiments).
Corpus: the repository's own Arabic/English documents (byte-level, vocabulary 256). Usage:  python3 arch_bench.py --seconds 120 --out result.json
"""
import argparse, glob, json, math, os, time
import torch
import torch.nn as nn
import torch.nn.functional as F

D, L, HEADS, SEQ, BATCH = 128, 4, 4, 256, 16
CHUNK = 32


def corpus(root: str, max_bytes: int = 3_000_000) -> torch.Tensor:
    buf = bytearray()
    for f in sorted(glob.glob(os.path.join(root, "docs", "**", "*.md"), recursive=True)):
        try:
            buf += open(f, "rb").read() + b"\n"
        except OSError:
            continue
        if len(buf) >= max_bytes:
            break
    return torch.frombuffer(bytes(buf), dtype=torch.uint8).long()


class Attn(nn.Module):
    def __init__(self):
        super().__init__()
        self.qkv = nn.Linear(D, 3 * D, bias=False)
        self.o = nn.Linear(D, D, bias=False)

    def forward(self, x):
        b, t, _ = x.shape
        q, k, v = self.qkv(x).view(b, t, 3, HEADS, D // HEADS).permute(2, 0, 3, 1, 4)
        y = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        return self.o(y.transpose(1, 2).reshape(b, t, D))


class Rec(nn.Module):
    """Gated linear recurrence: h_t = a_t * h_{t-1} + (1 - a_t) * v_t, y = h * silu(g). Constant cost per generated token."""

    def __init__(self):
        super().__init__()
        self.p = nn.Linear(D, 3 * D, bias=False)
        self.o = nn.Linear(D, D, bias=False)

    def forward(self, x):
        b, t, _ = x.shape
        v, g, a = self.p(x).chunk(3, -1)
        a = 0.6 + 0.399 * torch.sigmoid(a)                # (0.6, 0.999): keeps exp(-cumsum(log a)) inside float32 over a chunk
        u = (1 - a) * v
        la = torch.log(a)
        pad = (-t) % CHUNK
        if pad:
            u, la = F.pad(u, (0, 0, 0, pad)), F.pad(la, (0, 0, 0, pad))
        n = u.shape[1] // CHUNK
        u, la = u.view(b, n, CHUNK, D), la.view(b, n, CHUNK, D)
        c = torch.cumsum(la, 2)
        intra = torch.exp(c) * torch.cumsum(u * torch.exp(-c), 2)   # inside each chunk
        carry, outs = torch.zeros(b, D), []
        for i in range(n):                                           # between chunks: n = SEQ/CHUNK = 8 steps
            h = intra[:, i] + torch.exp(c[:, i]) * carry[:, None, :]
            outs.append(h)
            carry = h[:, -1]
        h = torch.cat(outs, 1)[:, :t]
        return self.o(h * F.silu(g))

    def step(self, x, h):                                            # one generated token
        v, g, a = self.p(x).chunk(3, -1)
        a = 0.6 + 0.399 * torch.sigmoid(a)
        h = a * h + (1 - a) * v
        return self.o(h * F.silu(g)), h


class Block(nn.Module):
    def __init__(self, kind):
        super().__init__()
        self.n1, self.n2 = nn.LayerNorm(D), nn.LayerNorm(D)
        self.mix = Attn() if kind == "attn" else Rec()
        self.mlp = nn.Sequential(nn.Linear(D, 4 * D), nn.GELU(), nn.Linear(4 * D, D))

    def forward(self, x):
        x = x + self.mix(self.n1(x))
        return x + self.mlp(self.n2(x))


class LM(nn.Module):
    def __init__(self, kind, k_heads=1):
        super().__init__()
        self.emb = nn.Embedding(256, D)
        self.pos = nn.Embedding(SEQ, D) if kind == "attn" else None
        self.blocks = nn.ModuleList(Block(kind) for _ in range(L))
        self.norm = nn.LayerNorm(D)
        self.heads = nn.ModuleList(nn.Linear(D, 256, bias=False) for _ in range(k_heads))   # head j predicts token t+1+j

    def hidden(self, x):
        h = self.emb(x)
        if self.pos is not None:
            h = h + self.pos(torch.arange(x.shape[1]))
        for b in self.blocks:
            h = b(h)
        return self.norm(h)

    def loss(self, x, y_all):                                         # y_all[j] = target of head j
        h = self.hidden(x)
        tot = 0.0
        for j, hd in enumerate(self.heads):
            n = x.shape[1] - j
            tot = tot + F.cross_entropy(hd(h[:, :n]).reshape(-1, 256), y_all[j][:, :n].reshape(-1))
        return tot / len(self.heads)


def batch(data, g):
    ix = torch.randint(0, len(data) - SEQ - 8, (BATCH,), generator=g)
    x = torch.stack([data[i:i + SEQ] for i in ix])
    ys = [torch.stack([data[i + 1 + j:i + 1 + j + SEQ] for i in ix]) for j in range(4)]
    return x, ys


@torch.no_grad()
def val_bpb(model, data):
    model.eval()
    g = torch.Generator().manual_seed(1)
    tot = 0.0
    for _ in range(20):
        x, ys = batch(data, g)
        h = model.hidden(x)
        tot += F.cross_entropy(model.heads[0](h).reshape(-1, 256), ys[0].reshape(-1)).item()
    model.train()
    return tot / 20 / math.log(2)


def train(kind, k_heads, seconds, tr, seed=0):
    torch.manual_seed(seed)
    model = LM(kind, k_heads)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=0.01)
    g = torch.Generator().manual_seed(seed)
    t0, steps = time.time(), 0
    while time.time() - t0 < seconds:
        lr = 2e-3 * min(1.0, (steps + 1) / 50)
        for p in opt.param_groups:
            p["lr"] = lr
        x, ys = batch(tr, g)
        opt.zero_grad(set_to_none=True)
        model.loss(x, ys).backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        steps += 1
    el = time.time() - t0
    return model, {"steps": steps, "train_tokens_per_s": round(steps * BATCH * SEQ / el), "params": sum(p.numel() for p in model.parameters())}


@torch.no_grad()
def decode_ms(kind, ctx):
    """Milliseconds to produce ONE token with `ctx` tokens of context already seen (batch 1, whole model)."""
    reps = 30
    if kind == "attn":
        kc = [torch.randn(1, HEADS, ctx, D // HEADS) for _ in range(L)]
        vc = [torch.randn(1, HEADS, ctx, D // HEADS) for _ in range(L)]
        blocks = [Block("attn") for _ in range(L)]
        x = torch.randn(1, 1, D)
        t0 = time.time()
        for _ in range(reps):
            h = x
            for i, b in enumerate(blocks):
                q, k, v = b.mix.qkv(b.n1(h)).view(1, 1, 3, HEADS, D // HEADS).permute(2, 0, 3, 1, 4)
                y = F.scaled_dot_product_attention(q, torch.cat([kc[i], k], 2), torch.cat([vc[i], v], 2))
                h = h + b.mix.o(y.transpose(1, 2).reshape(1, 1, D))
                h = h + b.mlp(b.n2(h))
        return (time.time() - t0) / reps * 1000
    blocks = [Block("rec") for _ in range(L)]
    hs = [torch.zeros(1, D) for _ in range(L)]
    x = torch.randn(1, D)
    t0 = time.time()
    for _ in range(reps):
        h = x
        for i, b in enumerate(blocks):
            y, hs[i] = b.mix.step(b.n1(h), hs[i])
            h = h + y
            h = h + b.mlp(b.n2(h))
    return (time.time() - t0) / reps * 1000


@torch.no_grad()
def spec_tokens_per_pass(model, data, k=4, trials=200):
    """Self-drafting: head j proposes token t+1+j from one position; ONE verifying pass of the main head over the proposals keeps the longest agreeing prefix."""
    model.eval()
    g = torch.Generator().manual_seed(2)
    total = 0
    for _ in range(trials):
        i = int(torch.randint(0, len(data) - 160, (1,), generator=g))
        ctx = data[i:i + 128][None]
        h = model.hidden(ctx)[:, -1]
        draft = [model.heads[j](h).argmax(-1) for j in range(k)]          # proposals for t+1 .. t+k
        full = torch.cat([ctx] + [d[None] for d in draft[:-1]], 1)         # context + proposals 1..k-1, then the main head checks every position
        hv = model.hidden(full)
        ok = 0
        for j in range(k):
            guess = model.heads[0](hv[:, 127 + j]).argmax(-1)
            if int(guess) == int(draft[j]):
                ok += 1
            else:
                break
        total += ok + (1 if ok < k else 0)                                 # the verifying pass also yields its own next token
    model.train()
    return total / trials


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=120)
    ap.add_argument("--root", default=os.path.join(os.path.dirname(__file__), "..", ".."))
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    data = corpus(a.root)
    cut = int(len(data) * 0.95)
    tr, va = data[:cut], data[cut:]
    res = {"corpus_bytes": len(data), "budget_s_each": a.seconds, "threads": torch.get_num_threads(), "decode_ms_per_token": {}}
    for ctx in (256, 2048, 8192, 32768):
        res["decode_ms_per_token"][str(ctx)] = {"attention": round(decode_ms("attn", ctx), 3), "recurrence": round(decode_ms("rec", ctx), 3)}
    for name, kind, kh in (("attention", "attn", 1), ("recurrence", "rec", 1), ("attention_mtp4", "attn", 4)):
        m, info = train(kind, kh, a.seconds, tr)
        info["val_bits_per_byte"] = round(val_bpb(m, va), 4)
        if kh == 4:
            info["tokens_per_verifying_pass"] = round(spec_tokens_per_pass(m, va, 4), 3)
        res[name] = info
        print(name, info, flush=True)
    print(json.dumps(res, indent=1))
    if a.out:
        open(a.out, "w").write(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
