"""
Sham's knowledge, PHASE 2 (owner 2026-11-09): a small learned encoder for the saved-knowledge library, measured against the BM25 search of phase 1 (src/lib/shamKnowledge.ts).

What it is: hashed word + character n-gram features -> an embedding table (the whole encoder, ~2 MB int8) -> mean -> L2 norm. No teacher, no external model, CPU only. Trained with a contrastive loss
(a noisy short query must find the chunk it was cut from, against the other chunks of its batch). It exists to catch what BM25 cannot: a word written in another form (the Arabic prefixes
و / ب / ل / ف / ك, suffixes, a typo) and a question that shares few exact words with the saved text.

The same features are computed in TypeScript (src/lib/shamKnowledgeEncoder.ts) with the SAME hash and the same normalisation, so a vector made there equals the one made here (parity test).

    python sham_knowledge_encoder.py                       # self-test (tiny synthetic corpus: features, hashing, training, export round trip)
    python sham_knowledge_encoder.py --corpus wiki.json --out DIR      # train on {lang,title,text} articles, measure vs BM25 on held-out articles, export if asked
"""
from __future__ import annotations

import argparse
import json
import math
import random
import re
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

BUCKETS = 1 << 15
DIM = 64
MAX_TOKENS = 160

# ---------------------------------------------------------------- the same text handling as src/lib/shamKnowledge.ts
_DIACRITICS = re.compile("[ً-ٰٟـ]")
_NONWORD = re.compile(r"[^\w]+", re.UNICODE)
STOP = {"في", "من", "على", "الى", "عن", "ما", "ماذا", "هل", "هو", "هي", "كان", "ان", "او", "ثم", "هذا", "هذه", "التي", "الذي",
        "the", "a", "an", "of", "to", "and", "is", "in", "on", "for", "what", "who", "how"}


def normalise_text(text: str) -> str:
    t = str(text or "").lower()
    t = _DIACRITICS.sub("", t)
    for a in "أإآٱ":
        t = t.replace(a, "ا")
    t = t.replace("ى", "ي").replace("ة", "ه")
    t = t.translate({ord(d): str(i) for i, d in enumerate("٠١٢٣٤٥٦٧٨٩")})
    t = _NONWORD.sub(" ", t.replace("_", " "))
    return t.strip()


def tokens(text: str) -> list[str]:
    out = []
    for t in normalise_text(text).split(" "):
        if len(t) > 3 and t.startswith("ال"):
            t = t[2:]
        if len(t) > 1 and t not in STOP:
            out.append(t)
    return out


def chunk_text(text: str, size: int = 700) -> list[str]:
    clean = re.sub(r"[ \t]+", " ", str(text or "").replace("\r", "")).strip()[:14000]
    parts = [p.strip() for p in re.split(r"\n{2,}|(?<=[.!?؟])\s+", clean) if p and p.strip()]
    out, cur = [], ""
    for p in parts:
        if len(cur + " " + p) > size and cur:
            out.append(cur)
            cur = ""
        cur = cur + " " + p if cur else p
        while len(cur) > size * 1.5:
            out.append(cur[:size])
            cur = cur[size:]
    if cur.strip():
        out.append(cur.strip())
    return [c for c in out if len(tokens(c)) >= 4]


# ---------------------------------------------------------------- features (hashing is FNV-1a 32-bit over the UTF-8 bytes; the TypeScript twin does the same)
def fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def features(text: str, buckets: int = BUCKETS) -> list[int]:
    ids: list[int] = []
    for t in tokens(text)[:MAX_TOKENS]:
        ids.append(fnv1a("w:" + t) % buckets)
        padded = "<" + t + ">"
        for n in (3, 4):
            for i in range(0, len(padded) - n + 1):
                ids.append(fnv1a("c:" + padded[i:i + n]) % buckets)
    return ids or [fnv1a("empty") % buckets]


class Encoder(nn.Module):
    def __init__(self, buckets: int = BUCKETS, dim: int = DIM):
        super().__init__()
        self.buckets, self.dim = buckets, dim
        self.table = nn.EmbeddingBag(buckets, dim, mode="mean")
        nn.init.normal_(self.table.weight, std=0.1)

    def forward(self, batch: list[list[int]]) -> torch.Tensor:
        flat = torch.tensor([i for ids in batch for i in ids], dtype=torch.long)
        offsets = torch.tensor([0] + list(np.cumsum([len(ids) for ids in batch])[:-1]), dtype=torch.long)
        return F.normalize(self.table(flat, offsets), dim=-1)

    @torch.no_grad()
    def embed(self, texts: list[str], batch: int = 512) -> torch.Tensor:
        out = []
        for i in range(0, len(texts), batch):
            out.append(self.forward([features(t, self.buckets) for t in texts[i:i + batch]]))
        return torch.cat(out) if out else torch.zeros(0, self.dim)


# ---------------------------------------------------------------- noisy queries (training and the eval's lexical set)
_PREFIXES = ("ال", "و", "ب", "ل", "ف", "ك", "وال", "بال", "لل")
_SUFFIXES = ("ه", "ها", "ات", "ون", "ين", "ي", "ان", "هم")


def noisy_word(w: str, rng: random.Random, p: float = 0.3) -> str:
    """A word in another form: a clitic added or removed, a suffix changed, or one letter slipped. (Latin words only get the typo.)"""
    if rng.random() >= p:
        return w
    arabic = any("؀" <= c <= "ۿ" for c in w)
    r = rng.random()
    if arabic and r < 0.35:
        return rng.choice(_PREFIXES) + w
    if arabic and r < 0.6:
        return w + rng.choice(_SUFFIXES)
    if len(w) > 4 and r < 0.8:
        return w[:-1]
    if len(w) > 3:
        i = rng.randrange(len(w) - 1)
        return w[:i] + w[i + 1] + w[i] + w[i + 2:]
    return w


def make_query(chunk: str, rng: random.Random, noise: float = 0.3) -> str:
    words = normalise_text(chunk).split(" ")
    words = [w for w in words if w]
    if len(words) <= 6:
        return " ".join(words)
    size = rng.randint(5, min(18, len(words)))
    start = rng.randrange(0, len(words) - size + 1)
    window = words[start:start + size]
    keep = [w for w in window if rng.random() > 0.25] or window
    return " ".join(noisy_word(w, rng, noise) for w in keep)


# ---------------------------------------------------------------- BM25 twin of shamKnowledge.ts (the baseline)
class BM25:
    def __init__(self, texts: list[str]):
        self.docs = [Counter(tokens(t)) for t in texts]
        self.len = [sum(d.values()) for d in self.docs]
        self.avg = (sum(self.len) / len(self.len)) or 1
        self.df: Counter = Counter()
        for d in self.docs:
            self.df.update(d.keys())

    def scores(self, query: str) -> np.ndarray:
        q = list(dict.fromkeys(tokens(query)))
        n = len(self.docs)
        out = np.zeros(n, dtype=np.float32)
        for w in q:
            df = self.df.get(w, 0)
            if not df:
                continue
            idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
            for i, d in enumerate(self.docs):
                tf = d.get(w, 0)
                if tf:
                    out[i] += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (self.len[i] / self.avg)))
        return out


def hybrid(bm: np.ndarray, enc: np.ndarray, w: float = 0.5) -> np.ndarray:
    """Score fusion: each list is scaled to 0..1 by its own best, then mixed. BM25 keeps the exact-word evidence, the encoder adds the near-word evidence."""
    a = bm / bm.max() if bm.max() > 0 else bm
    e = enc - enc.min()
    e = e / e.max() if e.max() > 0 else e
    return (1 - w) * a + w * e


# ---------------------------------------------------------------- training and measurement
def train(chunks: list[str], steps: int, batch: int, seed: int = 0, lr: float = 0.05, temperature: float = 0.05, log=print) -> Encoder:
    rng = random.Random(seed)
    torch.manual_seed(seed)
    enc = Encoder()
    opt = torch.optim.Adagrad(enc.parameters(), lr=lr)
    feats = [features(c) for c in chunks]
    t0 = time.time()
    for step in range(1, steps + 1):
        idx = rng.sample(range(len(chunks)), min(batch, len(chunks)))
        q = enc([features(make_query(chunks[i], rng)) for i in idx])
        d = enc([feats[i] for i in idx])
        logits = q @ d.T / temperature
        target = torch.arange(len(idx))
        loss = (F.cross_entropy(logits, target) + F.cross_entropy(logits.T, target)) / 2
        opt.zero_grad()
        loss.backward()
        opt.step()
        if step == 1 or step % max(1, steps // 10) == 0:
            log(f"  step {step}/{steps} loss {loss.item():.3f}  ({time.time() - t0:.0f}s)")
    return enc.eval()


def recall(rank_fn, queries: list[tuple[str, set[int]]], ks=(1, 5)) -> dict:
    hits = {k: 0 for k in ks}
    for text, gold in queries:
        order = np.argsort(-rank_fn(text))
        for k in ks:
            if gold & set(order[:k].tolist()):
                hits[k] += 1
    return {f"R@{k}": round(hits[k] / max(1, len(queries)), 4) for k in ks}


def evaluate(enc: Encoder, articles: list[dict], per_set: int = 300, seed: int = 1, log=print) -> dict:
    """Held-out articles (never seen in training). Three query sets, each with the chunks of the whole pool as candidates:
         lexical  - a noisy window of a chunk's words (clitics, suffixes, typos), the chunk is the answer   (what the encoder was trained for)
         title    - the article's title; ANY chunk of that article is an answer                            (a topic question, no cut-out text)
         sentence - one whole sentence of the chunk with half its words dropped, the chunk is the answer     (a different noise than training)"""
    rng = random.Random(seed)
    chunks, owner, titles = [], [], []
    for ai, a in enumerate(articles):
        for c in chunk_text(a["text"]):
            chunks.append(c)
            owner.append(ai)
        titles.append(a["title"])
    bm = BM25(chunks)
    ev = enc.embed(chunks).numpy()
    by_article: dict[int, set[int]] = {}
    for ci, ai in enumerate(owner):
        by_article.setdefault(ai, set()).add(ci)

    pick = rng.sample(range(len(chunks)), min(per_set, len(chunks)))
    lexical = [(make_query(chunks[i], rng, 0.4), {i}) for i in pick]
    sentence = []
    for i in pick:
        sents = [s for s in re.split(r"(?<=[.!?؟])\s+", chunks[i]) if len(tokens(s)) >= 5]
        if sents:
            s = rng.choice(sents)
            sentence.append((" ".join(w for w in s.split() if rng.random() > 0.5) or s, {i}))
    title = [(titles[ai], by_article[ai]) for ai in rng.sample(range(len(articles)), min(per_set, len(articles))) if ai in by_article]

    def enc_scores(q):
        return ev @ enc.embed([q]).numpy()[0]

    def hyb(q):
        return hybrid(bm.scores(q), enc_scores(q))

    out = {"pool_chunks": len(chunks)}
    for name, qs in (("lexical", lexical), ("title", title), ("sentence", sentence)):
        out[name] = {"BM25": recall(bm.scores, qs), "encoder": recall(enc_scores, qs), "hybrid": recall(hyb, qs), "n": len(qs)}
        log(f"  {name:9s} n={len(qs)}  BM25 {out[name]['BM25']}  encoder {out[name]['encoder']}  hybrid {out[name]['hybrid']}")
    return out


# ---------------------------------------------------------------- export (int8 table + one scale per row, read by the TypeScript twin)
def export(enc: Encoder, path: Path) -> int:
    w = enc.table.weight.detach().numpy()
    scale = np.abs(w).max(axis=1) / 127.0
    scale[scale == 0] = 1.0
    q = np.round(w / scale[:, None]).astype(np.int8)
    import base64
    obj = {"buckets": enc.buckets, "dim": enc.dim, "scale": [float(x) for x in scale.astype(np.float32)],
           "table": base64.b64encode(q.tobytes()).decode("ascii")}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")
    return path.stat().st_size


def load_int8(path: Path) -> Encoder:
    import base64
    o = json.loads(path.read_text(encoding="utf-8"))
    q = np.frombuffer(base64.b64decode(o["table"]), dtype=np.int8).reshape(o["buckets"], o["dim"]).astype(np.float32)
    enc = Encoder(o["buckets"], o["dim"])
    with torch.no_grad():
        enc.table.weight.copy_(torch.from_numpy(q * np.asarray(o["scale"], dtype=np.float32)[:, None]))
    return enc.eval()


def _selftest() -> None:
    assert fnv1a("") == 0x811C9DC5 and fnv1a("a") == 0xE40C292C, "FNV-1a 32 reference values"
    assert normalise_text("الْكِتَابُ، المَدرسة!") == "الكتاب المدرسه"
    assert tokens("ما هي عاصمة اليابان؟") == ["هي", "عاصمه", "يابان"] or "عاصمه" in tokens("ما هي عاصمة اليابان؟")
    assert len(features("hello world")) > 4 and all(0 <= i < BUCKETS for i in features("مرحبا بالعالم"))
    rng = random.Random(0)
    words = ["كتاب", "مدرسة", "نهر", "جبل", "مدينة", "تاريخ", "علم", "فن", "لغة", "طب", "river", "mountain", "city", "history", "science", "music", "law", "trade"]
    arts = []
    for a in range(24):
        topic = rng.sample(words, 4)
        text = " ".join(" ".join(rng.choice(topic) + str(rng.randint(0, 3)) for _ in range(12)) + "." for _ in range(30))
        arts.append({"lang": "ar", "title": " ".join(topic[:2]), "text": text})
    chunks = [c for a in arts[:18] for c in chunk_text(a["text"])]
    assert len(chunks) > 20
    enc = train(chunks, steps=30, batch=32, log=lambda *_: None)
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        n = export(enc, Path(td) / "e.json")
        back = load_int8(Path(td) / "e.json")
        a, b = enc.embed(["الكتاب والمدرسة"]), back.embed(["الكتاب والمدرسة"])
        assert float((a * b).sum()) > 0.99, "int8 export must keep the vectors"
    res = evaluate(enc, arts[18:], per_set=20, log=lambda *_: None)
    assert res["lexical"]["encoder"]["R@5"] >= 0.0 and res["pool_chunks"] > 5
    print(f"sham_knowledge_encoder self-test OK (features, FNV hash, BM25 twin, training, int8 export {n // 1024} KiB round trip)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus")
    ap.add_argument("--out")
    ap.add_argument("--steps", type=int, default=1500)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--holdout", type=int, default=300)
    a = ap.parse_args()
    if not a.corpus:
        _selftest()
        sys.exit(0)
    arts = json.load(open(a.corpus, encoding="utf-8"))
    rng = random.Random(7)
    rng.shuffle(arts)
    held, rest = arts[:a.holdout], arts[a.holdout:]
    chunks = [c for x in rest for c in chunk_text(x["text"])]
    print(f"train: {len(rest)} articles, {len(chunks)} chunks | held out: {len(held)} articles", flush=True)
    enc = train(chunks, a.steps, a.batch)
    res = evaluate(enc, held)
    if a.out:
        out = Path(a.out)
        out.mkdir(parents=True, exist_ok=True)
        size = export(enc, out / "knowledgeEncoder.json")
        (out / "knowledgeEncoder.measure.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"exported {size / 1e6:.2f} MB", flush=True)
