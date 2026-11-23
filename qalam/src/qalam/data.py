"""Data for training: records with provenance and licence, exact and near-duplicate removal, leak checks between training and held-out sets, packing into
fixed rows with per-document segments, and chat formatting with assistant-only loss. Nothing here downloads data: that belongs to the notebooks."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Iterable

import torch

from .config import ModelConfig

# Where a record came from. `commercial_model_output` is NEVER admitted (owner rule: no training on commercial-model outputs).
PROVENANCE = ("bootstrap", "synthetic_unverified", "synthetic_verified", "external_reviewed", "external_staged", "owner_curated", "executor_verified", "commercial_model_output")
TRAINABLE = tuple(p for p in PROVENANCE if p != "commercial_model_output")
_PII = [re.compile(p) for p in (r"[\w.+-]+@[\w-]+\.[\w.-]+", r"\b(?:sk|ghp|gho|xox[bap]|AKIA)[-_A-Za-z0-9]{16,}\b", r"\b\d{13,19}\b", r"(?i)password\s*[:=]\s*\S+")]


@dataclass(frozen=True)
class Record:
    text: str
    source: str
    provenance: str
    license: str = "unknown"
    lang: str = ""
    split: str = "train"


def admit(r: Record) -> tuple[bool, str]:
    if r.provenance not in PROVENANCE:
        return False, "unknown provenance"
    if r.provenance == "commercial_model_output":
        return False, "commercial model output is never trained on"
    if not r.text.strip():
        return False, "empty"
    if r.license in ("", "unknown") and r.provenance in ("external_staged", "external_reviewed"):
        return False, "external data needs a licence"
    if any(p.search(r.text) for p in _PII):
        return False, "contains an e-mail, key, card number or password"
    return True, "ok"


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", text.lower())).strip()


def _h(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def dedup(records: Iterable[Record]) -> tuple[list[Record], int]:
    """Exact duplicates after normalisation (case, punctuation, spaces). Returns (kept, number removed)."""
    items = list(records)
    seen: set[str] = set()
    kept: list[Record] = []
    for r in items:
        k = _h(_norm(r.text))
        if k not in seen:
            seen.add(k)
            kept.append(r)
    return kept, len(items) - len(kept)


def ngram_hashes(text: str, n: int = 8) -> set[str]:
    w = _norm(text).split()
    return {_h(" ".join(w[i:i + n])) for i in range(max(0, len(w) - n + 1))}


def leak_report(train: Iterable[Record], held: Iterable[Record], n: int = 8) -> dict:
    """Held-out records that share any n-word window with the training set (a leak): the held-out set must score what the model has NOT seen."""
    tr: set[str] = set()
    for r in train:
        tr |= ngram_hashes(r.text, n)
    held = list(held)
    return {"held_out": len(held), "leaked": [i for i, r in enumerate(held) if ngram_hashes(r.text, n) & tr]}


def pack(cfg: ModelConfig, docs: list[list[int]], seq_len: int, loss_masks: list[list[int]] | None = None) -> dict[str, torch.Tensor]:
    """Documents (token ids) -> rows of seq_len + 1 with EOS between documents, per-document `segments` (block-diagonal attention) and `loss_mask`.
    A document longer than a row is split. The last row is padded with PAD (segment -1, loss 0)."""
    eos, pad = cfg.special_id("EOS"), cfg.special_id("PAD")
    flat: list[int] = []
    seg: list[int] = []
    lm: list[int] = []
    for d, ids in enumerate(docs):
        mask = loss_masks[d] if loss_masks else [1] * len(ids)
        if len(mask) != len(ids):
            raise ValueError("loss mask length must equal document length")
        flat += ids + [eos]
        lm += list(mask) + [1]
        seg += [d] * (len(ids) + 1)
    width = seq_len + 1
    rows = max(1, -(-len(flat) // width))
    flat += [pad] * (rows * width - len(flat))
    lm += [0] * (rows * width - len(lm))
    seg += [-1] * (rows * width - len(seg))
    ids_t = torch.tensor(flat).view(rows, width)
    seg_t = torch.tensor(seg).view(rows, width)
    # rows are independent: a document split over two rows keeps its number, but each row only attends within itself
    return {"ids": ids_t, "segments": seg_t, "loss_mask": torch.tensor(lm).view(rows, width)}


def chat_example(cfg: ModelConfig, encode, system: str, turns: list[tuple[str, str]]) -> tuple[list[int], list[int]]:
    """turns: [(role, text)] with role 'user' | 'assistant'. Returns (ids, loss_mask): only the assistant's tokens (and its closing EOS marker) are trained on."""
    sp = cfg.special_id
    ids: list[int] = []
    mask: list[int] = []
    if system:
        s = [sp("SYSTEM")] + encode(system)
        ids += s
        mask += [0] * len(s)
    for role, text in turns:
        if role == "user":
            s = [sp("USER")] + encode(text)
            ids += s
            mask += [0] * len(s)
        elif role == "assistant":
            body = encode(text)
            ids += [sp("ASSISTANT")] + body + [sp("EOS")]
            mask += [0] + [1] * len(body) + [1]
        else:
            raise ValueError("role must be user or assistant")
    return ids, mask
