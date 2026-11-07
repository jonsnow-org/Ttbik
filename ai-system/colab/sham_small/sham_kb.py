"""
Sham — a compressed offline knowledge base ("مكتبة شام المضغوطة"): knowledge that lives OUTSIDE the weights.

Why: a 515M model holds only a few hundred megabytes of facts in its weights (about 2 bits of knowledge per weight, from the literature). Retrieval-augmented
small models are reported to match models many times larger on fact lookup (RETRO, Atlas, RA-DIT), because the facts come from a library instead of from the
weights. This module is the library: no neural model, no teacher, no outside service —

  - the text is cut into chunks of about 600 characters and each chunk is stored zlib-compressed (random access, ~3x smaller than plain text);
  - an inverted index (BM25, the classic ranking function) is built in numpy;
  - `search(query, k)` returns the best chunks in milliseconds on one CPU core.

It is used two ways: (1) at answer time, to give Sham the evidence before it answers (sham_rag_data.py teaches it to READ evidence — a small model must be
trained for that, otherwise it ignores what it is given); (2) at training time, to put the nearest other documents in front of every training window, so the
model learns to use a library instead of memorising it.

The tokenizer is pluggable (default: lower-cased words with Arabic diacritics / tatweel removed and alef/ya/ta-marbuta variants unified), so the same code
indexes Arabic, English or token-id "documents".
"""
from __future__ import annotations

import json
import math
import re
import sys
import zlib
from collections import Counter, defaultdict
from pathlib import Path
from typing import Callable, Iterable

import numpy as np

_AR_DIACRITICS = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_WORD = re.compile(r"[\w]+", re.UNICODE)
_AR_MAP = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي"})
STOP = frozenset("""في من على الى إلى عن مع هذا هذه ذلك التي الذي هو هي ان أن كان كانت ما لا و او أو ثم قد the of and to in a is that for it as with was on be by this are at from or an""".split())


def default_tokenize(text: str) -> list[str]:
    text = _AR_DIACRITICS.sub("", text.lower()).translate(_AR_MAP)
    return [w for w in _WORD.findall(text) if w not in STOP and len(w) > 1]


def chunk_text(text: str, size: int = 600, overlap: int = 80) -> list[str]:
    """Cut on sentence-ish boundaries so a chunk is a readable passage."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= size:
        return [text] if text else []
    out, i = [], 0
    while i < len(text):
        j = min(len(text), i + size)
        if j < len(text):
            cut = max(text.rfind(". ", i, j), text.rfind("؟ ", i, j), text.rfind("، ", i, j), text.rfind(" ", i + size // 2, j))
            j = cut + 1 if cut > i + size // 3 else j
        out.append(text[i:j].strip())
        if j >= len(text):
            break
        i = max(j - overlap, i + 1)
    return [c for c in out if c]


class KnowledgeBase:
    def __init__(self, tokenize: Callable[[str], list] = default_tokenize, k1: float = 1.2, b: float = 0.75):
        self.tokenize, self.k1, self.b = tokenize, k1, b
        self._blobs: list[bytes] = []          # zlib-compressed chunk texts
        self._docs: list[int] = []             # source document id of each chunk
        self._len: list[int] = []              # tokens per chunk
        self._post: dict[str, list[tuple[int, int]]] = defaultdict(list)
        self._frozen: dict[str, tuple[np.ndarray, np.ndarray]] | None = None

    def __len__(self) -> int:
        return len(self._blobs)

    def add_document(self, doc_id: int, text: str, chunk_size: int = 600) -> int:
        n = 0
        for piece in chunk_text(text, chunk_size):
            toks = self.tokenize(piece)
            if not toks:
                continue
            cid = len(self._blobs)
            self._blobs.append(zlib.compress(piece.encode("utf-8"), 9))
            self._docs.append(doc_id)
            self._len.append(len(toks))
            for term, tf in Counter(toks).items():
                self._post[term].append((cid, tf))
            n += 1
        self._frozen = None
        return n

    def build(self, texts: Iterable[str], chunk_size: int = 600) -> "KnowledgeBase":
        for i, t in enumerate(texts):
            self.add_document(i, t, chunk_size)
        return self

    def _freeze(self) -> dict:
        if self._frozen is None:
            self._frozen = {t: (np.fromiter((c for c, _ in p), dtype=np.int32, count=len(p)), np.fromiter((f for _, f in p), dtype=np.float32, count=len(p)))
                            for t, p in self._post.items()}
            self._avg = float(np.mean(self._len)) if self._len else 1.0
            self._lenarr = np.asarray(self._len, dtype=np.float32)
        return self._frozen

    def text(self, cid: int) -> str:
        return zlib.decompress(self._blobs[cid]).decode("utf-8")

    def search(self, query: str, k: int = 3, exclude_docs: set[int] | None = None) -> list[tuple[float, int, str]]:
        """-> [(score, chunk_id, text)], best first. `exclude_docs`: never return chunks of these source documents (training: not the window's own document)."""
        post = self._freeze()
        n = len(self._blobs)
        if n == 0:
            return []
        scores = np.zeros(n, dtype=np.float32)
        for term in set(self.tokenize(query)):
            hit = post.get(term)
            if hit is None:
                continue
            ids, tf = hit
            idf = math.log(1 + (n - len(ids) + 0.5) / (len(ids) + 0.5))
            norm = self.k1 * (1 - self.b + self.b * self._lenarr[ids] / self._avg)
            scores[ids] += idf * tf * (self.k1 + 1) / (tf + norm)
        if exclude_docs:
            for cid in np.nonzero(scores)[0]:
                if self._docs[cid] in exclude_docs:
                    scores[cid] = 0.0
        top = np.argpartition(-scores, min(k, n - 1))[:k]
        top = top[np.argsort(-scores[top])]
        return [(float(scores[c]), int(c), self.text(int(c))) for c in top if scores[c] > 0]

    # -- storage: one JSON header + the compressed chunks; the index is rebuilt on load (fast) so the file stays small
    def save(self, path: str | Path) -> int:
        path = Path(path)
        with open(path, "wb") as f:
            head = json.dumps({"docs": self._docs, "len": self._len, "sizes": [len(b) for b in self._blobs]}).encode()
            f.write(len(head).to_bytes(8, "little") + head)
            for b in self._blobs:
                f.write(b)
        return path.stat().st_size

    @classmethod
    def load(cls, path: str | Path, tokenize: Callable[[str], list] = default_tokenize) -> "KnowledgeBase":
        raw = Path(path).read_bytes()
        n = int.from_bytes(raw[:8], "little")
        head = json.loads(raw[8:8 + n])
        kb = cls(tokenize)
        pos = 8 + n
        for size in head["sizes"]:
            kb._blobs.append(raw[pos:pos + size])
            pos += size
        kb._docs, kb._len = head["docs"], head["len"]
        for cid, blob in enumerate(kb._blobs):
            for term, tf in Counter(tokenize(zlib.decompress(blob).decode("utf-8"))).items():
                kb._post[term].append((cid, tf))
        return kb

    def stats(self) -> dict:
        plain = sum(len(self.text(i).encode("utf-8")) for i in range(len(self)))
        comp = sum(len(b) for b in self._blobs)
        return {"chunks": len(self), "plain_bytes": plain, "compressed_bytes": comp, "ratio": plain / max(1, comp)}


def _selftest() -> None:
    docs = [
        "عاصمة فرنسا هي باريس وتقع على نهر السين، وهي أكبر مدينة في البلاد. " * 3,
        "The capital of Japan is Tokyo, a very large city with many millions of people. " * 3,
        "الشمس نجم في مركز المجموعة الشمسية وتدور حولها الأرض كل سنة. " * 3,
        "Python is a programming language created by Guido van Rossum in 1991. " * 3,
    ]
    kb = KnowledgeBase().build(docs)
    assert len(kb) >= 4
    assert "باريس" in kb.search("ما هي عاصمة فرنسا؟", 1)[0][2]
    assert "Tokyo" in kb.search("capital of Japan", 1)[0][2]
    assert "Guido" in kb.search("who created Python language", 1)[0][2]
    assert not kb.search("zzzz qqqq", 3)
    # the training use: never return the window's own document
    own = kb.search("capital of Japan", 3, exclude_docs={1})
    assert all("Tokyo" not in t for _, _, t in own)
    st = kb.stats()
    assert st["ratio"] > 2.0, st
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        size = kb.save(Path(d) / "kb.bin")
        again = KnowledgeBase.load(Path(d) / "kb.bin")
        assert size < st["plain_bytes"] and again.search("capital of Japan", 1)[0][2] == kb.search("capital of Japan", 1)[0][2]
    print("sham_kb self-test OK  (compression x%.1f)" % st["ratio"])


if __name__ == "__main__":
    _selftest()
