"""Fresh-text streaming for Sham with a persistent offset, sequence packing
with document-boundary masking, and a high-quality anneal mix for the decay tail.

- OffsetStore: a tiny JSON file remembering how far each corpus has been
  read, so the next session continues with UNSEEN documents instead of
  re-reading the same first few thousand.
- pack_documents: concatenates tokenized documents into fixed-length rows
  (no padding waste) and returns `doc_ids` so attention never crosses a
  document boundary (see block_causal_mask) and labels at a boundary are -100.
- AnnealMixer: during the decay tail, draws a configurable fraction of rows
  from a cleaner pool (curated Arabic text + dialogue) instead of the bulk pool.
Works with any iterable of strings and any `encode(str) -> list[int]`.
"""
from __future__ import annotations

import json
import os
import random
from pathlib import Path
from typing import Callable, Iterable, Iterator

import torch

DOCS_PER_SESSION = int(os.environ.get("SHAM_BOOST_DOCS_PER_SESSION", "25000"))


class OffsetStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.data = json.loads(self.path.read_text()) if self.path.exists() else {}

    def get(self, name: str) -> int:
        return int(self.data.get(name, 0))

    def advance(self, name: str, n: int) -> None:
        self.data[name] = self.get(name) + int(n)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=1))
        os.replace(tmp, self.path)


def fresh_docs(name: str, docs: Iterable[str], store: OffsetStore, limit: int = DOCS_PER_SESSION,
               min_chars: int = 200) -> Iterator[str]:
    """Skips everything already read in earlier sessions, yields up to `limit`
    new documents, and records progress as it goes (crash-safe every 500)."""
    skip, taken, pending = store.get(name), 0, 0
    for i, d in enumerate(docs):
        if i < skip:
            continue
        pending += 1
        if pending >= 500:
            store.advance(name, pending)
            pending = 0
        if not d or len(d) < min_chars:
            continue
        yield d
        taken += 1
        if taken >= limit:
            break
    if pending:
        store.advance(name, pending)


def pack_documents(token_docs: Iterable[list[int]], seq_len: int, eos_id: int | None = None
                   ) -> Iterator[tuple[torch.Tensor, torch.Tensor, torch.Tensor]]:
    """Yields (input_ids, labels, doc_ids), each of shape (seq_len,).
    labels[i] = -100 when token i starts a new document (so the shifted loss
    never asks the model to predict document B from document A)."""
    buf, did, cur = [], [], 0
    for toks in token_docs:
        if eos_id is not None:
            toks = list(toks) + [eos_id]
        buf.extend(toks)
        did.extend([cur] * len(toks))
        cur += 1
        while len(buf) >= seq_len:
            ids = torch.tensor(buf[:seq_len])
            d = torch.tensor(did[:seq_len])
            lab = ids.clone()
            lab[1:][d[1:] != d[:-1]] = -100
            yield ids, lab, d - d[0]
            buf, did = buf[seq_len:], did[seq_len:]


def block_causal_mask(doc_ids: torch.Tensor) -> torch.Tensor:
    """(B, T) doc ids -> (B, 1, T, T) bool mask, True = attend (causal AND same document)."""
    T = doc_ids.shape[-1]
    causal = torch.ones(T, T, dtype=torch.bool, device=doc_ids.device).tril()
    same = doc_ids[:, :, None] == doc_ids[:, None, :]
    return (same & causal)[:, None]


class AnnealMixer:
    """Yields rows from `bulk` normally; while `in_tail()` is True, a fraction
    `hq_frac` of rows comes from `hq` (cycled) instead."""

    def __init__(self, bulk: Iterable, hq: list, in_tail: Callable[[], bool], hq_frac: float = 0.6, seed: int = 0):
        self.bulk, self.hq, self.in_tail, self.hq_frac = iter(bulk), list(hq), in_tail, hq_frac
        self.rng = random.Random(seed)

    def __iter__(self):
        j = 0
        while True:
            if self.hq and self.in_tail() and self.rng.random() < self.hq_frac:
                yield self.hq[j % len(self.hq)]
                j += 1
                continue
            try:
                yield next(self.bulk)
            except StopIteration:
                return


def batches(rows: Iterable, batch_size: int) -> Iterator[tuple[torch.Tensor, torch.Tensor, torch.Tensor]]:
    group = []
    for r in rows:
        group.append(r)
        if len(group) == batch_size:
            yield tuple(torch.stack(x) for x in zip(*group))
            group = []
