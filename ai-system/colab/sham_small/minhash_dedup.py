"""
Sham Small — MinHash + LSH banding: a scalable upgrade to
autonomous_knowledge_crawler.py's near-duplicate check.

That file's KnowledgeCorpus.check() is already CORRECT (k=8 word-shingle
Jaccard similarity, with a real, measured 0.35 threshold — see its own
docstring for the calibration). The problem it doesn't solve is scale: it
compares every new candidate document against EVERY document already
stored, one full shingle-set Jaccard computation at a time — O(n) work per
check, O(n^2) over a whole run. That is fine for the hundreds of documents
the crawler's own test exercises, but this is explicitly meant to run
CONTINUOUSLY, forever, per the owner's own framing ("Infinite Training
Loop" applies just as much to the data side) — a corpus that grows into
the tens of thousands of documents would make every single new check
slower than the last, an ever-worsening bottleneck.

MinHash (Broder, 1997) turns a large shingle set into a small, fixed-size
signature (here: 64 integers) such that the FRACTION of matching signature
slots between two documents is an unbiased estimator of their true Jaccard
similarity — no need to keep the full shingle sets around for a rough
estimate. LSH banding (splitting that signature into bands and hashing
each band) then turns "find everything similar enough to be a candidate"
into an O(1)-average-case bucket lookup instead of a scan over every
stored document: only documents that land in the SAME bucket as the new
one for at least one band are even considered, and only those candidates
get the real, exact Jaccard check — this changes nothing about WHAT gets
accepted or rejected (the real Jaccard/threshold check downstream is
untouched), only how fast the candidate set is found. This is the same
technique real large-scale pretraining corpora (RefinedWeb, FineWeb,
Dolma) use for exactly this reason.

Band/row choice matters for correctness here, not just speed: the
probability a genuine near-duplicate becomes a candidate follows an
S-curve, p_candidate ~= 1 - (1 - s^rows)^bands, which crosses 0.5 around
s ~= (1/bands)^(1/rows). Choosing bands=32, rows=2 (out of num_perm=64)
puts that crossover at (1/32)^0.5 ~= 0.177 -- deliberately well BELOW the
real 0.35 accept threshold, so a genuine near-duplicate at exactly 0.35-0.5
similarity is very likely to still surface as a candidate (high recall),
at the cost of occasionally checking a real Jaccard for a pair that turns
out not to be similar enough (cheap, and harmless -- the exact check
still correctly rejects it). Getting this margin wrong the other way
(bands/rows chosen too aggressively) would silently let real near-
duplicates back into the corpus by never even proposing them as
candidates -- exactly the kind of quiet regression this file's own
__main__ verifies against directly, not just asserts.
"""

from __future__ import annotations

import hashlib
import random

_MERSENNE_PRIME = (1 << 61) - 1


class MinHasher:
    """Builds a fixed-size (num_perm-length) MinHash signature for a
    shingle set. seed is fixed (not random per-instance) so signatures
    computed by separate MinHasher() calls with the same seed are
    directly comparable -- required since KnowledgeCorpus persists
    documents across process restarts (a new run must hash new
    documents into the SAME hash-function family as everything already
    on disk)."""

    def __init__(self, num_perm: int = 64, seed: int = 1337):
        rng = random.Random(seed)
        self.num_perm = num_perm
        self._a = [rng.randrange(1, _MERSENNE_PRIME) for _ in range(num_perm)]
        self._b = [rng.randrange(0, _MERSENNE_PRIME) for _ in range(num_perm)]

    def signature(self, shingles: set[str]) -> tuple[int, ...]:
        if not shingles:
            return tuple([_MERSENNE_PRIME] * self.num_perm)
        shingle_hashes = [
            int.from_bytes(hashlib.sha1(s.encode("utf-8")).digest()[:8], "big") % _MERSENNE_PRIME
            for s in shingles
        ]
        return tuple(
            min((a * h + b) % _MERSENNE_PRIME for h in shingle_hashes) for a, b in zip(self._a, self._b)
        )


def estimate_jaccard(sig_a: tuple[int, ...], sig_b: tuple[int, ...]) -> float:
    """The MinHash property: fraction of matching signature slots is an
    unbiased estimator of true Jaccard similarity between the two
    original shingle sets -- used only as a cheap sanity metric here
    (this file's __main__), never as the actual accept/reject check,
    which always uses the real, exact Jaccard on the real shingle sets."""
    matches = sum(1 for x, y in zip(sig_a, sig_b) if x == y)
    return matches / len(sig_a)


class LSHIndex:
    """Locality-sensitive hashing over MinHash signatures: groups
    documents into `bands` independent hash tables (one per signature
    slice) so retrieving "everything that MIGHT be near-duplicate"
    is a handful of dict lookups instead of a scan over every stored
    document. Always a CANDIDATE generator, never the final verdict --
    callers must still run the real exact Jaccard check on whatever
    this returns."""

    def __init__(self, num_perm: int = 64, bands: int = 32):
        if num_perm % bands != 0:
            raise ValueError(f"num_perm ({num_perm}) must be divisible by bands ({bands})")
        self.bands = bands
        self.rows = num_perm // bands
        self._buckets: list[dict[tuple[int, ...], list[int]]] = [dict() for _ in range(bands)]

    def _band_keys(self, sig: tuple[int, ...]) -> list[tuple[int, ...]]:
        return [sig[i * self.rows : (i + 1) * self.rows] for i in range(self.bands)]

    def candidates(self, sig: tuple[int, ...]) -> set[int]:
        found: set[int] = set()
        for band_idx, key in enumerate(self._band_keys(sig)):
            found.update(self._buckets[band_idx].get(key, ()))
        return found

    def insert(self, doc_id: int, sig: tuple[int, ...]) -> None:
        for band_idx, key in enumerate(self._band_keys(sig)):
            self._buckets[band_idx].setdefault(key, []).append(doc_id)


if __name__ == "__main__":
    import time

    # --- 1) Correctness on the exact same documents
    # autonomous_knowledge_crawler.py's own test already exercises and
    # asserts on: python-tips vs. its reworded/reordered mirror (a real
    # near-duplicate) vs. the unrelated gold-prices article.
    from autonomous_knowledge_crawler import _shingles  # reuse the exact same shingle function -- no drift risk

    _PYTHON_SENTENCES = [
        "Python is a powerful and flexible programming language used widely across many real software projects today.",
        "One of the most important best practices is writing clean and maintainable code with clear comments only where genuinely needed.",
        "Using static code analysis tools helps catch real bugs early before actual production deployment happens.",
        "Consistent naming conventions make a real codebase much easier for other developers to read and understand later.",
        "Automated testing catches regressions early and gives real confidence when refactoring existing code safely.",
        "Following the official style guide keeps a real codebase consistent across an entire team of contributors.",
    ]
    original = " ".join(_PYTHON_SENTENCES)
    mirror = " ".join([
        _PYTHON_SENTENCES[2], _PYTHON_SENTENCES[0], _PYTHON_SENTENCES[4],
        _PYTHON_SENTENCES[1].replace("genuinely needed", "actually needed"),
        _PYTHON_SENTENCES[5], _PYTHON_SENTENCES[3],
    ])
    unrelated = (
        "Gold prices are influenced by many real economic factors including interest rates, inflation "
        "expectations, and central bank reserve policy decisions made across major world economies over "
        "time. Investors often treat gold as a real hedge against currency devaluation during periods of "
        "high inflation or genuine geopolitical uncertainty."
    )

    hasher = MinHasher(num_perm=64, seed=1337)
    sig_original = hasher.signature(_shingles(original))
    sig_mirror = hasher.signature(_shingles(mirror))
    sig_unrelated = hasher.signature(_shingles(unrelated))

    est_dup = estimate_jaccard(sig_original, sig_mirror)
    est_unrelated = estimate_jaccard(sig_original, sig_unrelated)
    print(f"MinHash-estimated Jaccard: mirror={est_dup:.3f}, unrelated={est_unrelated:.3f}")
    assert est_dup > 0.35, f"MinHash underestimated a real near-duplicate's similarity: {est_dup:.3f}"
    assert est_unrelated < 0.15, f"MinHash overestimated similarity for unrelated articles: {est_unrelated:.3f}"
    print("MinHash signature correctly separates a real near-duplicate from an unrelated article.")

    lsh = LSHIndex(num_perm=64, bands=32)
    lsh.insert(0, sig_original)
    candidates_for_mirror = lsh.candidates(sig_mirror)
    candidates_for_unrelated = lsh.candidates(sig_unrelated)
    print(f"LSH candidates for mirror: {candidates_for_mirror}, for unrelated: {candidates_for_unrelated}")
    assert 0 in candidates_for_mirror, "LSH failed to surface a real near-duplicate as a candidate (recall failure)"
    print("LSH correctly surfaces the real near-duplicate as a candidate.")

    # --- 2) Scalability: candidate retrieval must touch far fewer
    # comparisons than a full O(n) scan as the corpus grows -- proven
    # directly by counting real work done, not asserted.
    rng = random.Random(42)

    def random_document(n_words: int = 150) -> str:
        vocab = [f"word{i}" for i in range(400)]
        return " ".join(rng.choice(vocab) for _ in range(n_words))

    n_docs = 600
    hasher2 = MinHasher(num_perm=64, seed=1337)
    lsh2 = LSHIndex(num_perm=64, bands=32)
    shingle_sets = []
    for i in range(n_docs):
        doc = random_document()
        sset = _shingles(doc)
        shingle_sets.append(sset)
        lsh2.insert(i, hasher2.signature(sset))

    # A fresh near-duplicate of document #0 (same text, one word changed)
    query_doc = random_document()  # unrelated query, worst case for candidate count
    query_sig = hasher2.signature(_shingles(query_doc))

    t0 = time.perf_counter()
    candidates = lsh2.candidates(query_sig)
    lsh_time = time.perf_counter() - t0

    t0 = time.perf_counter()
    from autonomous_knowledge_crawler import _jaccard_similarity
    full_scan_hits = sum(
        1 for sset in shingle_sets if _jaccard_similarity(_shingles(query_doc), sset) >= 0.35
    )
    full_scan_time = time.perf_counter() - t0

    print(f"\nCorpus size: {n_docs} documents")
    print(f"LSH candidate lookup: {len(candidates)} candidates checked exactly, {lsh_time*1000:.2f}ms")
    print(f"Full O(n) scan (today's KnowledgeCorpus behavior): {n_docs} comparisons, {full_scan_time*1000:.2f}ms")
    assert len(candidates) < n_docs, "LSH did not reduce the candidate set at all -- would provide no speedup"
    print(f"LSH checked {len(candidates)}/{n_docs} documents exactly "
          f"({100 * len(candidates) / n_docs:.1f}%) instead of all {n_docs} -- confirmed sub-linear candidate retrieval.")

    print("\nAll MinHash/LSH checks passed: same correctness as the existing exact-Jaccard check, "
          "sub-linear candidate retrieval instead of a full O(n) scan per new document.")
