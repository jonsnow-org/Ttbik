"""Tokenizers. The project book counts TOKENS (a block of 16 per pass), so the writer should write tokens, not single bytes: with bytes every character of `grep ERROR app.log` is a position that can be wrong.
BPETokenizer: byte-level BPE trained on the terminal language itself (commands, file names, replies); id 0 = padding / end, ids 1..255 = raw bytes, ids >= 256 = merges.
ByteTokenizer: the byte-level fallback (the first experiment)."""
from __future__ import annotations

import json
from collections import Counter


class ByteTokenizer:
    kind = "byte"
    vocab = 257

    def encode(self, text: str, n: int) -> list[int]:
        b = list(text.encode("utf-8"))[:n]
        return b + [0] * (n - len(b))

    def decode(self, ids) -> str:
        out = bytearray()
        for t in ids:
            t = int(t)
            if t == 0 or t > 255:
                break
            out.append(t)
        return out.decode("utf-8", "replace")

    def state(self) -> dict:
        return {"kind": "byte"}


class BPETokenizer:
    kind = "bpe"

    def __init__(self, merges: list | None = None):
        self.merges = [tuple(m) for m in (merges or [])]
        self.rank = {m: i for i, m in enumerate(self.merges)}
        self.vocab = 256 + len(self.merges)
        self.expand = {256 + i: m for i, m in enumerate(self.merges)}

    @classmethod
    def train(cls, texts: list[str], n_merges: int):
        seqs = [list(t.encode("utf-8")) for t in texts]
        merges = []
        for _ in range(n_merges):
            counts = Counter()
            for s in seqs:
                counts.update(zip(s, s[1:]))
            if not counts:
                break
            pair, c = counts.most_common(1)[0]
            if c < 2:
                break
            new = 256 + len(merges)
            merges.append(pair)
            for i, s in enumerate(seqs):
                out, j = [], 0
                while j < len(s):
                    if j + 1 < len(s) and (s[j], s[j + 1]) == pair:
                        out.append(new); j += 2
                    else:
                        out.append(s[j]); j += 1
                seqs[i] = out
        return cls(merges)

    def _ids(self, text: str) -> list[int]:
        s = list(text.encode("utf-8"))
        while len(s) > 1:
            best = min(((self.rank.get(p, 1 << 30), i) for i, p in enumerate(zip(s, s[1:]))), default=(1 << 30, 0))
            if best[0] == 1 << 30:
                break
            i = best[1]
            s[i:i + 2] = [256 + best[0]]
        return s

    def encode(self, text: str, n: int) -> list[int]:
        ids = self._ids(text)[:n]
        return ids + [0] * (n - len(ids))

    def _bytes(self, t: int, out: bytearray) -> None:
        if t < 256:
            out.append(t)
        else:
            a, b = self.expand[t]
            self._bytes(a, out); self._bytes(b, out)

    def decode(self, ids) -> str:
        out = bytearray()
        for t in ids:
            t = int(t)
            if t == 0 or t >= self.vocab:
                break
            self._bytes(t, out)
        return out.decode("utf-8", "replace")

    def state(self) -> dict:
        return {"kind": "bpe", "merges": [list(m) for m in self.merges]}


def from_state(st: dict):
    return BPETokenizer(st["merges"]) if st.get("kind") == "bpe" else ByteTokenizer()
