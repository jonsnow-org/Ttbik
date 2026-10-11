"""
Sham long-context system: the CODE drives the model so that one small model produces output far longer than its window, with every method
the owner named working together (2026-10-11): more context (RoPE extension), banks (retrieval memory), compression (delta coding of video
tokens), a bigger model (expand_model.py, outside this file) — the planner below picks the mix per request and per pressure.

Nothing here edits model.py or any checkpoint on disk. It wraps any ShamSmall — trained or random, so the mechanics are testable today.

  extend_context_ntk(model, new_len)   more positions with NO weight change (NTK-aware RoPE; the new theta lives in cfg, so a checkpoint saved
                                       afterwards reloads with the same positions)
  TokenBank                            chunks of token ids + a key vector each (mean embedding); retrieve(query, k) = the k most similar chunks.
                                       Disk-backed (npz) so a bank can live on any free storage
  LongGenerator                        generates chunk after chunk; every chunk's context = prompt anchor + retrieved chunks + recent tail,
                                       always <= the model's window. Length is a service policy: TIERS (free / plus / pro) set the cap
  delta_encode / delta_decode          video token grids -> only the cells that changed (run-length gaps). Lossless; ratio depends on how
                                       static the clip is, measured, never assumed
  plan(...)                            token budget of a request and the mode that fits (direct / banked / banked+delta), CPU time estimate

Honest limits: retrieval puts older chunks IN the context, so quality depends on the model being trained to use them (retrieval-style
training data, a later step); the delta codec needs ~256 extra gap-token ids in the vocabulary (expand_model.py) before a model can emit it.
Run `python sham_longctx.py` for the offline self-test.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch

# --------------------------------------------------------------------------------------------------------------------------------------
# 1. more context, no weight change
# --------------------------------------------------------------------------------------------------------------------------------------


def extend_context_ntk(model, new_len: int) -> float:
    """NTK-aware RoPE scaling (bloc97, 2023): raise theta by scale^(d/(d-2)) so low frequencies stretch and high ones barely move. Returns the
    new theta. cfg.rope_theta/max_seq_len are updated, so save_checkpoint(...) afterwards reloads with the same positions."""
    old_len = model.cfg.max_seq_len
    if new_len <= old_len:
        return model.cfg.rope_theta
    head_dim = model.cfg.d_model // model.cfg.n_heads
    scale = new_len / old_len
    model.cfg.rope_theta = model.cfg.rope_theta * scale ** (head_dim / (head_dim - 2))
    model.resize_max_seq_len(new_len)
    return model.cfg.rope_theta


# --------------------------------------------------------------------------------------------------------------------------------------
# 2. the bank
# --------------------------------------------------------------------------------------------------------------------------------------


def chunk_key(model, ids: list[int]) -> torch.Tensor:
    """A chunk's key: the mean of its token embeddings, L2-normalised (cheap, needs no forward pass)."""
    with torch.no_grad():
        e = model.token_embedding(torch.tensor(ids, dtype=torch.long)).float().mean(dim=0)
    return e / e.norm().clamp_min(1e-8)


class TokenBank:
    def __init__(self):
        self.chunks: list[np.ndarray] = []
        self.keys: list[np.ndarray] = []
        self.meta: list[dict] = []

    def __len__(self) -> int:
        return len(self.chunks)

    def add(self, ids: list[int], key: torch.Tensor, **meta) -> int:
        self.chunks.append(np.asarray(ids, dtype=np.int32))
        self.keys.append(key.numpy().astype(np.float32))
        self.meta.append(meta)
        return len(self.chunks) - 1

    def retrieve(self, query: torch.Tensor, k: int, exclude: set[int] | None = None) -> list[int]:
        if not self.keys or k <= 0:
            return []
        sims = np.stack(self.keys) @ query.numpy().astype(np.float32)
        for i in exclude or ():
            if 0 <= i < len(sims):
                sims[i] = -np.inf
        order = np.argsort(-sims)[:k]
        return [int(i) for i in order if np.isfinite(sims[i])]

    def nbytes(self) -> int:
        return sum(c.nbytes for c in self.chunks) + sum(k.nbytes for k in self.keys)

    def save(self, path: str | Path) -> None:
        lens = np.array([len(c) for c in self.chunks], dtype=np.int64)
        np.savez_compressed(path, lens=lens, tokens=np.concatenate(self.chunks) if self.chunks else np.zeros(0, np.int32),
                            keys=np.stack(self.keys) if self.keys else np.zeros((0, 1), np.float32))

    @classmethod
    def load(cls, path: str | Path) -> "TokenBank":
        z = np.load(path)
        bank, pos = cls(), 0
        for n, key in zip(z["lens"], z["keys"]):
            bank.chunks.append(z["tokens"][pos:pos + int(n)].astype(np.int32))
            bank.keys.append(key.astype(np.float32))
            bank.meta.append({})
            pos += int(n)
        return bank


# --------------------------------------------------------------------------------------------------------------------------------------
# 3. the long generator
# --------------------------------------------------------------------------------------------------------------------------------------

# service policy, in SECONDS of output per request; the owner's plan: free >= 30 s, paid longer. Seconds -> tokens via plan().
TIERS = {"free": {"video_s": 30, "audio_s": 60}, "plus": {"video_s": 120, "audio_s": 300}, "pro": {"video_s": 600, "audio_s": 1800}}


@dataclass
class LongGenConfig:
    chunk: int = 256            # tokens generated per step of the loop
    tail: int = 512             # most recent tokens always in the context
    retrieve_k: int = 2         # banked chunks pulled into the context
    anchor: int = 64            # first tokens of the prompt kept in every context (identity / style of the clip)
    temperature: float = 0.8
    top_k: int | None = 50
    top_p: float | None = 0.95
    allowed: tuple[int, int] | None = None     # restrict sampling to an id range (e.g. image codebook ids of a video)
    eos_id: int | None = None


class LongGenerator:
    def __init__(self, model, cfg: LongGenConfig | None = None, bank: TokenBank | None = None):
        self.model, self.cfg, self.bank = model, cfg or LongGenConfig(), bank or TokenBank()
        self.max_context_used = 0
        self.log: list[dict] = []

    def _context(self, stream: list[int], pos_in_bank: set[int]) -> tuple[list[int], list[int]]:
        c = self.cfg
        window = self.model.cfg.max_seq_len
        anchor = stream[:c.anchor]
        tail = stream[max(c.anchor, len(stream) - c.tail):]
        # whatever room is left after anchor + tail + the chunk being generated goes to retrieved chunks
        room = window - len(anchor) - len(tail) - c.chunk
        got: list[int] = []
        if room > 0 and len(self.bank):
            q = chunk_key(self.model, tail or anchor)
            got = self.bank.retrieve(q, c.retrieve_k, exclude=pos_in_bank)
        ctx_chunks: list[int] = []
        used: list[int] = []
        for i in got:
            ch = self.bank.chunks[i].tolist()
            if len(ctx_chunks) + len(ch) > room:
                break
            ctx_chunks += ch
            used.append(i)
        return anchor + ctx_chunks + tail, used

    @torch.no_grad()
    def generate(self, prompt: list[int], total_new: int, seed: int | None = None) -> list[int]:
        from generate import generate_tokens
        c = self.cfg
        if seed is not None:
            torch.manual_seed(seed)
        window = self.model.cfg.max_seq_len
        assert c.anchor + c.tail + c.chunk <= window, "anchor + tail + chunk must fit the model's window"
        stream = list(prompt)
        self.model.eval()
        n_new = 0
        recent_bank_ids: set[int] = set()
        # the prompt itself is the first banked chunk(s), so the very first retrievals have something
        for i in range(0, len(stream), c.chunk):
            part = stream[i:i + c.chunk]
            if len(part) >= 8:
                recent_bank_ids.add(self.bank.add(part, chunk_key(self.model, part), src="prompt"))
        while n_new < total_new:
            step = min(c.chunk, total_new - n_new)
            ctx, used = self._context(stream, recent_bank_ids)
            self.max_context_used = max(self.max_context_used, len(ctx) + step)
            assert len(ctx) + step <= window
            x = torch.tensor([ctx], dtype=torch.long)
            ranges = [c.allowed] * step if c.allowed else None
            out = generate_tokens(self.model, x, step, temperature=c.temperature, top_k=c.top_k, top_p=c.top_p, eos_id=c.eos_id,
                                  allowed_ranges=ranges)
            new = out[0, x.shape[1]:].tolist()
            if c.eos_id is not None and c.eos_id in new:
                new = new[:new.index(c.eos_id)]
                stream += new
                n_new += len(new)
                break
            stream += new
            n_new += len(new)
            idx = self.bank.add(new, chunk_key(self.model, new), src="gen", at=len(stream))
            # a chunk just written must not be retrieved straight back (it is already in the tail)
            recent_bank_ids = {idx - j for j in range(0, max(1, c.tail // c.chunk))}
            self.log.append({"at": len(stream), "ctx": len(ctx), "retrieved": used})
        return stream


# --------------------------------------------------------------------------------------------------------------------------------------
# 4. delta coding of video token grids
# --------------------------------------------------------------------------------------------------------------------------------------

GAP_IDS = 256       # ids needed for a gap token: gap in [0, 255]; a longer static run is written as several gap tokens + a repeat marker


def delta_encode(prev: list[int] | None, cur: list[int], gap_base: int = 0) -> list[int]:
    """cur frame as [gap, token, gap, token, ...]: `gap` unchanged cells to skip (id gap_base+gap, 0 <= gap <= 255 — a 16x16 grid never needs
    more), then the new token of the next changed cell. prev=None -> every cell is changed (a keyframe). The tail of unchanged cells is
    implicit. Lossless."""
    assert len(cur) <= 256, "grids above 16x16 cells need a wider gap range"
    out: list[int] = []
    gap = 0
    for i, t in enumerate(cur):
        if prev is not None and prev[i] == t:
            gap += 1
            continue
        out += [gap_base + gap, t]
        gap = 0
    return out


def delta_decode(prev: list[int] | None, coded: list[int], n_cells: int, gap_base: int = 0) -> list[int]:
    cur = list(prev) if prev is not None else [0] * n_cells
    pos = 0
    for j in range(0, len(coded), 2):
        pos += coded[j] - gap_base
        cur[pos] = coded[j + 1]
        pos += 1
    return cur


def video_to_delta_stream(frames: list[list[int]], gap_base: int = 0) -> tuple[list[int], dict]:
    """A whole clip's frame grids -> one stream and its measured compression."""
    stream, prev = [], None
    for g in frames:
        stream += delta_encode(prev, g, gap_base)
        prev = g
    raw = sum(len(g) for g in frames)
    return stream, {"raw_tokens": raw, "coded_tokens": len(stream), "ratio": raw / max(len(stream), 1)}


# --------------------------------------------------------------------------------------------------------------------------------------
# 5. the planner: which mix fits this request, and what does it cost
# --------------------------------------------------------------------------------------------------------------------------------------


def plan(seconds: float, kind: str = "video+audio", fps: float = 8, tokens_per_frame: int = 256, audio_tokens_per_s: float = 31.25,
         window: int = 2048, delta_ratio: float = 1.0, cpu_tokens_per_s: float = 20.0, gpu_tokens_per_s: float = 250.0,
         chunk: int = 256) -> dict:
    """tokens of the request under each method. delta_ratio = measured compression of frame tokens (1.0 = none)."""
    v = seconds * fps * (tokens_per_frame + 2) / max(delta_ratio, 1e-9) if "video" in kind else 0.0
    a = seconds * audio_tokens_per_s if "audio" in kind else 0.0
    total = v + a
    mode = "direct" if total <= window - 64 else ("banked" if delta_ratio <= 1.0 else "banked+delta")
    return {"seconds": seconds, "tokens": int(total), "window": window, "mode": mode, "chunks": math.ceil(total / chunk),
            "est_cpu_s": int(total / cpu_tokens_per_s), "est_gpu_s": int(total / gpu_tokens_per_s)}


def tier_cap_tokens(tier: str, kind: str = "video+audio", **kw) -> int:
    t = TIERS[tier]
    secs = t["video_s"] if "video" in kind else t["audio_s"]
    return plan(secs, kind, **kw)["tokens"]


# --------------------------------------------------------------------------------------------------------------------------------------
# self-test (offline, CPU, a tiny random model: it proves the MECHANICS, not quality)
# --------------------------------------------------------------------------------------------------------------------------------------

if __name__ == "__main__":
    import tempfile

    from model import ShamSmall, ShamSmallConfig

    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=400, d_model=32, n_layers=2, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=256)
    model = ShamSmall(cfg).eval()

    # 1. context extension: logits on a short prefix stay close (NTK), the new length runs, config reloads the same
    x = torch.randint(0, 400, (1, 64))
    with torch.no_grad():
        before = model(x)[0]
    theta = extend_context_ntk(model, 1024)
    with torch.no_grad():
        after = model(x)[0]
        long_out = model(torch.randint(0, 400, (1, 1024)))[0]
    assert theta > 10000.0 and model.cfg.max_seq_len == 1024 and torch.isfinite(long_out).all()
    assert (before - after).abs().max() < 1.0, "NTK scaling must not wreck short-context behaviour"
    assert extend_context_ntk(model, 512) == theta, "never shrinks"
    extend_back = ShamSmallConfig.from_dict(model.cfg.to_dict())
    assert extend_back.rope_theta == model.cfg.rope_theta and extend_back.max_seq_len == 1024
    model.resize_max_seq_len(256)
    model.cfg.rope_theta = 10000.0

    # 2. bank: a needle chunk among 300 is found by a query that shares its tokens; disk round trip keeps it
    bank = TokenBank()
    for _ in range(300):
        ids = torch.randint(0, 300, (64,)).tolist()
        bank.add(ids, chunk_key(model, ids))
    needle = [350 + (i % 40) for i in range(64)]
    nid = bank.add(needle, chunk_key(model, needle))
    q = chunk_key(model, needle[:20] + torch.randint(0, 300, (12,)).tolist())
    assert bank.retrieve(q, 1) == [nid], "needle chunk not retrieved"
    with tempfile.TemporaryDirectory() as d:
        bank.save(Path(d) / "bank.npz")
        again = TokenBank.load(Path(d) / "bank.npz")
        assert len(again) == len(bank) and again.retrieve(q, 1) == [nid] and again.chunks[nid].tolist() == needle

    # 3. long generator: 6x the window, every context inside the window, bank grows, same seed = same stream, retrieval is used
    lg = LongGenerator(model, LongGenConfig(chunk=32, tail=96, retrieve_k=2, anchor=16, top_k=20, top_p=None, allowed=(0, 400)))
    prompt = torch.randint(0, 300, (80,)).tolist()
    out1 = lg.generate(prompt, total_new=1500, seed=7)
    assert len(out1) == 80 + 1500 and lg.max_context_used <= 256, (len(out1), lg.max_context_used)
    assert len(lg.bank) > 40 and any(e["retrieved"] for e in lg.log), "bank never used"
    lg2 = LongGenerator(model, LongGenConfig(chunk=32, tail=96, retrieve_k=2, anchor=16, top_k=20, top_p=None, allowed=(0, 400)))
    assert lg2.generate(prompt, total_new=1500, seed=7) == out1, "same seed must give the same stream"

    # 4. delta codec: lossless on a clip whose grid changes in a few cells; compression is measured
    rng = np.random.default_rng(0)
    g = rng.integers(0, 8192, 256).tolist()
    frames = [g]
    for _ in range(15):
        g = list(g)
        for pos in rng.choice(256, 30, replace=False):
            g[pos] = int(rng.integers(0, 8192))
        frames.append(g)
    stream, stats = video_to_delta_stream(frames, gap_base=8192)
    # decode frame by frame from the stream
    pos, prev, decoded = 0, None, []
    for f in frames:
        n_changed = 256 if prev is None else sum(1 for a, b in zip(prev, f) if a != b)
        coded = stream[pos:pos + 2 * n_changed]
        pos += 2 * n_changed
        prev = delta_decode(prev, coded, 256, gap_base=8192)
        decoded.append(prev)
    assert decoded == frames, "delta coding must be lossless"
    assert stats["ratio"] > 1.0, stats           # 30/256 cells change per frame: must beat raw even with the gap tokens

    # 5. planner: free tier 30 s of video+audio needs banks; a 3-second clip fits directly
    p30, p3 = plan(30), plan(3, fps=2, tokens_per_frame=16)
    assert p30["mode"] == "banked" and p3["mode"] == "direct", (p30, p3)
    assert plan(30, delta_ratio=4.0)["tokens"] < p30["tokens"]
    assert tier_cap_tokens("free") < tier_cap_tokens("plus") < tier_cap_tokens("pro")
    print("sham_longctx self-test OK |", f"6x-window stream ok, max context {lg.max_context_used}/256, bank {len(lg.bank)} chunks,",
          f"delta ratio {stats['ratio']:.2f}x, plan(30s)={p30['tokens']} tokens/{p30['mode']}")
