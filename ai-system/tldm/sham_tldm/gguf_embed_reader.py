"""Nova's frozen reader sized for its Studio: the token-embedding rows of Nova's OWN GGUF, read straight from the file Nova already serves.

Why: the first Nova reader (llama_reader.py) needs a SECOND llama-server in embedding mode next to the chat server. On Nova's 16 GB Studio that was measured live
(2026-11-23, #1225): the head stayed "loading" 25 minutes, free memory 0.91 -> 0.28 GB, llama-server major faults 336 -> 1459, i.e. it slowed Nova itself. Reading
the 35B's final layer also costs a full forward pass per request (~10 tokens/s on 2 cores), which is exactly the cost T-LDM is meant to avoid.

This reader is Nova's own body too (its `token_embd.weight`, the first frozen layer of the same 35B), but it costs no server, no forward pass and almost no memory:
the file is memory-mapped (the pages the chat server already holds are shared), and only the rows of the tokens in the request are dequantised. The head's own
compressor + latent thinker supply the context mixing that the 35B's layers supplied before. Same interface as LlamaReader / train_sham2.BodyReader
(`d`, `cache`, `secs`, `calls`, `mode`, `feats(id_lists, n)`, `probe()`), so the same trainer, evaluator and gate run unchanged. Independence: reads only
the GGUF it is given (Nova's); imports nothing from Sham.
"""
from __future__ import annotations

import time

import numpy as np

try:
    import torch
except Exception:  # noqa: BLE001  (the Studio may serve the head without torch later; training always has it)
    torch = None


class GgufEmbedReader:
    TENSOR = "token_embd.weight"

    def __init__(self, gguf_path: str, scale: float | None = None):
        from gguf import GGUFReader
        from gguf.quants import dequantize
        self._dequantize = dequantize
        r = GGUFReader(gguf_path, "r")
        t = next((x for x in r.tensors if x.name == self.TENSOR), None)
        if t is None:
            raise RuntimeError(f"{self.TENSOR} not found in {gguf_path}")
        self._t = t
        self.qtype = t.tensor_type
        self.d = int(t.shape[0])                 # GGUF shape is (n_embd, n_vocab)
        self.n_vocab = int(t.shape[1])
        self._rows = t.data                      # memmap, one row per token (bytes for quantised types)
        self.cache, self.secs, self.calls, self.mode = {}, 0.0, 0, "gguf-token-embd"
        self.scale = scale                       # features are standardised with one global scale (set from the first rows read) so the head sees ~unit inputs

    def rows(self, ids) -> np.ndarray:
        ids = [min(max(int(i), 0), self.n_vocab - 1) for i in ids]
        raw = np.asarray(self._rows[ids])
        out = self._dequantize(raw, self.qtype).reshape(len(ids), self.d).astype(np.float32)
        if self.scale is None:
            self.scale = float(np.sqrt((out ** 2).mean()) or 1.0)
        return out / self.scale

    def _vectors(self, ids):
        self.calls += 1
        return torch.from_numpy(self.rows(list(ids) or [0]))

    def feats(self, id_lists, n):
        """-> (B, n, d) float32 features padded with zeros, and the (B, n) pad mask (True = padding). Same contract as LlamaReader."""
        vecs = []
        for ids in id_lists:
            key = tuple(ids[:n])
            if key not in self.cache:
                t0 = time.time()
                self.cache[key] = self._vectors(list(key))[:n]
                self.secs += time.time() - t0
            vecs.append(self.cache[key])
        out, pad = torch.zeros(len(vecs), n, self.d), torch.ones(len(vecs), n, dtype=torch.bool)
        for i, v in enumerate(vecs):
            out[i, :len(v)] = v
            pad[i, :len(v)] = False
        return out, pad

    def probe(self) -> int:
        self._vectors([1, 2, 3])
        return self.d
