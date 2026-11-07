"""
Sham — knowledge lab: do the two "knowledge outside the dense weights" ideas work with Sham's own transformer? (CPU, minutes, no data downloads.)

  A) CAPACITY  — random facts "(a, b) -> value" must be memorised. A dense model, the same dense model with a bigger MLP (same parameter count as the memory
                 model but more compute), and the dense model with sparse memory layers (more parameters, about the same compute) train for the same number of
                 steps. Accuracy = fraction of the facts recalled exactly.
  B) EVIDENCE  — a small library of "documents" (entity -> 4 attribute values). The model never trains on the TEST entities. Closed-book it cannot answer
                 about them; with the library's BM25 results (top-3, one gold, two distractors sharing half of the name) placed in the prompt it can, if it was
                 trained to read evidence. This is the use of sham_kb.py by a Sham-architecture model, end to end.

These are mechanism tests on toy tokens, not a benchmark of Sham's real knowledge. They answer "does the machinery work and what does it buy per parameter".

    python sham_knowledge_lab.py --a      python sham_knowledge_lab.py --b
"""
from __future__ import annotations

import random
import sys
import time

import torch
import torch.nn.functional as F

from model import ShamSmall, ShamSmallConfig
from sham_kb import KnowledgeBase
from sham_memory_layer import replace_mlp_with_memory


def _model(vocab: int, d: int = 128, layers: int = 4, mlp_mult: float = 2.75, seq: int = 64) -> ShamSmall:
    return ShamSmall(ShamSmallConfig(vocab_size=vocab, d_model=d, n_layers=layers, n_heads=4, n_kv_heads=2, mlp_hidden=int(d * mlp_mult), max_seq_len=seq))


def _active_params(model: ShamSmall, memory_layers: list[int], topk_slots: int = 0) -> int:
    """Parameters every token actually multiplies with (embedding excluded; a memory layer counts its query + the slots it reads)."""
    total = 0
    for i, layer in enumerate(model.layers):
        for name, p in layer.named_parameters():
            if name.startswith("mlp.values") or name.startswith("mlp.keys"):
                continue
            total += p.numel()
        if i in memory_layers:
            total += topk_slots * model.cfg.d_model
    return total


# ---------------------------------------------------------------- A) capacity

def experiment_a(n_facts: int = 40000, steps: int = 3000, seed: int = 0) -> None:
    torch.manual_seed(seed)
    rnd = random.Random(seed)
    V1, V2 = 300, 500
    vocab = V1 + V2 + 2
    SEP = V1 + V2
    pairs = rnd.sample([(a, b) for a in range(V1) for b in range(V1)], n_facts)
    vals = [V1 + rnd.randrange(V2) for _ in pairs]
    x = torch.tensor([[a, b, SEP] for a, b in pairs])
    y = torch.tensor(vals)
    print(f"A) {n_facts} random facts, value among {V2} ({n_facts * 9 / 8 / 1000:.0f} kB of information), {steps} steps of 512 facts\n")
    print(f"{'model':46s} {'params(non-emb)':>16s} {'active/token':>13s} {'recalled':>9s}")
    configs = [
        ("dense (d=128, 4 blocks)", dict(), []),
        ("dense, 3x wider MLP (more compute)", dict(mlp_mult=2.75 * 3), []),
        ("dense + memory in 2 blocks (64x64 slots each)", dict(), [1, 2]),
        ("dense + memory in 2 blocks (128x128 slots each)", dict(), [1, 2]),
    ]
    for idx, (name, kw, mem) in enumerate(configs):
        torch.manual_seed(seed)
        m = _model(vocab, **kw)
        if mem:
            nk = 128 if idx == 3 else 64
            replace_mlp_with_memory(m, mem, n_keys=nk, topk=4, heads=2, key_dim=32)
        non_emb = sum(p.numel() for n, p in m.named_parameters() if "token_embedding" not in n and "lm_head" not in n)
        act = _active_params(m, mem, topk_slots=2 * 4)
        opt = torch.optim.AdamW(m.parameters(), lr=3e-3, weight_decay=0.0)
        sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=steps, pct_start=0.05)
        t0 = time.time()
        for s in range(steps):
            sel = torch.randint(0, n_facts, (512,))
            logits, _ = m(x[sel])
            loss = F.cross_entropy(logits[:, -1], y[sel])
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
        with torch.no_grad():
            ok = 0
            for i in range(0, n_facts, 4096):
                ok += int((m(x[i:i + 4096])[0][:, -1].argmax(-1) == y[i:i + 4096]).sum())
        print(f"{name:46s} {non_emb:16,d} {act:13,d} {ok / n_facts * 100:8.1f}%   ({time.time() - t0:.0f}s)", flush=True)


# ---------------------------------------------------------------- B) evidence

def experiment_b(n_train: int = 3000, n_test: int = 1000, steps: int = 4000, seed: int = 0) -> None:
    torch.manual_seed(seed)
    rnd = random.Random(seed)
    NAMES, VALS = 60, 1000
    A0, V0 = NAMES * 2, NAMES * 2 + 4                 # attribute tags, then value ids
    SEP, QM, DOC = V0 + VALS, V0 + VALS + 1, V0 + VALS + 2
    vocab = DOC + 2
    combos = rnd.sample([(a, b) for a in range(NAMES) for b in range(NAMES, 2 * NAMES)], n_train + n_test)
    ents = [{"name": c, "vals": [V0 + rnd.randrange(VALS) for _ in range(4)]} for c in combos]
    train, test = ents[:n_train], ents[n_train:]

    def doc_ids(e):
        out = [DOC, *e["name"]]
        for k, v in enumerate(e["vals"]):
            out += [A0 + k, v]
        return out

    kb = KnowledgeBase(tokenize=lambda t: t.split()).build(" ".join(map(str, doc_ids(e))) for e in ents)
    doc_of_chunk = {}
    for cid in range(len(kb)):
        doc_of_chunk[cid] = kb._docs[cid]

    def retrieve(e, k=3):
        res = kb.search(f"{e['name'][0]} {e['name'][1]}", k)
        return [doc_of_chunk[c] for _, c, _ in res]

    def prompt(e, attr, mode):
        q = [QM, *e["name"], A0 + attr, SEP]
        if mode == "closed":
            return q
        if mode == "oracle":
            return doc_ids(e) + q
        docs = retrieve(e, 3)
        ctx = []
        for d in docs:
            ctx += doc_ids(ents[d])
        return ctx + q

    # retrieval quality
    hit1 = sum(1 for e in test if retrieve(e, 1) and ents[retrieve(e, 1)[0]] is e) / len(test)
    hit3 = sum(1 for e in test if any(ents[d] is e for d in retrieve(e, 3))) / len(test)
    print(f"B) library of {len(ents)} documents; BM25 recall@1 = {hit1 * 100:.1f}%  recall@3 = {hit3 * 100:.1f}%  (test entities are NEVER trained on)\n")

    m = _model(vocab, d=128, layers=4, seq=96)
    opt = torch.optim.AdamW(m.parameters(), lr=2e-3, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=steps, pct_start=0.05)
    t0 = time.time()
    for s in range(steps):
        batch, labels = [], []
        for _ in range(64):
            e = train[rnd.randrange(n_train)]
            attr = rnd.randrange(4)
            mode = "closed" if rnd.random() < 0.2 else "retrieved"
            p = prompt(e, attr, mode)
            batch.append(p)
            labels.append(e["vals"][attr])
        L = max(map(len, batch))
        x = torch.full((len(batch), L), DOC + 1, dtype=torch.long)
        last = []
        for i, p in enumerate(batch):
            x[i, L - len(p):] = torch.tensor(p)           # left-pad: the answer position is always the last one
        logits, _ = m(x)
        loss = F.cross_entropy(logits[:, -1], torch.tensor(labels))
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
    print(f"trained {steps} steps in {time.time() - t0:.0f}s\n")

    def accuracy(entities, mode):
        m.eval()
        ok = n = 0
        with torch.no_grad():
            for e in entities:
                for attr in range(4):
                    p = prompt(e, attr, mode)
                    x = torch.tensor([p])
                    ok += int(m(x)[0][0, -1].argmax().item() == e["vals"][attr])
                    n += 1
        return ok / n * 100

    print(f"{'question set':58s} {'correct':>8s}")
    print(f"{'train entities, closed book (memorised in weights)':58s} {accuracy(train[:400], 'closed'):7.1f}%")
    print(f"{'UNSEEN entities, closed book (no library)':58s} {accuracy(test[:400], 'closed'):7.1f}%   (chance = {100 / VALS:.1f}%)")
    print(f"{'UNSEEN entities, library top-3 (BM25, with distractors)':58s} {accuracy(test[:400], 'retrieved'):7.1f}%")
    print(f"{'UNSEEN entities, only the gold document':58s} {accuracy(test[:400], 'oracle'):7.1f}%")


if __name__ == "__main__":     # sham-ci: entrypoint (minutes of CPU: run on purpose with --a / --b)
    if "--a" in sys.argv:
        experiment_a(*(int(v) for v in sys.argv[sys.argv.index("--a") + 1:][:2]))
    elif "--b" in sys.argv:
        experiment_b()
    else:
        experiment_a(2000, 60)
        print("sham_knowledge_lab smoke OK (use --a / --b for the real runs)")
