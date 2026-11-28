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
_PII = [re.compile(p) for p in (
    r"[\w.+-]+@[\w-]+\.[\w.-]+",                                         # e-mail
    r"\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[bpars]|AKIA|ASIA|AIza|hf|glpat|npm|SG)[-_A-Za-z0-9]{16,}\b",   # API keys and tokens of common services
    r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b",      # JWT
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----",                                 # private keys
    r"(?i)\b(?:password|passwd|pwd|secret|api[_-]?key|token|كلمة[_ ]?(?:المرور|السر))\s*[:=：]\s*\S+",
    r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b",     # IBAN
    r"(?<!\d)(?:\+|00)\d{1,3}[ -]?\(?\d{1,4}\)?(?:[ -]?\d{2,4}){2,4}(?!\d)",    # international phone numbers
    r"\b(?:\d{1,3}\.){3}\d{1,3}\b",                                       # IPv4 addresses
)]


def _luhn(digits: str) -> bool:
    d = [int(c) for c in reversed(digits)]
    return sum(x if i % 2 == 0 else (x * 2 - 9 if x * 2 > 9 else x * 2) for i, x in enumerate(d)) % 10 == 0


def has_pii(text: str) -> bool:
    if any(p.search(text) for p in _PII):
        return True
    for m in re.finditer(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)", text):           # card numbers: digit runs that pass the Luhn check
        digits = re.sub(r"\D", "", m.group())
        if 13 <= len(digits) <= 19 and _luhn(digits):
            return True
    return False


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
    if has_pii(r.text):
        return False, "contains an e-mail, key, card number, phone number, address, IBAN or password"
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


def minhash(text: str, perms: int = 64, shingle: int = 5) -> tuple[int, ...]:
    """A 64-value MinHash of the 5-word shingles: two texts that share most of their wording share most of their values (near-duplicate / semantic-ish overlap)."""
    w = _norm(text).split()
    sh = {" ".join(w[i:i + shingle]) for i in range(max(1, len(w) - shingle + 1))}
    return tuple(min(int(hashlib.blake2b(f"{k}|{x}".encode(), digest_size=8).hexdigest(), 16) for x in sh) for k in range(perms))


def jaccard_estimate(a: tuple[int, ...], b: tuple[int, ...]) -> float:
    return sum(x == y for x, y in zip(a, b)) / len(a)


def near_dedup(records: Iterable[Record], threshold: float = 0.8) -> tuple[list[Record], int]:
    """Drop a record whose MinHash similarity to an already kept one is >= threshold (catches reworded copies that exact dedup misses)."""
    kept: list[Record] = []
    sigs: list[tuple[int, ...]] = []
    n = 0
    for r in records:
        sig = minhash(r.text)
        if any(jaccard_estimate(sig, o) >= threshold for o in sigs):
            n += 1
            continue
        kept.append(r)
        sigs.append(sig)
    return kept, n


def ngram_hashes(text: str, n: int = 8) -> set[str]:
    w = _norm(text).split()
    return {_h(" ".join(w[i:i + n])) for i in range(max(0, len(w) - n + 1))}


def leak_report(train: Iterable[Record], held: Iterable[Record], n: int = 8, near: float = 0.6) -> dict:
    """Held-out records that share any n-word window with the training set, OR are near-duplicates of a training record by MinHash (a reworded copy shares no 8-word
    window but is still a leak): the held-out set must score what the model has NOT seen."""
    train = list(train)
    tr: set[str] = set()
    for r in train:
        tr |= ngram_hashes(r.text, n)
    sigs = [minhash(r.text) for r in train]
    held = list(held)
    leaked = []
    for i, r in enumerate(held):
        if ngram_hashes(r.text, n) & tr or (sigs and any(jaccard_estimate(minhash(r.text), o) >= near for o in sigs)):
            leaked.append(i)
    return {"held_out": len(held), "leaked": leaked}


def pack_manifest(docs: list[list[int]], metas: list[dict], seq_len: int) -> list[list[dict]]:
    """For each packed row, which documents (with their source, licence and provenance) occupy which token range: the training record can always say where a part of it came from.
    Mirrors `pack` exactly (EOS after each document, rows of seq_len + 1)."""
    if len(docs) != len(metas):
        raise ValueError("one metadata entry per document")
    width, pos, rows = seq_len + 1, 0, {}
    for d, (ids, meta) in enumerate(zip(docs, metas)):
        start, end = pos, pos + len(ids) + 1
        while start < end:
            row, off = divmod(start, width)
            take = min(end - start, width - off)
            rows.setdefault(row, []).append({"doc": d, "from": off, "to": off + take, **{k: meta.get(k) for k in ("source", "license", "provenance")}})
            start += take
        pos = end
    return [rows.get(i, []) for i in range(max(1, -(-pos // width)))]


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
