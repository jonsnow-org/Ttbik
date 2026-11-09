"""
The small learned encoder of the knowledge bank, WITHOUT torch (numpy only), so it runs inside Sham's Studio next to the model and costs almost nothing.

It is the model trained and measured in sham_knowledge_encoder.py (hashed word + character n-gram features -> an int8 embedding table -> mean -> L2 norm). This file only READS the exported
table and computes the same vectors: the text handling (normalise / tokens), the FNV-1a hash and the features are the same code path as the trainer's, so a vector made here equals the one
the trainer would make (self-test: parity against the torch version when torch is installed).

    enc = Encoder.load("knowledge_encoder.json")
    enc.embed(["ما هي عاصمة فرنسا؟"])        # (1, 64) unit vectors
"""
from __future__ import annotations

import base64
import json
import re
from pathlib import Path

import numpy as np

MAX_TOKENS = 160
_DIACRITICS = re.compile("[ً-ٰٟـ]")
_NONWORD = re.compile(r"[^\w]+", re.UNICODE)
STOP = {"في", "من", "على", "الى", "عن", "ما", "ماذا", "هل", "هو", "هي", "كان", "ان", "او", "ثم", "هذا", "هذه", "التي", "الذي",
        "the", "a", "an", "of", "to", "and", "is", "in", "on", "for", "what", "who", "how"}
_DIGITS = {ord(d): str(i) for i, d in enumerate("٠١٢٣٤٥٦٧٨٩")}


def normalise_text(text: str) -> str:
    t = str(text or "").lower()
    t = _DIACRITICS.sub("", t)
    for a in "أإآٱ":
        t = t.replace(a, "ا")
    t = t.replace("ى", "ي").replace("ة", "ه").translate(_DIGITS)
    return _NONWORD.sub(" ", t.replace("_", " ")).strip()


def tokens(text: str) -> list[str]:
    out = []
    for t in normalise_text(text).split(" "):
        if len(t) > 3 and t.startswith("ال"):
            t = t[2:]
        if len(t) > 1 and t not in STOP:
            out.append(t)
    return out


def fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def features(text: str, buckets: int) -> list[int]:
    ids: list[int] = []
    for t in tokens(text)[:MAX_TOKENS]:
        ids.append(fnv1a("w:" + t) % buckets)
        padded = "<" + t + ">"
        for n in (3, 4):
            for i in range(0, len(padded) - n + 1):
                ids.append(fnv1a("c:" + padded[i:i + n]) % buckets)
    return ids or [fnv1a("empty") % buckets]


class Encoder:
    def __init__(self, table: np.ndarray, scale: np.ndarray):
        self.q, self.scale = table, scale.astype(np.float32)
        self.buckets, self.dim = table.shape

    @classmethod
    def load(cls, path: str | Path) -> "Encoder":
        o = json.loads(Path(path).read_text(encoding="utf-8"))
        q = np.frombuffer(base64.b64decode(o["table"]), dtype=np.int8).reshape(o["buckets"], o["dim"])
        return cls(q, np.asarray(o["scale"], dtype=np.float32))

    def embed(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, t in enumerate(texts):
            ids = np.asarray(features(t, self.buckets), dtype=np.int64)
            out[i] = (self.q[ids].astype(np.float32) * self.scale[ids][:, None]).mean(axis=0)
        n = np.linalg.norm(out, axis=1, keepdims=True)
        return out / np.maximum(n, 1e-12)


def _selftest() -> None:
    assert fnv1a("") == 0x811C9DC5 and fnv1a("a") == 0xE40C292C
    assert normalise_text("الْكِتَابُ، المَدرسة!") == "الكتاب المدرسه"
    rng = np.random.default_rng(0)
    q = rng.integers(-127, 128, size=(4096, 16), dtype=np.int8)
    enc = Encoder(q, rng.random(4096).astype(np.float32) * 0.01)
    v = enc.embed(["مرحبا بالعالم", "hello world", "مرحبا بالعالم"])
    assert v.shape == (3, 16) and abs(float(np.linalg.norm(v[0])) - 1) < 1e-5 and np.allclose(v[0], v[2])
    here = Path(__file__).resolve().parent / "data" / "knowledge_encoder.json"
    try:
        import torch  # noqa: F401
        import sham_knowledge_encoder as T
    except Exception:
        T = None
    if T is not None and here.exists():            # parity with the trainer's own torch implementation on the real exported table
        real = Encoder.load(here)
        torch_enc = T.load_int8(here)
        texts = ["ما هي عاصمة فرنسا؟", "The capital of Japan is Tokyo", "والمدارس الكبيرة في المدينة", "def main(): return 42"]
        a = real.embed(texts)
        b = torch_enc.embed(texts).numpy()
        assert float(np.abs(a - b).max()) < 1e-4, float(np.abs(a - b).max())
        print("  parity with the torch encoder: max diff %.1e" % float(np.abs(a - b).max()))
    print("sham_encoder_np self-test OK")


if __name__ == "__main__":
    _selftest()
