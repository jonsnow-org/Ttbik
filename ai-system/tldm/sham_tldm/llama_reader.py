"""A frozen reader that is a running llama.cpp server (GGUF) instead of a PyTorch body: the way a T-LDM head can sit on Nova, whose Studios serve a quantised GGUF with no PyTorch body.

llama-server started with `--embeddings --pooling none` answers POST /embeddings with the UNNORMALISED final-layer embedding of every input token
(documented format: [{"index": i, "embedding": [[token 0 ...], [token 1 ...], ...]}]). Those are the head's input features. Same interface as train_sham2.BodyReader
(`d`, `cache`, `secs`, `feats(id_lists, n)`), so the same trainer and evaluator run unchanged. The head must be TRAINED on these features, not on a PyTorch body's: a Q4 GGUF's
numbers differ from the fp body's.

Limits worth knowing: a server in embedding mode does not generate text, so serving the head next to a chat server needs a SECOND llama-server on the same GGUF file (mmap shares the
weights between the two processes; each still pays its own compute buffers). Nova 2's 35B file (~12 GB on a 16 GB box) leaves no room for that.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

import torch


class LlamaReader:
    def __init__(self, base_url: str, timeout: float = 120.0):
        self.base, self.timeout = base_url.rstrip("/"), timeout
        self.cache, self.secs, self.d, self.calls, self.mode = {}, 0.0, None, 0, "tokens"

    def _post(self, path: str, body: dict):
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            return json.loads(r.read())

    def _embed_tokens(self, ids: list):
        """Token ids go in directly (the donor tokenizer and the GGUF share one vocabulary). If the server refuses token arrays, the ids are turned back into text with /detokenize."""
        self.calls += 1
        try:
            if self.mode == "tokens":
                return self._post("/embeddings", {"input": ids})
        except urllib.error.HTTPError as e:
            if e.code not in (400, 422):
                raise
            self.mode = "text"
        text = self._post("/detokenize", {"tokens": ids})["content"]
        return self._post("/embeddings", {"input": text})

    def _vectors(self, ids: list) -> torch.Tensor:
        res = self._embed_tokens(ids)
        item = res[0] if isinstance(res, list) else res["data"][0]
        emb = item["embedding"]
        if not emb or not isinstance(emb[0], list):
            raise RuntimeError("the server returned ONE pooled vector: start llama-server with --embeddings --pooling none to get one per token")
        return torch.tensor(emb, dtype=torch.float32)

    @torch.no_grad()
    def feats(self, id_lists, n):
        """-> (B, n, d) float32 features padded with zeros, and the (B, n) pad mask (True = padding)."""
        vecs = []
        for ids in id_lists:
            key = tuple(ids[:n])
            if key not in self.cache:
                t0 = time.time()
                self.cache[key] = self._vectors(list(key) or [0])[:n]
                self.secs += time.time() - t0
                if len(self.cache) % 25 == 0:
                    print(f"  llama read {len(self.cache)} texts ({self.secs:.0f}s)", flush=True)
            vecs.append(self.cache[key])
        if self.d is None:
            self.d = vecs[0].shape[1]
        out, pad = torch.zeros(len(vecs), n, self.d), torch.ones(len(vecs), n, dtype=torch.bool)
        for i, v in enumerate(vecs):
            out[i, :len(v)] = v
            pad[i, :len(v)] = False
        return out, pad

    def probe(self) -> int:
        """Reads one tiny input and returns the feature width (call before building the head, which needs d_in)."""
        self.d = self._vectors([1, 2, 3]).shape[1]
        return self.d
