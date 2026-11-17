#!/usr/bin/env python3
"""T-LDM in a TERMINAL LOOP: the part of the owner's report that makes the terminal the model's body, not a one-shot executor.

  files        = long-term memory (the model reads what earlier commands wrote)
  the shell    = the hand (the model writes ONE command; the terminal runs it)
  its output   = comes back as input, and the next command depends on it
  the reward   = the terminal's own verdict on the final state (file content / printed answer), no human, no teacher

The terminal here is a small virtual shell (cat, ls, echo TEXT > FILE, calc EXPR, say TEXT, done) over an in-memory file system: deterministic, safe, and able to run thousands of episodes on a CPU.
Tasks need the feedback: "double the number in n.txt and write it to out.txt" cannot be solved without first reading n.txt.
Writer = the report's masked-diffusion block writer (T-LDM); baseline = the same loop with a one-byte-at-a-time recurrent decoder.
Measured: success of whole episodes, on seen words and NEW words; the same model with the terminal's outputs hidden (does the feedback matter?); writing speed; and one self-evolution round
(its own successful episodes, judged by the terminal, are added to training).
Usage: python3 tldm_terminal.py --seconds 600 --out result.json
"""
import argparse, json, math, os, random, re, sys, time
import torch
import torch.nn as nn
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(__file__))
from arch_bench import Block, D  # noqa: E402

N_IN, N_OUT = 128, 48
PAD, MASK, SEP, END = 0, 256, 1, 2
M, T_THINK, S_STEPS, MAX_STEPS = 8, 4, 6, 6
WORDS_TRAIN = ["apple", "table", "green", "water", "house", "light", "stone", "river", "cloud", "bread", "music", "paper", "chair", "plant"]
WORDS_NEW = ["ocean", "tiger", "smile", "dream", "night", "happy"]


# ---------------------------------------------------------------- the terminal
class Terminal:
    def __init__(self, files):
        self.files, self.said, self.done = dict(files), [], False

    def run(self, cmd: str) -> str:
        cmd = cmd.strip()
        if cmd == "done":
            self.done = True
            return ""
        if cmd == "ls":
            return " ".join(sorted(self.files))[:40]
        m = re.fullmatch(r"cat (\S+)", cmd)
        if m:
            return self.files.get(m.group(1), "no such file")[:40]
        m = re.fullmatch(r"echo (.*) > (\S+)", cmd)
        if m:
            self.files[m.group(2)] = m.group(1)
            return ""
        m = re.fullmatch(r"say (.*)", cmd)
        if m:
            self.said.append(m.group(1))
            return ""
        m = re.fullmatch(r"calc (.*)", cmd)
        if m:
            e = m.group(1)
            if re.fullmatch(r"(?:[0-9+\-*/(), ]|max|min|sum)+", e):
                try:
                    return str(eval(e, {"__builtins__": {}}, {"max": max, "min": min, "sum": sum}))[:40]
                except Exception:
                    return "bad expression"
            return "bad expression"
        return "unknown command"


def make_task(rng: random.Random, words):
    k = rng.randrange(7)
    nums = [rng.randrange(2, 60) for _ in range(rng.randrange(3, 5))]
    n = nums[0]
    w = rng.choice(words)
    if k in (0, 6):
        text = "double the number in n.txt and write it to out.txt" if k == 0 else "ضاعف الرقم في n.txt واكتبه في out.txt"
        return text, {"n.txt": str(n)}, [f"cat n.txt", f"calc {n}*2", f"echo {n * 2} > out.txt", "done"], lambda t: t.files.get("out.txt") == str(n * 2)
    if k == 1:
        return "say the largest number in nums.txt", {"nums.txt": " ".join(map(str, nums))}, ["cat nums.txt", f"calc max({','.join(map(str, nums))})", f"say {max(nums)}", "done"], lambda t: t.said == [str(max(nums))]
    if k == 2:
        return "write the sum of nums.txt to s.txt", {"nums.txt": " ".join(map(str, nums))}, ["cat nums.txt", f"calc {'+'.join(map(str, nums))}", f"echo {sum(nums)} > s.txt", "done"], lambda t: t.files.get("s.txt") == str(sum(nums))
    if k == 3:
        return f"write {w} to f.txt", {}, [f"echo {w} > f.txt", "done"], lambda t: t.files.get("f.txt") == w
    if k == 4:
        return "copy a.txt to b.txt", {"a.txt": w}, ["cat a.txt", f"echo {w} > b.txt", "done"], lambda t: t.files.get("b.txt") == w
    if k == 5:
        return "اكتب مجموع الأرقام في nums.txt في s.txt", {"nums.txt": " ".join(map(str, nums))}, ["cat nums.txt", f"calc {'+'.join(map(str, nums))}", f"echo {sum(nums)} > s.txt", "done"], lambda t: t.files.get("s.txt") == str(sum(nums))
    raise AssertionError


def view(task: str, hist, hide_outputs=False) -> list:
    h = "".join(f"$ {c}\n{'' if hide_outputs else o}\n" for c, o in hist) + "$ "
    tb = list(task.encode("utf-8"))[:56]
    hb = list(h.encode("utf-8"))[-(N_IN - len(tb) - 1):]
    s = tb + [10] + hb
    return s + [PAD] * (N_IN - len(s))


def pad_cmd(c: str) -> list:
    b = list(c.encode("utf-8"))[:N_OUT]
    return b + [PAD] * (N_OUT - len(b))


def expert_batch(rng, words, n):
    xs, ys = [], []
    for _ in range(n):
        text, files, cmds, _ = make_task(rng, words)
        term, hist, k = Terminal(files), [], rng.randrange(len(cmds))
        for c in cmds[:k]:
            hist.append((c, term.run(c)))
        xs.append(view(text, hist)); ys.append(pad_cmd(cmds[k]))
    return torch.tensor(xs), torch.tensor(ys)


# ---------------------------------------------------------------- the two writers
class TLDM(nn.Module):
    def __init__(self):
        super().__init__()
        self.emb = nn.Embedding(257, D)
        self.pos_in, self.pos_out = nn.Embedding(N_IN, D), nn.Embedding(N_OUT, D)
        self.reader = nn.ModuleList(Block("rec") for _ in range(2))
        self.rnorm = nn.LayerNorm(D)
        self.queries = nn.Parameter(torch.randn(M, D) * 0.02)
        self.compress = nn.MultiheadAttention(D, 4, batch_first=True)
        self.think = nn.TransformerEncoderLayer(D, 4, 4 * D, dropout=0.0, batch_first=True, norm_first=True)
        self.writer = nn.ModuleList(nn.TransformerDecoderLayer(D, 4, 4 * D, dropout=0.0, batch_first=True, norm_first=True) for _ in range(3))
        self.wnorm = nn.LayerNorm(D)
        self.head = nn.Linear(D, 256)

    def latents(self, ins):
        h = self.emb(ins) + self.pos_in(torch.arange(N_IN))
        for b in self.reader:
            h = b(h)
        h = self.rnorm(h)
        z, _ = self.compress(self.queries[None].expand(ins.shape[0], -1, -1), h, h, key_padding_mask=(ins == PAD))
        for _ in range(T_THINK):
            z = z + self.think(z)
        return z

    def write(self, tok, z):
        x = self.emb(tok) + self.pos_out(torch.arange(N_OUT))
        for layer in self.writer:
            x = layer(x, z)
        return self.head(self.wnorm(x))

    def loss(self, ins, cmd):
        z = self.latents(ins)
        m = torch.rand(cmd.shape) < (torch.rand(cmd.shape[0], 1) * 0.95 + 0.05)
        m[:, 0] |= ~m.any(1)
        return F.cross_entropy(self.write(torch.where(m, torch.full_like(cmd, MASK), cmd), z)[m], cmd[m])

    @torch.no_grad()
    def generate(self, ins, temperature=0.0):
        z = self.latents(ins)
        tok = torch.full((ins.shape[0], N_OUT), MASK)
        for s in range(S_STEPS):
            probs = F.softmax(self.write(tok, z) / (temperature or 1.0), -1)
            pred = torch.multinomial(probs.reshape(-1, 256), 1).reshape(probs.shape[:2]) if temperature else probs.argmax(-1)
            p = probs.gather(-1, pred[..., None])[..., 0]
            masked = tok == MASK
            p = torch.where(masked, p, torch.full_like(p, -1.0))
            n_commit = masked.sum(1) - (N_OUT - int(N_OUT * (s + 1) / S_STEPS))
            order = p.argsort(1, descending=True)
            for i in range(tok.shape[0]):
                idx = order[i, : max(int(n_commit[i]), 0)]
                tok[i, idx] = pred[i, idx]
        return tok


class ARBaseline(nn.Module):
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
        seq = [t for t in ins_row.tolist() if t != PAD] + [SEP]
        x = self.emb(torch.tensor([seq]))
        hs = []
        for b in self.blocks:
            v, g, a = b.mix.p(b.n1(x)).chunk(3, -1)
            a = 0.6 + 0.399 * torch.sigmoid(a)
            h, outs = torch.zeros(1, D), []
            for t in range(x.shape[1]):
                h = a[:, t] * h + (1 - a[:, t]) * v[:, t]
                outs.append(h)
            hs.append(h)
            x = x + b.mix.o(torch.stack(outs, 1) * F.silu(g))
            x = x + b.mlp(b.n2(x))
        out, last = [], x[:, -1]
        for _ in range(N_OUT):
            tok = int(self.head(self.norm(last)).argmax(-1))
            if tok == END:
                break
            out.append(tok)
            h_in = self.emb(torch.tensor([tok]))
            for i, b in enumerate(self.blocks):
                y, hs[i] = b.mix.step(b.n1(h_in), hs[i])
                h_in = h_in + y
                h_in = h_in + b.mlp(b.n2(h_in))
            last = h_in
        return bytes(out).decode("utf-8", "replace")


def ar_batch(rng, words, n):
    L = N_IN + N_OUT + 2
    xs, ms = [], []
    for _ in range(n):
        text, files, cmds, _ = make_task(rng, words)
        term, hist, k = Terminal(files), [], rng.randrange(len(cmds))
        for c in cmds[:k]:
            hist.append((c, term.run(c)))
        a = [t for t in view(text, hist) if t != PAD] + [SEP]
        c = list(cmds[k].encode("utf-8"))[:N_OUT] + [END]
        s = (a + c + [PAD] * L)[:L]
        xs.append(s); ms.append(([0] * len(a) + [1] * len(c) + [0] * L)[:L])
    return torch.tensor(xs), torch.tensor(ms, dtype=torch.bool)


def decode(row) -> str:
    out = bytearray()
    for t in row:
        if int(t) in (PAD, MASK) or int(t) > 255:
            break
        out.append(int(t))
    return out.decode("utf-8", "replace")


# ---------------------------------------------------------------- closed-loop episodes
def episode(write_cmd, text, files, check, hide=False, log=None):
    term, hist = Terminal(files), []
    for _ in range(MAX_STEPS):
        cmd = write_cmd(view(text, hist, hide)).strip()
        hist.append((cmd, term.run(cmd)))
        if log is not None:
            log.append((view(text, hist[:-1], hide), cmd))
        if term.done:
            break
    return check(term), len(hist)


def evaluate(write_cmd, words, seed, n=120, hide=False):
    rng = random.Random(seed)
    ok, steps = 0, 0
    for _ in range(n):
        text, files, _, check = make_task(rng, words)
        r, s = episode(write_cmd, text, files, check, hide)
        ok += r
        steps += s
    return {"success": round(ok / n, 3), "mean_steps": round(steps / n, 2)}


def speed(write_cmd, seed, n=40):
    rng = random.Random(seed)
    t_all, nb = 0.0, 0
    for _ in range(n):
        text, files, cmds, _ = make_task(rng, WORDS_TRAIN)
        for c in cmds[:2]:
            v = view(text, [])
            t0 = time.time()
            out = write_cmd(v)
            t_all += time.time() - t0
            nb += max(len(out.encode("utf-8")), 1)
    return {"ms_per_command": round(t_all / (2 * n) * 1000, 2), "bytes_per_s": round(nb / t_all)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=600)
    ap.add_argument("--evolve_seconds", type=float, default=120)
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    torch.manual_seed(0)
    res = {"budget_s": a.seconds, "threads": torch.get_num_threads(), "max_steps": MAX_STEPS, "diffusion_passes_per_command": S_STEPS}

    model = TLDM()
    res["tldm_params"] = sum(p.numel() for p in model.parameters())
    opt = torch.optim.AdamW(model.parameters(), lr=1.5e-3, weight_decay=0.01)
    rng, t0, steps = random.Random(1), time.time(), 0
    while time.time() - t0 < a.seconds:
        for g in opt.param_groups:
            g["lr"] = 1.5e-3 * min(1.0, (steps + 1) / 100)
        ins, cmd = expert_batch(rng, WORDS_TRAIN, 64)
        opt.zero_grad(set_to_none=True)
        loss = model.loss(ins, cmd)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        steps += 1
        if steps % 200 == 0:
            print("tldm step", steps, "loss", round(loss.item(), 3), flush=True)
    res["tldm_train_steps"] = steps
    model.eval()
    wt = lambda v: decode(model.generate(torch.tensor([v]))[0])
    res["tldm"] = {"seen_words": evaluate(wt, WORDS_TRAIN, 7), "new_words": evaluate(wt, WORDS_NEW, 8), "terminal_outputs_hidden": evaluate(wt, WORDS_TRAIN, 7, hide=True), **speed(wt, 9)}
    print("tldm", res["tldm"], flush=True)

    # self-evolution: the terminal's own verdict on the model's OWN episodes (sampled, so it explores) decides what is kept
    model.eval()
    kept, rng2, t1, tried = [], random.Random(11), time.time(), 0
    wts = lambda v: decode(model.generate(torch.tensor([v]), temperature=0.7)[0])
    while len(kept) < 300 and time.time() - t1 < 90:
        text, files, _, check = make_task(rng2, WORDS_TRAIN + WORDS_NEW)
        log = []
        okk, _ = episode(wts, text, files, check, log=log)
        tried += 1
        if okk:
            kept += log
    model.train()
    t2 = time.time()
    while kept and time.time() - t2 < a.evolve_seconds:
        sel = [kept[rng2.randrange(len(kept))] for _ in range(32)]
        ins, cmd = expert_batch(rng2, WORDS_TRAIN + WORDS_NEW, 32)
        ins = torch.cat([ins, torch.tensor([s[0] for s in sel])]); cmd = torch.cat([cmd, torch.tensor([pad_cmd(s[1]) for s in sel])])
        opt.zero_grad(set_to_none=True)
        model.loss(ins, cmd).backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
    model.eval()
    res["tldm_after_evolution"] = {"episodes_tried": tried, "kept_steps_from_successful_episodes": len(kept), "seen_words": evaluate(wt, WORDS_TRAIN, 7), "new_words": evaluate(wt, WORDS_NEW, 8)}
    print("tldm evolved", res["tldm_after_evolution"], flush=True)

    torch.manual_seed(0)
    base = ARBaseline()
    res["ar_params"] = sum(p.numel() for p in base.parameters())
    optb = torch.optim.AdamW(base.parameters(), lr=1.5e-3, weight_decay=0.01)
    rng, t0, steps = random.Random(1), time.time(), 0
    while time.time() - t0 < a.seconds:
        for g in optb.param_groups:
            g["lr"] = 1.5e-3 * min(1.0, (steps + 1) / 100)
        x, m = ar_batch(rng, WORDS_TRAIN, 64)
        optb.zero_grad(set_to_none=True)
        loss = F.cross_entropy(base(x[:, :-1])[m[:, 1:]], x[:, 1:][m[:, 1:]])
        loss.backward()
        torch.nn.utils.clip_grad_norm_(base.parameters(), 1.0)
        optb.step()
        steps += 1
        if steps % 200 == 0:
            print("ar step", steps, "loss", round(loss.item(), 3), flush=True)
    res["ar_train_steps"] = steps
    base.eval()
    wa = lambda v: base.generate(torch.tensor(v))
    res["autoregressive"] = {"seen_words": evaluate(wa, WORDS_TRAIN, 7), "new_words": evaluate(wa, WORDS_NEW, 8), "terminal_outputs_hidden": evaluate(wa, WORDS_TRAIN, 7, hide=True), **speed(wa, 9)}
    print("ar", res["autoregressive"], flush=True)
    print(json.dumps(res, indent=1))
    if a.out:
        open(a.out, "w").write(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
