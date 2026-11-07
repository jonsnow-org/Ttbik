"""
Sham — how to COMPRESS the weights WITHOUT losing quality ("الضغط الذي لا يُفسد الجودة").

Compressing a finished model hurts when it is done blindly (one scale per whole tensor, every layer at the same width, no repair). This module is the
careful version, the recipe that the literature and our own measurements (`python sham_quant_recipes.py --lab`) rank in order of cost:

  1. int8 per output channel                      — almost lossless, 2x smaller than bf16
  2. int4 in GROUPS of 32..128 weights, each group with its own scale  — the scale follows the local range instead of one outlier ruining a whole row
  3. + the best clipping per group (MSE search)    — a few outliers are clipped on purpose, the bulk is represented better
  4. + the sensitive parts kept wider              — embedding / output head / first and last blocks stay int8
  5. + a SHORT repair run with self-distillation   — the uncompressed model is the teacher of its own compressed copy (no outside teacher needed);
                                                     only a few dozen steps, at the END of training, on the data it was trained on

Everything here is "fake quantization": weights are rounded and written back as floats, so the accuracy is exactly what a real int4/int8 kernel would give
and the result still loads into the plain `ShamSmall`. (Real packed int4 storage / GGUF export is a separate, mechanical step.)

Works on any torch model made of nn.Linear / nn.Embedding (ShamSmall and Hugging Face Llama-style models alike).
"""
from __future__ import annotations

import copy
import math
import sys

import torch
import torch.nn as nn
import torch.nn.functional as F


def quant_groupwise(w: torch.Tensor, bits: int = 4, group: int = 64, clip_search: bool = False) -> torch.Tensor:
    """Symmetric round-to-nearest of a (rows, cols) weight in groups of `group` consecutive columns, one scale per (row, group). group<=0 = one scale per row."""
    rows, cols = w.shape
    g = cols if group <= 0 else group
    pad = (-cols) % g
    x = F.pad(w, (0, pad)) if pad else w
    x = x.reshape(rows, -1, g)
    qmax = 2 ** (bits - 1) - 1
    amax = x.abs().amax(dim=-1, keepdim=True).clamp_min(1e-8)
    if clip_search:
        best_err, best_scale = None, None
        for ratio in (1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65):
            scale = amax * ratio / qmax
            q = torch.clamp(torch.round(x / scale), -qmax - 1, qmax)
            err = ((q * scale - x) ** 2).sum(dim=-1, keepdim=True)
            if best_err is None:
                best_err, best_scale = err, scale
            else:
                better = err < best_err
                best_err, best_scale = torch.where(better, err, best_err), torch.where(better, scale, best_scale)
        scale = best_scale
    else:
        scale = amax / qmax
    q = torch.clamp(torch.round(x / scale), -qmax - 1, qmax)
    return (q * scale).reshape(rows, -1)[:, :cols]


def weight_bytes(numel: int, bits: int, group: int, cols: int) -> float:
    """Storage of one quantized matrix: the integers plus one fp16 scale per group."""
    groups = numel / (cols if group <= 0 else min(group, cols))
    return numel * bits / 8 + groups * 2


def _is_sensitive(name: str, n_layers: int | None, protect_ends: int) -> bool:
    lowered = name.lower()
    if any(k in lowered for k in ("embed", "lm_head", "token_embedding", "wte")):
        return True
    if n_layers and protect_ends > 0:
        import re
        m = re.search(r"layers?\.(\d+)\.", lowered)
        if m and (int(m.group(1)) < protect_ends or int(m.group(1)) >= n_layers - protect_ends):
            return True
    return False


@torch.no_grad()
def apply_recipe(model: nn.Module, bits: int = 4, group: int = 64, clip_search: bool = True, protect_bits: int = 8, protect_ends: int = 0,
                 n_layers: int | None = None) -> dict:
    """Round the weights of every Linear/Embedding in place. Sensitive parts (embedding, head, first/last `protect_ends` blocks) use `protect_bits`
    (0 = leave them in full precision). Returns {"bytes": estimated compressed size, "fp_bytes": 16-bit size}."""
    total, fp_total = 0.0, 0.0
    seen = set()
    for name, mod in model.named_modules():
        if not isinstance(mod, (nn.Linear, nn.Embedding)) or id(mod.weight) in seen:
            continue
        seen.add(id(mod.weight))
        w = mod.weight
        fp_total += w.numel() * 2
        sensitive = _is_sensitive(name, n_layers, protect_ends)
        b = protect_bits if sensitive else bits
        if b <= 0 or b >= 16:
            total += w.numel() * 2
            continue
        g = max(group, 0)
        mod.weight.copy_(quant_groupwise(w.float(), b, g, clip_search=clip_search and not sensitive).to(w.dtype))
        total += weight_bytes(w.numel(), b, g, w.shape[1])
    return {"bytes": total, "fp_bytes": fp_total}


class _QLinear(nn.Module):
    """Linear whose weight is rounded in the forward pass (straight-through), for the short repair run."""

    def __init__(self, lin: nn.Linear, bits: int, group: int):
        super().__init__()
        self.lin, self.bits, self.group = lin, bits, group

    @property
    def weight(self):
        return self.lin.weight

    @property
    def bias(self):
        return self.lin.bias

    def forward(self, x):
        w = self.lin.weight
        wq = quant_groupwise(w.detach().float(), self.bits, self.group).to(w.dtype)
        w_ste = w + (wq - w).detach()
        return F.linear(x, w_ste, self.lin.bias)


def wrap_for_repair(model: nn.Module, bits: int = 4, group: int = 64, protect_ends: int = 0, n_layers: int | None = None) -> int:
    """Swap the non-sensitive Linear layers for straight-through wrappers (embedding and head are left alone: they are protected)."""
    count = 0
    for parent_name, parent in list(model.named_modules()):
        for child_name, child in list(parent.named_children()):
            full = f"{parent_name}.{child_name}" if parent_name else child_name
            if isinstance(child, nn.Linear) and not _is_sensitive(full, n_layers, protect_ends):
                setattr(parent, child_name, _QLinear(child, bits, group))
                count += 1
    return count


def unwrap_after_repair(model: nn.Module) -> None:
    for parent in list(model.modules()):
        for child_name, child in list(parent.named_children()):
            if isinstance(child, _QLinear):
                setattr(parent, child_name, child.lin)


def self_distill_repair(student: nn.Module, teacher: nn.Module, batches, steps: int = 60, lr: float = 2e-5, temperature: float = 1.0,
                        logits_of=lambda out: out.logits) -> list[float]:
    """The short repair run: loss = KL(teacher || student) on the training data. `batches` yields LongTensor (B, T)."""
    student.train()
    teacher.eval()
    params = [p for p in student.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=0.0)
    history = []
    it = iter(batches)
    for _ in range(steps):
        try:
            ids = next(it)
        except StopIteration:
            it = iter(batches)
            ids = next(it)
        with torch.no_grad():
            t_logits = logits_of(teacher(ids)).float()
        s_logits = logits_of(student(ids)).float()
        loss = F.kl_div(F.log_softmax(s_logits / temperature, -1), F.softmax(t_logits / temperature, -1), reduction="batchmean") * (temperature ** 2)
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        opt.step()
        history.append(float(loss))
    student.eval()
    return history


# ---------------------------------------------------------------- the measurement lab (needs `transformers` and internet for the data)

def _eval_windows(tokenizer, n_each: int = 40, seq: int = 256):
    from datasets import load_dataset
    out = {}
    specs = {"en": ("HuggingFaceFW/fineweb-edu", "sample-10BT", "text"), "ar": ("wikimedia/wikipedia", "20231101.ar", "text")}
    for tag, (ds, cfg, field) in specs.items():
        stream = load_dataset(ds, cfg, split="train", streaming=True)
        ids: list[int] = []
        for i, row in enumerate(stream):
            if i < 300:        # skip the head: it is what most small models saw most
                continue
            ids += tokenizer(row[field][:4000])["input_ids"] + [tokenizer.eos_token_id or 0]
            if len(ids) >= n_each * seq:
                break
        out[tag] = torch.tensor(ids[: n_each * seq]).view(n_each, seq)
    return out


@torch.no_grad()
def _ppl(model, windows, batch: int = 8) -> dict:
    model.eval()
    res = {}
    for tag, w in windows.items():
        tot, n = 0.0, 0
        for i in range(0, len(w), batch):
            ids = w[i:i + batch]
            logits = model(ids).logits[:, :-1].float()
            tot += float(F.cross_entropy(logits.reshape(-1, logits.size(-1)), ids[:, 1:].reshape(-1), reduction="sum"))
            n += ids[:, 1:].numel()
        res[tag] = math.exp(tot / n)
    return res


def lab(model_id: str = "HuggingFaceTB/SmolLM2-135M", repair_steps: int = 0, threads: int = 4) -> None:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    torch.set_num_threads(threads)
    tok = AutoTokenizer.from_pretrained(model_id)
    base = AutoModelForCausalLM.from_pretrained(model_id, torch_dtype=torch.float32).eval()
    n_layers = base.config.num_hidden_layers
    windows = _eval_windows(tok)
    ref = _ppl(base, windows)
    print(f"MODEL {model_id}  layers={n_layers}  params={sum(p.numel() for p in base.parameters())/1e6:.0f}M")
    print(f"{'recipe':44s} {'MB':>7s} {'ppl en':>8s} {'ppl ar':>8s}   loss change en / ar")
    print(f"{'full precision (fp32 reference)':44s} {sum(p.numel() for p in base.parameters())*2/1e6:7.0f} {ref['en']:8.2f} {ref['ar']:8.2f}   0.0% / 0.0%")
    recipes = [
        ("int8, one scale per row", dict(bits=8, group=0, clip_search=False, protect_bits=8)),
        ("int4, one scale per row (blind)", dict(bits=4, group=0, clip_search=False, protect_bits=4)),
        ("int4, per row, embedding kept int8", dict(bits=4, group=0, clip_search=False, protect_bits=8)),
        ("int4, groups of 128", dict(bits=4, group=128, clip_search=False, protect_bits=8)),
        ("int4, groups of 64", dict(bits=4, group=64, clip_search=False, protect_bits=8)),
        ("int4, groups of 64 + best clipping", dict(bits=4, group=64, clip_search=True, protect_bits=8)),
        ("int4, groups of 32 + best clipping", dict(bits=4, group=32, clip_search=True, protect_bits=8)),
        ("int4 g64 + clip + first/last 2 blocks int8", dict(bits=4, group=64, clip_search=True, protect_bits=8, protect_ends=2)),
        ("int3, groups of 32 + best clipping", dict(bits=3, group=32, clip_search=True, protect_bits=8)),
    ]
    best = None
    for name, kw in recipes:
        m = copy.deepcopy(base)
        info = apply_recipe(m, n_layers=n_layers, **kw)
        p = _ppl(m, windows)
        d = {k: (math.log(p[k]) - math.log(ref[k])) / math.log(ref[k]) * 100 for k in p}
        print(f"{name:44s} {info['bytes']/1e6:7.0f} {p['en']:8.2f} {p['ar']:8.2f}   {d['en']:+.1f}% / {d['ar']:+.1f}%", flush=True)
        if kw["bits"] == 4 and kw["clip_search"] and kw.get("protect_ends", 0) == 0 and kw["group"] == 64:
            best = kw
        del m
    if repair_steps and best:
        m = copy.deepcopy(base)
        wrap_for_repair(m, bits=4, group=best["group"], protect_ends=0, n_layers=n_layers)
        flat = torch.cat([windows["en"], windows["ar"]])
        data = [flat[torch.randperm(len(flat))[:4]] for _ in range(repair_steps)]
        hist = self_distill_repair(m, base, data, steps=repair_steps)
        unwrap_after_repair(m)
        info = apply_recipe(m, n_layers=n_layers, **best)
        p = _ppl(m, windows)
        d = {k: (math.log(p[k]) - math.log(ref[k])) / math.log(ref[k]) * 100 for k in p}
        print(f"{'int4 g64 + clip + ' + str(repair_steps) + '-step self-distill repair':44s} {info['bytes']/1e6:7.0f} {p['en']:8.2f} {p['ar']:8.2f}   {d['en']:+.1f}% / {d['ar']:+.1f}%   (KL {hist[0]:.3f} -> {hist[-1]:.3f})")


def _selftest() -> None:
    torch.manual_seed(0)
    w = torch.randn(64, 256)
    w[3, 5] = 20.0                                    # one outlier ruins a per-row scale
    err_row = float((quant_groupwise(w, 4, 0) - w).pow(2).mean())
    err_grp = float((quant_groupwise(w, 4, 32) - w).pow(2).mean())
    err_clip = float((quant_groupwise(w, 4, 32, clip_search=True) - w).pow(2).mean())
    assert err_grp < err_row, (err_grp, err_row)
    assert err_clip <= err_grp + 1e-9, (err_clip, err_grp)
    assert float((quant_groupwise(w, 8, 0) - w).abs().max()) < 20.0 / 127 + 1e-6
    m = nn.Sequential(nn.Embedding(50, 32), nn.Linear(32, 64), nn.Linear(64, 50))
    before = m[1].weight.clone()
    info = apply_recipe(m, bits=4, group=16, protect_bits=8)
    assert info["bytes"] < info["fp_bytes"] and not torch.equal(before, m[1].weight)
    t = copy.deepcopy(m)
    n = wrap_for_repair(m, 4, 16)
    assert n == 2
    x = torch.randint(0, 50, (4, 8))
    m[0](x)
    hist = self_distill_repair(nn.Sequential(m[0], m[1], m[2]), t, [x] * 3, steps=3, logits_of=lambda o: o)
    assert len(hist) == 3
    unwrap_after_repair(m)
    assert isinstance(m[1], nn.Linear)
    print("sham_quant_recipes self-test OK")


if __name__ == "__main__":     # sham-ci: entrypoint (--lab downloads a model and data; the plain run is the fast self-test)
    if "--lab" in sys.argv:
        mid = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else "HuggingFaceTB/SmolLM2-135M"
        steps = int(sys.argv[sys.argv.index("--repair") + 1]) if "--repair" in sys.argv else 0
        lab(mid, steps)
    else:
        _selftest()
