"""
Sham — pack lab: at the SAME size in megabytes, how many new facts can each kind of add-on file give a frozen core? (CPU, real small model.)

Core: a real pretrained decoder (SmolLM2-135M), FROZEN. New facts it cannot know: "<Name>'s lucky word is" -> one of 1000 words (random pairs; N facts).
Packs, each measured in the bytes of the file it would ship as (fp16 weights; zlib text):
  lora      low-rank adapters on every block's down projection        (trained, core frozen)
  memory    one sparse product-key memory after the middle block      (trained, core frozen)
  library   the facts as text + BM25 index, top-3 pasted before the question; NOTHING is trained (the frozen core just reads)
Reported: top-1 accuracy on the N facts, the pack size, and (for trained packs) how much the core's general text perplexity moved with the pack attached.

    python sham_pack_lab.py [n_facts=3000] [steps=600] [model_id]
"""
from __future__ import annotations

import copy
import math
import random
import sys
import time

import torch
import torch.nn.functional as F

from sham_kb import KnowledgeBase
from sham_packs import MemoryPack, attach_lora, attach_memory_pack, core_fingerprint, save_weight_pack
from sham_quant_recipes import _ppl

SYL = ["ka", "ro", "mi", "ta", "zu", "ve", "lo", "sha", "ne", "qu", "ba", "di", "fo", "gri", "hu", "jal", "wen", "xo", "yar", "pel"]


def _facts(tok, n: int, seed: int = 0):
    rnd = random.Random(seed)
    words = []
    for t, i in tok.get_vocab().items():
        if t.startswith("Ġ") and t[1:].isalpha() and t[1:].isascii() and 4 <= len(t[1:]) <= 8 and t[1:].islower():
            words.append((t[1:], i))
    rnd.shuffle(words)
    words = words[:1000]
    names: set[str] = set()
    while len(names) < n:
        names.add("".join(rnd.choice(SYL) for _ in range(rnd.choice((3, 4)))).capitalize())
    names = sorted(names)
    rnd.shuffle(names)
    return [(nm, *rnd.choice(words)) for nm in names]          # (name, word, token id of " word")


def _prompt(name: str) -> str:
    return f"{name}'s lucky word is"


@torch.no_grad()
def _accuracy(model, tok, facts, ctx=None, batch=32) -> float:
    model.eval()
    ok = 0
    for i in range(0, len(facts), batch):
        chunk = facts[i:i + batch]
        texts = [(ctx(f[0]) if ctx else "") + _prompt(f[0]) for f in chunk]
        enc = tok(texts, return_tensors="pt", padding=True, padding_side="left")
        logits = model(**enc).logits[:, -1]
        ok += int((logits.argmax(-1) == torch.tensor([f[2] for f in chunk])).sum())
    return ok / len(facts) * 100


def _train(model, params, tok, facts, steps, lr, batch=64):
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=0.0)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / 20) * (0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * s / max(1, steps)))))
    model.train()
    t0 = time.time()
    for s in range(steps):
        chunk = random.sample(facts, batch)
        enc = tok([_prompt(f[0]) for f in chunk], return_tensors="pt", padding=True, padding_side="left")
        logits = model(**enc).logits[:, -1].float()
        loss = F.cross_entropy(logits, torch.tensor([f[2] for f in chunk]))
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        opt.step()
        sched.step()
        if s % 100 == 0:
            print(f"      step {s:4d}/{steps} loss {float(loss):.3f}  ({time.time() - t0:.0f}s)", flush=True)
    model.eval()


def run(n_facts: int = 3000, steps: int = 600, model_id: str = "HuggingFaceTB/SmolLM2-135M", threads: int = 4) -> None:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    torch.set_num_threads(threads)
    random.seed(0)
    torch.manual_seed(0)
    tok = AutoTokenizer.from_pretrained(model_id)
    tok.pad_token = tok.pad_token or tok.eos_token
    core = AutoModelForCausalLM.from_pretrained(model_id, torch_dtype=torch.float32).eval()
    for p in core.parameters():
        p.requires_grad_(False)
    cfg = core.config
    L, d = cfg.num_hidden_layers, cfg.hidden_size
    fp = core_fingerprint(core, d, L)
    facts = _facts(tok, n_facts)
    info_kb = n_facts * math.log2(1000) / 8 / 1024
    print(f"CORE {model_id} frozen ({sum(p.numel() for p in core.parameters()) / 1e6:.0f}M) | {n_facts} new facts = {info_kb:.1f} kB of pure information | {steps} steps, batch 64")

    print(f"{'pack':44s} {'size':>9s} {'facts correct':>14s}")
    print(f"{'none (the core alone)':44s} {'0':>9s} {_accuracy(core, tok, facts[:500]):13.1f}%   (chance 0.1%)", flush=True)

    # library pack: facts as sentences, BM25, top-3 in front of the question; the core is not trained
    lines = [f"{nm}'s lucky word is {w}." for nm, w, _ in facts]
    kb = KnowledgeBase(tokenize=lambda t: [x.lower() for x in t.replace("'s", " ").replace(".", " ").split()]).build(lines, chunk_size=100000)
    import tempfile
    from pathlib import Path
    kbf = Path(tempfile.mkdtemp()) / "k.kb"
    kb_bytes = kb.save(kbf)
    for k in (1, 3):
        def ctx(name, k=k):
            return " ".join(t for _, _, t in kb.search(name, k)) + "\n"
        print(f"{'library pack, top-' + str(k) + ' read by the frozen core':44s} {kb_bytes / 1e6:7.2f}MB {_accuracy(core, tok, facts[:500], ctx):13.1f}%   (no training)", flush=True)

    held_general = None
    try:
        from sham_quant_recipes import _eval_windows
        held_general = _eval_windows(tok, n_each=12, seq=256)
        ref = _ppl(core, held_general)
    except Exception as e:      # no internet: skip the side-effect check
        print("  (general-text check skipped:", type(e).__name__, ")")

    def side_effect(model):
        if held_general is None:
            return ""
        p = _ppl(model, held_general)
        return f"   core text ppl en {ref['en']:.2f}->{p['en']:.2f}  ar {ref['ar']:.2f}->{p['ar']:.2f}"

    # trained packs at two sizes
    for label, mem_keys, rank in (("~1.2 MB", 32, 9), ("~4.7 MB", 64, 36)):
        # memory pack
        m = copy.deepcopy(core)
        pack = MemoryPack(d, n_keys=mem_keys, topk=4, heads=2, key_dim=32)
        h = attach_memory_pack(m.model.layers[L // 2], pack)
        print(f"  training memory pack {label} ({mem_keys}x{mem_keys}={mem_keys ** 2} slots)", flush=True)
        _train(m, list(pack.parameters()), tok, facts, steps, lr=3e-3)
        import tempfile as _t
        td = _t.mkdtemp()
        size = save_weight_pack(td, "mem", "memory", {"mem": pack}, fp)
        print(f"{'memory pack ' + label + f' ({mem_keys ** 2} slots)':44s} {size / 1e6:7.2f}MB {_accuracy(m, tok, facts):13.1f}%{side_effect(m)}", flush=True)
        h.remove()
        del m, pack
        # lora pack
        m = copy.deepcopy(core)
        names = attach_lora(m, r"mlp\.down_proj$", rank=rank)
        lp = [p for n, p in m.named_parameters() if n.endswith(".down") or n.endswith(".up")]
        for p in lp:
            p.requires_grad_(True)
        print(f"  training lora pack {label} (rank {rank} on {len(names)} layers)", flush=True)
        _train(m, lp, tok, facts, steps, lr=2e-3)
        mods = {n: dict(m.named_modules())[n] for n in names}
        td = _t.mkdtemp()
        size = save_weight_pack(td, "lora", "lora", {k: (v) for k, v in mods.items()}, fp)
        print(f"{'lora pack ' + label + f' (rank {rank})':44s} {size / 1e6:7.2f}MB {_accuracy(m, tok, facts):13.1f}%{side_effect(m)}", flush=True)
        del m


if __name__ == "__main__":     # sham-ci: entrypoint (an hour of CPU + internet: run on purpose)
    run(int(sys.argv[1]) if len(sys.argv) > 1 else 3000, int(sys.argv[2]) if len(sys.argv) > 2 else 600, sys.argv[3] if len(sys.argv) > 3 else "HuggingFaceTB/SmolLM2-135M")
