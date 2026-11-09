"""
Sham's CENTRAL KNOWLEDGE BANK ("مخزن شام المركزي"): everything the crawlers and notebooks collected, kept once, compressed, indexed, and searchable by both Shams and Nova.

It is built from the parts Sham already has, in the lean form a free Studio can hold:
  - text handling and chunking of sham_kb (the compressed offline library: ~700-character passages, zlib per passage, random access);
  - a BM25 index in numpy CSR arrays (terms are hashed into 2^23 buckets, so there is no vocabulary dictionary in memory; the arrays are memory-mapped, the RAM cost is small);
  - the small learned encoder (sham_encoder_np.py, the one measured in sham_knowledge_encoder.py) with one 64-number vector stored per passage, so near-word matches
    (another form of an Arabic word, a typo) are found over EVERY passage with one matrix product. The two scores are fused 80% BM25 / 20% encoder, the setting that was measured.

Files of a bank folder (all plain files, so it can live in a ModelScope model repo and be hot-loaded by the Studio):
    bank_manifest.json   sha, counts, sources, build time      chunks.bin / chunks.off   zlib passages + byte offsets
    post_doc.npy / post_tf.npy / term_off.npy   the BM25 postings (CSR)      doclen.npy   tokens per passage      src.npy   source index per passage
    emb.npy              float16 vectors from the encoder      encoder.json   the encoder table (int8)   sources.json   names

    python sham_bank.py                    # self-test (synthetic corpus: build, save, load, search, fused search, dedupe)
    python sham_bank.py --bench FILE.json  # build from {lang,title,text} articles, then measure time, size and recall against plain BM25
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import sys
import time
import zlib
from array import array
from collections import Counter
from pathlib import Path
from typing import Iterable

import numpy as np

import sham_kb
from sham_encoder_np import Encoder, fnv1a

BUCKETS = 1 << 23
FORMAT = 1
CHUNK = 700
FUSE_WEIGHT = 0.2
MIN_COS_ALONE = 0.6        # measured 2026-11-09 on 3000 Wikipedia articles: top cosine of real 10-word queries median 0.61 (p10 0.52), of gibberish median 0.48 (max 0.67): the encoder alone cannot reject nonsense, so an encoder-only answer is shown only when clearly close, and is marked approximate


def _bucket(term: str) -> int:
    return fnv1a("t:" + term) & (BUCKETS - 1)


def _norm_key(text: str) -> int:
    t = re.sub(r"\W+", " ", sham_kb._AR_DIACRITICS.sub("", text.lower())).strip()[:300]
    return int.from_bytes(hashlib.blake2b(t.encode("utf-8"), digest_size=8).digest(), "little")


def _useful(text: str) -> bool:
    """Drop what is not prose: too short, or mostly digits / symbols (tables, logs, ids)."""
    if len(text) < 200:
        return False
    letters = sum(1 for c in text if c.isalpha())
    return letters / len(text) >= 0.55


def build(docs: Iterable[tuple[str, str]], out_dir: str | Path, encoder_json: str | Path | None = None, chunk_size: int = CHUNK, max_chunks: int | None = None,
          log=print) -> dict:
    """docs: (source_name, text) pairs. Writes the bank folder; returns its manifest."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    seen: set[int] = set()
    sources: dict[str, int] = {}
    blobs: list[bytes] = []
    src_idx = array("H")
    doclen = array("H")
    term_b, term_c, term_tf = array("I"), array("I"), array("B")
    texts_for_emb: list[str] = []
    n_docs = dup = dropped = 0
    for source, text in docs:
        n_docs += 1
        if not _useful(text):
            dropped += 1
            continue
        key = _norm_key(text)
        if key in seen:
            dup += 1
            continue
        seen.add(key)
        sid = sources.setdefault(source, len(sources))
        for piece in sham_kb.chunk_text(text, chunk_size):
            toks = sham_kb.default_tokenize(piece)
            if len(toks) < 4:
                continue
            cid = len(blobs)
            blobs.append(zlib.compress(piece.encode("utf-8"), 9))
            src_idx.append(sid)
            doclen.append(min(len(toks), 65535))
            for term, tf in Counter(toks).items():
                term_b.append(_bucket(term))
                term_c.append(cid)
                term_tf.append(min(tf, 255))
            texts_for_emb.append(piece)
            if max_chunks and len(blobs) >= max_chunks:
                break
        if max_chunks and len(blobs) >= max_chunks:
            break
        if n_docs % 20000 == 0:
            log(f"  {n_docs:,} documents read, {len(blobs):,} passages, {time.time() - t0:.0f}s")
    n = len(blobs)
    log(f"passages {n:,} from {n_docs:,} documents ({dup:,} duplicates, {dropped:,} not prose) in {time.time() - t0:.0f}s; indexing")
    b = np.frombuffer(term_b, dtype=np.uint32)
    order = np.argsort(b, kind="stable")                       # postings of one bucket stay in passage order
    post_doc = np.frombuffer(term_c, dtype=np.uint32)[order].astype(np.int32)
    post_tf = np.frombuffer(term_tf, dtype=np.uint8)[order].copy()
    counts = np.bincount(b, minlength=BUCKETS)
    term_off = np.zeros(BUCKETS + 1, dtype=np.int64)
    np.cumsum(counts, out=term_off[1:])
    del order, b
    np.save(out / "post_doc.npy", post_doc)
    np.save(out / "post_tf.npy", post_tf)
    np.save(out / "term_off.npy", term_off.astype(np.int32) if term_off[-1] < 2**31 else term_off)
    np.save(out / "doclen.npy", np.frombuffer(doclen, dtype=np.uint16))
    np.save(out / "src.npy", np.frombuffer(src_idx, dtype=np.uint16))
    off = np.zeros(n + 1, dtype=np.int64)
    np.cumsum([len(x) for x in blobs], out=off[1:])
    (out / "chunks.bin").write_bytes(b"".join(blobs))
    np.save(out / "chunks.off.npy", off)
    (out / "sources.json").write_text(json.dumps(list(sources), ensure_ascii=False), encoding="utf-8")
    has_enc = False
    if encoder_json and Path(encoder_json).exists():
        enc = Encoder.load(encoder_json)
        emb = np.zeros((n, enc.dim), dtype=np.float16)
        for i in range(0, n, 2048):
            emb[i:i + 2048] = enc.embed(texts_for_emb[i:i + 2048]).astype(np.float16)
        np.save(out / "emb.npy", emb)
        shutil.copy2(encoder_json, out / "encoder.json")
        has_enc = True
        log(f"encoder vectors for {n:,} passages in {time.time() - t0:.0f}s")
    h = hashlib.sha256()
    for name in ("chunks.bin", "post_doc.npy", "doclen.npy", "src.npy"):
        h.update((out / name).read_bytes())
    manifest = {"format": FORMAT, "sha": h.hexdigest(), "passages": n, "documents": n_docs - dup - dropped, "duplicates": dup, "not_prose": dropped, "buckets": BUCKETS,
                "avg_len": float(np.mean(np.frombuffer(doclen, dtype=np.uint16))) if n else 1.0, "sources": list(sources), "encoder": has_enc,
                "built": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "bytes": sum(p.stat().st_size for p in out.iterdir() if p.is_file())}
    (out / "bank_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return manifest


class Bank:
    def __init__(self, path: str | Path):
        p = Path(path)
        self.path = p
        self.manifest = json.loads((p / "bank_manifest.json").read_text(encoding="utf-8"))
        self.post_doc = np.load(p / "post_doc.npy", mmap_mode="r")
        self.post_tf = np.load(p / "post_tf.npy", mmap_mode="r")
        self.term_off = np.load(p / "term_off.npy", mmap_mode="r")
        self.doclen = np.load(p / "doclen.npy").astype(np.float32)
        self.src = np.load(p / "src.npy")
        self.off = np.load(p / "chunks.off.npy")
        self.blob = np.memmap(p / "chunks.bin", dtype=np.uint8, mode="r")
        self.sources = json.loads((p / "sources.json").read_text(encoding="utf-8"))
        self.n = int(self.manifest["passages"])
        self.avg = float(self.manifest.get("avg_len") or 1.0)
        self.emb = np.load(p / "emb.npy", mmap_mode="r") if (p / "emb.npy").exists() else None
        self.enc = Encoder.load(p / "encoder.json") if self.emb is not None and (p / "encoder.json").exists() else None

    def __len__(self) -> int:
        return self.n

    def text(self, cid: int) -> str:
        return zlib.decompress(bytes(self.blob[self.off[cid]:self.off[cid + 1]])).decode("utf-8")

    def bm25(self, query: str) -> np.ndarray:
        scores = np.zeros(self.n, dtype=np.float32)
        norm = 1.2 * (0.25 + 0.75 * self.doclen / self.avg)
        for term in set(sham_kb.default_tokenize(query)):
            bk = _bucket(term)
            a, b = int(self.term_off[bk]), int(self.term_off[bk + 1])
            if b <= a:
                continue
            ids = np.asarray(self.post_doc[a:b])
            tf = np.asarray(self.post_tf[a:b]).astype(np.float32)
            df = len(np.unique(ids))
            idf = math.log(1 + (self.n - df + 0.5) / (df + 0.5))
            np.add.at(scores, ids, idf * tf * 2.2 / (tf + norm[ids]))
        return scores

    def search(self, query: str, k: int = 4, fuse: bool = True) -> list[dict]:
        bm = self.bm25(query)
        score = bm
        if fuse and self.enc is not None and self.emb is not None:
            q = self.enc.embed([query])[0]
            cos = np.asarray(self.emb, dtype=np.float32) @ q if self.n <= 400_000 else np.asarray(self.emb[:], dtype=np.float32) @ q
            a = bm / bm.max() if bm.max() > 0 else bm
            e = cos - cos.min()
            e = e / e.max() if e.max() > 0 else e
            if bm.max() > 0:
                score = (1 - FUSE_WEIGHT) * a + FUSE_WEIGHT * e
            else:                                                  # no word in common at all: only the encoder can find it, and only when it is clearly close
                score = np.where(cos >= MIN_COS_ALONE, cos, 0.0).astype(np.float32)
        k = max(1, min(k, self.n))
        top = np.argpartition(-score, k - 1)[:k]
        top = top[np.argsort(-score[top])]
        approx = bool(fuse and self.enc is not None and bm.max() <= 0)
        return [{"id": int(c), "score": float(score[c]), "source": self.sources[int(self.src[c])], "text": self.text(int(c)), "approx": approx} for c in top if score[c] > 0]

    def stats(self) -> dict:
        return {k: self.manifest[k] for k in ("sha", "passages", "documents", "built", "bytes", "encoder")}


def _selftest() -> None:
    import tempfile
    base = [
        "عاصمة فرنسا هي باريس وتقع على نهر السين، وهي أكبر مدينة في البلاد وفيها متاحف كثيرة. ",
        "The capital of Japan is Tokyo, a very large city with many millions of people and trains. ",
        "الشمس نجم في مركز المجموعة الشمسية وتدور حولها الأرض كل سنة وحولها الكواكب الأخرى. ",
        "Python is a programming language created by Guido van Rossum in 1991 and used everywhere. ",
    ]
    docs = [("a", t * 4) for t in base] + [("b", base[0] * 4)] + [("c", "12345 67890 " * 60)] + [("c", "short")]
    enc = Path(__file__).resolve().parent / "data" / "knowledge_encoder.json"
    with tempfile.TemporaryDirectory() as td:
        m = build(docs, Path(td) / "bank", encoder_json=enc if enc.exists() else None, log=lambda *_: None)
        assert m["duplicates"] == 1 and m["not_prose"] == 2, m
        bank = Bank(Path(td) / "bank")
        assert len(bank) >= 4
        assert "باريس" in bank.search("ما هي عاصمة فرنسا؟", 1)[0]["text"]
        assert "Tokyo" in bank.search("capital of Japan", 1)[0]["text"]
        assert "Guido" in bank.search("who created the Python language", 1, fuse=False)[0]["text"]
        assert not bank.search("zzzz qqqq", 3, fuse=False)
        if bank.enc is not None:                                   # a word in another form still finds its passage (the encoder's job)
            hit = bank.search("ما هي المتاحف الكثيرة في المدينة الكبيرة على النهر", 1)      # most words are spelled differently from the text (with / without «ال»); the passage is still found
            assert hit and "متاحف" in hit[0]["text"], hit
        assert bank.stats()["passages"] == len(bank)
    print("sham_bank self-test OK (dedupe, not-prose filter, BM25 CSR search, fused search%s)" % (", encoder form-match" if enc.exists() else ""))


def _bench(path: str) -> None:
    import resource
    arts = json.load(open(path, encoding="utf-8"))
    import random
    rng = random.Random(3)
    rng.shuffle(arts)
    held, rest = arts[:200], arts[200:]
    enc = Path(__file__).resolve().parent / "data" / "knowledge_encoder.json"
    out = Path("/tmp/sham_bank_bench")
    shutil.rmtree(out, ignore_errors=True)
    t0 = time.time()
    m = build(((a["lang"], a["text"]) for a in rest + held), out, encoder_json=enc)
    print(f"build {time.time() - t0:.0f}s | {m['passages']:,} passages | {m['bytes'] / 1e6:.0f} MB on disk | peak RSS {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024:.0f} MB")
    t0 = time.time()
    bank = Bank(out)
    print(f"load {time.time() - t0:.2f}s")
    # recall: the title of a held-out article should bring back one of ITS passages
    tl = {a["title"]: a["text"][:200] for a in held}
    ok = {"bm25": 0, "fused": 0}
    lat = []
    for title, head in list(tl.items())[:150]:
        for name, fuse in (("bm25", False), ("fused", True)):
            t1 = time.time()
            res = bank.search(title, 5, fuse=fuse)
            lat.append(time.time() - t1)
            if any(head[:60].split(" ")[0] in r["text"] or title.split(" ")[0] in r["text"] for r in res):
                ok[name] += 1
    print(f"title -> own article in top 5 | bm25 {ok['bm25']}/150 | fused {ok['fused']}/150 | search {1000 * float(np.mean(lat)):.0f} ms avg")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--bench":
        _bench(sys.argv[2])
    else:
        _selftest()
