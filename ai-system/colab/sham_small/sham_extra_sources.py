"""Extra chat-plan source for Sham v1: real Arabic web text as (span -> next span) pairs from HuggingFaceFW/fineweb-2 (config arb_Arab, ODC-By).

Same rules as the Sham 2 snapshot builder (ai-system/tldm/data/sham2_snapshots.py; the few lines of logic are repeated here because the Studios receive only this folder):
  * a document goes to the held-out side by its id alone (hash bucket 0 of 10) and is NEVER used for training, so the Arabic held-out set stays a yardstick;
  * a pair is a real span and the NEXT span of the same document (sentence boundaries, ~400 characters); nothing is translated, paraphrased or written by hand;
  * only documents that are >= 90% Arabic letters and 600-8000 characters.
It looks like the small slice of a streaming dataset that sham_chat.load_arabic_dialogues uses: skip(n) then take(m) in examples (n // 2 documents). SHAM_FINEWEB_AR=0 turns it off.
Not part of the merge gate's yardstick (that plan is the four Arabic sets only).
"""
from __future__ import annotations

import hashlib
import os
import re

ARABIC = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿ]")
LETTER = re.compile(r"[^\W\d_]", re.UNICODE)
SENTENCE_END = re.compile(r"[.!?؟\n]")


def enabled() -> bool:
    return os.environ.get("SHAM_FINEWEB_AR", "1").strip().lower() not in ("0", "off", "false", "no")


def is_heldout(doc_id: str) -> bool:
    return int(hashlib.sha256(str(doc_id).encode("utf-8")).hexdigest(), 16) % 10 == 0


def _arabic_ratio(text: str) -> float:
    letters = LETTER.findall(text)
    return (len(ARABIC.findall(text)) / len(letters)) if letters else 0.0


def _cut(text: str, start: int, want: int = 400, hard: int = 700):
    if start >= len(text):
        return None
    window = text[start:start + hard]
    ends = [m.end() for m in SENTENCE_END.finditer(window) if m.end() >= min(want // 2, len(window))]
    end = start + (next((e for e in ends if e >= want), ends[-1] if ends else len(window)))
    span = text[start:end].strip()
    return (span, end) if len(span) >= 80 else None


def pairs_of(doc_id: str, text: str) -> list[dict]:
    """Up to two (prompt, target) records of ONE training document; [] for a held-out, short, long or non-Arabic one."""
    if is_heldout(doc_id) or not (600 <= len(text) <= 8000) or _arabic_ratio(text) < 0.9:
        return []
    out, pos, prev = [], 0, None
    for _ in range(3):
        cut = _cut(text, pos)
        if cut is None:
            break
        span, pos = cut
        if prev is not None:
            out.append({"prompt": prev, "target": span})
        prev = span
    return out[:2]


class SpanStream:
    """skip(n_examples).take(m_examples) over a streaming dataset of {id, text}; iterating gives {prompt, target} rows."""

    def __init__(self, stream, offset: int = 0, count: int | None = None):
        self.stream, self.offset, self.count = stream, offset, count

    # the plan counts EXAMPLES; a document gives at most two, so n examples are n // 2 documents (skip and take use the same unit, so the progress stays consistent)
    def skip(self, n: int):
        return SpanStream(self.stream, self.offset + int(n) // 2, self.count)

    def take(self, n: int):
        return SpanStream(self.stream, self.offset, max(1, int(n) // 2))

    def __iter__(self):
        ds = self.stream.skip(self.offset) if self.offset else self.stream
        if self.count is not None:
            ds = ds.take(self.count)
        for r in ds:
            yield from pairs_of(str(r.get("id") or ""), r.get("text") or "")


# key -> (dataset repo, config, plan weight). Arabic web text in the standard language and five dialects, and Arabic Wikipedia (the owner's registry in the Lena9 repository, onecore-ai/data/sources.yaml).
SOURCES = {
    "fineweb2_ar": ("HuggingFaceFW/fineweb-2", "arb_Arab", 0.5),
    "fineweb2_ar_egyptian": ("HuggingFaceFW/fineweb-2", "arz_Arab", 0.25),
    "fineweb2_ar_saudi": ("HuggingFaceFW/fineweb-2", "ars_Arab", 0.15),
    "fineweb2_ar_moroccan": ("HuggingFaceFW/fineweb-2", "ary_Arab", 0.15),
    "fineweb2_ar_iraqi": ("HuggingFaceFW/fineweb-2", "acm_Arab", 0.15),
    "fineweb2_ar_algerian": ("HuggingFaceFW/fineweb-2", "arq_Arab", 0.15),
    "wikipedia_ar": ("wikimedia/wikipedia", "20231101.ar", 0.4),
}
SOURCE_SIZES = {"fineweb2_ar": 5_000_000, "fineweb2_ar_egyptian": 1_000_000, "fineweb2_ar_saudi": 300_000, "fineweb2_ar_moroccan": 300_000,
                "fineweb2_ar_iraqi": 300_000, "fineweb2_ar_algerian": 300_000, "wikipedia_ar": 1_200_000}


def source(key: str) -> SpanStream:
    from datasets import load_dataset
    repo, config, _ = SOURCES[key]
    return SpanStream(load_dataset(repo, config, split="train", streaming=True))


def fineweb2_ar() -> SpanStream:
    return source("fineweb2_ar")


def _selftest() -> None:
    text = " ".join(f"هذه الجملة رقم {i} تصف حال المدينة في الصباح الباكر." for i in range(60))
    train_id = next(f"d{i}" for i in range(100) if not is_heldout(f"d{i}"))
    held_id = next(f"d{i}" for i in range(100) if is_heldout(f"d{i}"))
    got = pairs_of(train_id, text)
    assert 1 <= len(got) <= 2 and got[0]["prompt"] != got[0]["target"]
    assert pairs_of(held_id, text) == [] and pairs_of(train_id, "english " * 200) == [] and pairs_of(train_id, text[:100]) == []

    class Fake:
        def __init__(self, rows):
            self.rows = rows
        def skip(self, n):
            return Fake(self.rows[n:])
        def take(self, n):
            return Fake(self.rows[:n])
        def __iter__(self):
            return iter(self.rows)

    rows = [{"id": f"d{i}", "text": text.replace("رقم", f"رقم{i}")} for i in range(40)]
    docs = lambda a, b: {r["id"] for r in rows[a:b]}
    first = list(SpanStream(Fake(rows)).skip(0).take(10))
    again = list(SpanStream(Fake(rows)).skip(0).take(10))
    nxt = list(SpanStream(Fake(rows)).skip(10).take(10))
    assert first == again and first and nxt and first != nxt                                   # deterministic and the pass moves on
    assert sum(not is_heldout(i) for i in docs(0, 10)) * 1 >= 1
    print("sham_extra_sources self-test OK:", len(first), "pairs from 10 documents")


if __name__ == "__main__":
    _selftest()
