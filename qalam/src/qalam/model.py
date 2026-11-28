"""Qalam: one unified model. Recurrent shared blocks with sparse experts, a K/V cache, a native T-LDM path and self-speculative decoding.

Native T-LDM (no donor, no separate head model): the SAME blocks, embeddings and tied LM head do
  compress  - a learned perceiver-style compressor turns the prefix states into `latents` slots,
  think     - the recurrent blocks run over the latents (bidirectionally),
  write     - the recurrent blocks, bidirectional over a masked block, read the prefix from the K/V cache and the latents by cross-attention,
and the same causal path verifies the writer's draft, so speculative decoding returns exactly what greedy causal decoding would.
"""
from __future__ import annotations

import math

import torch
import torch.nn.functional as F
from torch import nn

from .config import ModelConfig
from .layers import KV, Block, CrossAttention, RMSNorm, rope_tables


class Qalam(nn.Module):
    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        self.cfg = cfg
        self.embed = nn.Embedding(cfg.vocab_size, cfg.width)
        self.cycle_embed = nn.Embedding(cfg.cycles, cfg.width)
        self.blocks = nn.ModuleList(Block(cfg) for _ in range(cfg.unique_blocks))
        self.final_norm = RMSNorm(cfg.width)
        self.lm_head = nn.Linear(cfg.width, cfg.vocab_size, bias=False)
        self.lm_head.weight = self.embed.weight                       # tied: counted once
        self.latent_queries = nn.Parameter(torch.randn(cfg.latents, cfg.width) * 0.02)
        self.compressor = CrossAttention(cfg.width, cfg.heads)
        self.reader = CrossAttention(cfg.width, cfg.heads)
        for axis, length, pairs in zip(("seq", "row", "col", "time"), (cfg.max_seq, cfg.max_grid, cfg.max_grid, cfg.max_time), cfg.rope_split()):
            cos, sin = rope_tables(length, pairs, cfg.rope_theta, cfg.rope_factor if axis == "seq" else 1.0)
            self.register_buffer(f"rope_{axis}_cos", cos, persistent=False)
            self.register_buffer(f"rope_{axis}_sin", sin, persistent=False)
        self.apply(self._init)
        self._scale_residuals()

    def _scale_residuals(self) -> None:
        """Residual-branch outputs start small (1/sqrt(2 x applications)): twelve recurrent applications must not blow up the stream at step 0."""
        k = 1.0 / math.sqrt(2 * self.cfg.unique_blocks * self.cfg.cycles)
        with torch.no_grad():
            for blk in self.blocks:
                blk.attn.o.weight.mul_(k)
                for e in blk.moe.experts:
                    e.down.weight.mul_(k)
                if blk.moe.shared is not None:
                    blk.moe.shared.down.weight.mul_(k)

    @staticmethod
    def _init(m: nn.Module) -> None:
        if isinstance(m, nn.Linear):
            nn.init.normal_(m.weight, std=0.02)
        elif isinstance(m, nn.Embedding):
            nn.init.normal_(m.weight, std=0.02)

    def count_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters())

    def active_parameters_per_token(self) -> int:
        """Parameters that touch one token in one pass (2 of 8 experts), times the cycles actually run is the compute; this is the per-application figure x applications."""
        c = self.cfg
        attn = (c.width * c.heads * (c.width // c.heads) * 2) + (c.width * c.kv_heads * (c.width // c.heads) * 2)
        moe = c.top_k * 3 * c.width * c.expert_hidden + c.width * c.experts + 3 * c.width * c.shared_hidden
        return (attn + moe) * c.unique_blocks * c.cycles

    # ------------------------------------------------------------------ causal path
    def _check_ids(self, ids: torch.Tensor) -> None:
        if ids.ndim != 2 or ids.shape[1] < 1:
            raise ValueError("token ids must have shape [batch, non-empty sequence]")
        if ids.min().item() < 0 or ids.max().item() >= self.cfg.vocab_size:
            raise ValueError("token id outside the vocabulary")

    def _rope(self, start: int, length: int, like: torch.Tensor, grid: torch.Tensor | None = None) -> tuple[torch.Tensor, torch.Tensor]:
        """Rotary tables for `length` tokens starting at sequence index `start`. `grid` ([length, 3] = row, column, time) places media tokens on their own
        axes (any image size, any video length); text uses grid 0 on those axes, so it rotates only on the sequence axis."""
        if grid is None:
            grid = torch.zeros(length, 3, dtype=torch.long, device=like.device)
        if grid.shape != (length, 3):
            raise ValueError("grid must have shape [length, 3]")
        if grid.min().item() < 0 or grid[:, :2].max().item() >= self.cfg.max_grid or grid[:, 2].max().item() >= self.cfg.max_time:
            raise ValueError("grid position outside max_grid / max_time")
        cos = torch.cat([self.rope_seq_cos[start:start + length], self.rope_row_cos[grid[:, 0]], self.rope_col_cos[grid[:, 1]], self.rope_time_cos[grid[:, 2]]], dim=-1)
        sin = torch.cat([self.rope_seq_sin[start:start + length], self.rope_row_sin[grid[:, 0]], self.rope_col_sin[grid[:, 1]], self.rope_time_sin[grid[:, 2]]], dim=-1)
        return cos.to(like.dtype), sin.to(like.dtype)

    def _cycles(self, cycles: int | None) -> int:
        c = self.cfg.cycles if cycles is None else int(cycles)
        if not 1 <= c <= self.cfg.cycles:
            raise ValueError("cycles must be between 1 and the configured cycles")
        return c

    def forward_causal(self, ids: torch.Tensor, cache: list[KV] | None = None, cycles: int | None = None,
                       grid: torch.Tensor | None = None, segments: torch.Tensor | None = None, start: int | None = None) -> tuple[torch.Tensor, list[KV]]:
        """Hidden states of `ids` (continuing `cache` if given) and the grown cache: one (K, V) per cycle x block application.
        `segments` ([batch, length] document numbers) packs several documents into one row: a token attends only to earlier tokens of its own document."""
        self._check_ids(ids)
        cyc = self._cycles(cycles)
        if start is None:                                             # the position of the first new token: the cache length, unless the cache was trimmed (then the caller passes it)
            start = 0 if cache is None else cache[0][0].shape[2]
        if start + ids.shape[1] > self.cfg.max_seq:
            raise ValueError("sequence exceeds max_seq")
        x = self.embed(ids)
        rope = self._rope(start, ids.shape[1], x, grid)
        smask = None
        if segments is not None:
            if cache is not None or segments.shape != ids.shape:
                raise ValueError("segments need the same shape as ids and no cache")
            t = ids.shape[1]
            smask = (segments[:, :, None] == segments[:, None, :]) & torch.tril(torch.ones(t, t, dtype=torch.bool, device=ids.device))[None]
            smask = smask[:, None]
        new: list[KV] = []
        for c in range(cyc):
            x = x + self.cycle_embed.weight[c]
            for i, blk in enumerate(self.blocks):
                x, kv = blk(x, rope, True, None if cache is None else cache[c * len(self.blocks) + i], smask)
                new.append(kv)
        return self.final_norm(x), new

    def reset_aux(self) -> None:
        for b in self.blocks:
            b.moe.terms = []

    def aux_loss(self) -> torch.Tensor:
        """The expert-balance loss averaged over EVERY application of every block since the last `reset_aux` (all cycles, not just the last one)."""
        terms = [t for b in self.blocks for t in b.moe.terms] or [b.moe.aux for b in self.blocks]
        return torch.stack(terms).mean()

    def prefill(self, ids: torch.Tensor, cycles: int | None = None, chunk: int = 1024, tail: int = 4096) -> tuple[torch.Tensor, list[KV]]:
        """A long prompt in bounded-memory chunks: identical to one forward pass (exact), but the activations never exceed one chunk. Returns the last `tail`
        hidden states (all the T-LDM compressor needs) and the full cache."""
        if chunk < 1:
            raise ValueError("chunk must be positive")
        cache, hid = None, []
        for a in range(0, ids.shape[1], chunk):
            h, cache = self.forward_causal(ids[:, a:a + chunk], cache, cycles)
            hid.append(h[:, -tail:])
            hid = [torch.cat(hid, dim=1)[:, -tail:]]
        return hid[0], cache

    @staticmethod
    def trim_cache(cache: list[KV], sinks: int = 4, window: int = 4096) -> list[KV]:
        """Keep the first `sinks` positions (attention sinks) and the last `window`: memory stays bounded however long the stream. Keys keep their original rotation,
        so relative offsets stay right; the caller passes `start=` (the absolute position) to the next forward_causal. This is lossy by design (the middle is gone)."""
        n = cache[0][0].shape[2]
        if n <= sinks + window:
            return cache
        return [(torch.cat([k[:, :, :sinks], k[:, :, -window:]], dim=2), torch.cat([v[:, :, :sinks], v[:, :, -window:]], dim=2)) for k, v in cache]

    @staticmethod
    def save_cache(cache: list[KV], path, dtype: torch.dtype = torch.bfloat16) -> int:
        """A prompt prefix (system text, tool list, a long document) read ONCE and reused by every later request: the cache is just tensors, so it can live on disk.
        Stored in bf16 by default (half the size). Returns the number of cached positions."""
        torch.save([(k.to(dtype), v.to(dtype)) for k, v in cache], path)
        return int(cache[0][0].shape[2])

    @staticmethod
    def load_cache(path, dtype: torch.dtype = torch.float32, device: str | torch.device = "cpu") -> list[KV]:
        return [(k.to(device=device, dtype=dtype), v.to(device=device, dtype=dtype)) for k, v in torch.load(path, map_location="cpu", weights_only=True)]

    def kv_cache_bytes(self, tokens: int, bytes_per_value: int = 4) -> int:
        """Memory the K/V cache needs for `tokens` positions: 2 (K and V) x kv_heads x head_dim x (cycles x blocks) applications x bytes."""
        c = self.cfg
        return 2 * tokens * c.kv_heads * (c.width // c.heads) * c.cycles * c.unique_blocks * bytes_per_value

    def forward(self, ids: torch.Tensor, cycles: int | None = None, segments: torch.Tensor | None = None) -> tuple[torch.Tensor, torch.Tensor]:
        self.reset_aux()
        h, _ = self.forward_causal(ids, None, cycles, segments=segments)
        return self.lm_head(h), self.aux_loss()

    # ------------------------------------------------------------------ native T-LDM
    def compress(self, hidden: torch.Tensor, window: int = 4096, key_mask: torch.Tensor | None = None) -> torch.Tensor:
        """The latent compressor: learned queries read (the last `window` of) the prefix states. `key_mask` [batch, prefix] keeps packed documents apart."""
        mem = hidden[:, -window:]
        q = self.latent_queries.unsqueeze(0).expand(hidden.shape[0], -1, -1)
        return q + self.compressor(q, mem, None if key_mask is None else key_mask[:, -window:])

    def think(self, latents: torch.Tensor, cycles: int | None = None) -> torch.Tensor:
        cyc = self._cycles(cycles)
        rope = self._rope(0, latents.shape[1], latents)
        x = latents
        for c in range(cyc):
            x = x + self.cycle_embed.weight[c]
            for blk in self.blocks:
                x, _ = blk(x, rope, False, None)
        return x

    def write(self, block_ids: torch.Tensor, cache: list[KV], latents: torch.Tensor, cycles: int | None = None,
              grid: torch.Tensor | None = None, prefix_allow: torch.Tensor | None = None) -> torch.Tensor:
        """Logits for a (partly masked) block that follows the cached prefix. Bidirectional inside the block; the prefix is read from the cache."""
        cyc = self._cycles(cycles)
        start = cache[0][0].shape[2]
        x = self.embed(block_ids)
        rope = self._rope(start, block_ids.shape[1], x, grid)
        for c in range(cyc):
            x = x + self.cycle_embed.weight[c]
            x = x + self.reader(x, latents)
            for i, blk in enumerate(self.blocks):
                x, _ = blk(x, rope, False, cache[c * len(self.blocks) + i], None, prefix_allow)
        return self.lm_head(self.final_norm(x))

    def tldm_loss(self, ids: torch.Tensor, block: int = 16, cycles: int | None = None, generator: torch.Generator | None = None,
                  loss_mask: torch.Tensor | None = None, segments: torch.Tensor | None = None) -> torch.Tensor:
        """Masked-block diffusion loss at a random split: the prefix is encoded causally, the block is masked at a random ratio and rebuilt.
        It obeys the same rules as the causal loss: PAD and tokens with `loss_mask` 0 (a user's words) are never predicted, and with `segments` (packed documents) the
        block, the latents and the prefix it reads all belong to ONE document. `generator` must live on CPU or on ids' device."""
        self._check_ids(ids)
        b, t = ids.shape
        if t < block + 1:
            raise ValueError("sequence shorter than block + 1")
        cyc = self._cycles(cycles)
        dev = ids.device
        gdev = generator.device if generator is not None else dev
        split = int(torch.randint(1, t - block + 1, (1,), generator=generator, device=gdev))
        pad, mask_id = self.cfg.special_id("PAD"), self.cfg.special_id("MASK")
        target = ids[:, split:split + block]
        trainable = target != pad
        if loss_mask is not None:
            trainable &= loss_mask[:, split:split + block].bool()
        key_mask = prefix_allow = None
        if segments is not None:
            bseg, first = segments[:, split:split + block], segments[:, split:split + 1]
            same = bseg == first
            trainable &= same
            key_mask = segments[:, :split] == first
            key_mask[~key_mask.any(dim=1)] = True                       # a row with nothing readable reads everything (it is not trained: no NaN)
            prefix_allow = key_mask[:, None, None, :]
            target = torch.where(same, target, torch.full_like(target, pad))
        self.reset_aux()
        h, cache = self.forward_causal(ids[:, :split], None, cyc, segments=None if segments is None else segments[:, :split])
        latents = self.think(self.compress(h, key_mask=key_mask), cyc)
        ratio = 0.15 + 0.85 * torch.rand((b, 1), generator=generator, device=gdev).to(dev)
        mask = (torch.rand((b, block), generator=generator, device=gdev).to(dev) < ratio) & trainable
        need = ~mask.any(dim=1) & trainable.any(dim=1)                 # at least one masked trainable position in every row that has one
        first_idx = trainable.float().argmax(dim=1)
        mask[need, first_idx[need]] = True
        inp = torch.where(mask, torch.full_like(target, mask_id), target)
        logits = self.write(inp, cache, latents, cyc, prefix_allow=prefix_allow)
        if not bool(mask.any()):
            return logits.float().sum() * 0.0                           # nothing here may be trained: a zero that keeps the graph
        return F.cross_entropy(logits[mask].float(), target[mask])

    @torch.no_grad()
    def _draft(self, cache: list[KV], hidden: torch.Tensor, block: int, steps: int, allowed: list[int], cyc: int,
               fixed: torch.Tensor | None = None, template: torch.Tensor | None = None, grid: torch.Tensor | None = None) -> torch.Tensor:
        """A block of `block` tokens; `fixed` ([batch, f]) are known tokens at its start, and `template` ([batch, block], MASK where to write) fixes any
        other positions (a row end, a frame end). Known tokens are never overwritten. `grid` places the block on the media axes."""
        mask_id = self.cfg.special_id("MASK")
        latents = self.think(self.compress(hidden), cyc)
        out = torch.full((hidden.shape[0], block), mask_id, dtype=torch.long, device=hidden.device)
        if template is not None:
            out = template.clone()
        if fixed is not None:
            out[:, :fixed.shape[1]] = fixed
        keep = torch.full((self.cfg.vocab_size,), float("-inf"), device=hidden.device, dtype=hidden.dtype)
        keep[allowed] = 0.0
        for s in range(steps):
            masked = out.eq(mask_id)
            if not bool(masked.any()):
                break
            probs = torch.softmax(self.write(out, cache, latents, cyc, grid) + keep, dim=-1)
            conf, pred = probs.max(dim=-1)
            for row in range(out.shape[0]):
                pos = masked[row].nonzero(as_tuple=True)[0]
                reveal = max(1, math.ceil(pos.numel() / (steps - s)))
                top = conf[row, pos].topk(min(reveal, pos.numel())).indices
                out[row, pos[top]] = pred[row, pos[top]]
        return out

    @torch.no_grad()
    def generate_tldm(self, prefix: torch.Tensor, block: int = 16, steps: int = 4, cycles: int | None = None, allowed: list[int] | None = None) -> torch.Tensor:
        """A block written by iterative masked refinement (greedy, deterministic). Never emits MASK or ids outside `allowed`."""
        if block < 1 or steps < 1:
            raise ValueError("block and steps must be positive")
        cyc = self._cycles(cycles)
        allowed = allowed or self.cfg.text_and_end_ids()
        if self.cfg.special_id("MASK") in allowed:
            raise ValueError("allowed ids must exclude MASK")
        was = self.training
        self.eval()
        try:
            h, cache = self.prefill(prefix, cyc)
            return self._draft(cache, h, block, steps, allowed, cyc)
        finally:
            self.train(was)

    @torch.no_grad()
    def generate(self, prefix: torch.Tensor, max_new: int, temperature: float = 0.0, top_p: float = 1.0, allowed: list[int] | None = None, stop_id: int | None = None,
                 seed: int | None = None, cycles: int | None = None) -> torch.Tensor:
        """Causal decoding for ONE sequence: greedy at temperature 0, otherwise nucleus sampling (a seed makes it reproducible). Diverse samples are what self-consistency,
        best-of-n and search need; only `allowed` ids can be produced. Runs on the prefix's device."""
        if prefix.shape[0] != 1 or max_new < 1 or temperature < 0 or not 0 < top_p <= 1:
            raise ValueError("batch 1, max_new >= 1, temperature >= 0, 0 < top_p <= 1")
        cyc = self._cycles(cycles)
        dev = prefix.device
        allowed = allowed or self.cfg.text_and_end_ids()
        keep = torch.full((self.cfg.vocab_size,), float("-inf"), dtype=self.embed.weight.dtype, device=dev)
        keep[allowed] = 0.0
        gen = None if seed is None else torch.Generator(device="cpu").manual_seed(int(seed))
        was = self.training
        self.eval()
        try:
            h, cache = self.prefill(prefix, cyc)
            out: list[int] = []
            for _ in range(max_new):
                logits = (self.lm_head(h[:, -1])[0] + keep).float()
                if temperature == 0:
                    t = int(logits.argmax())
                else:
                    p = torch.softmax(logits / temperature, dim=-1)
                    if top_p < 1:
                        sp, si = p.sort(descending=True)
                        cut = sp.cumsum(0) - sp > top_p
                        sp[cut] = 0
                        p = torch.zeros_like(p).scatter(0, si, sp / sp.sum())
                    t = int(torch.multinomial(p.cpu(), 1, generator=gen))
                out.append(t)
                if stop_id is not None and t == stop_id:
                    break
                if cache[0][0].shape[2] + 1 >= self.cfg.max_seq:
                    break
                h, cache = self.forward_causal(torch.tensor([[t]], device=dev), cache, cyc)
            return torch.tensor([out], device=dev)
        finally:
            self.train(was)

    # ------------------------------------------------------------------ self-speculative decoding
    @torch.no_grad()
    def generate_speculative(self, prefix: torch.Tensor, max_new: int, block: int = 8, steps: int = 2, cycles: int | None = None,
                             allowed: list[int] | None = None, stop_id: int | None = None) -> tuple[torch.Tensor, dict]:
        """Greedy decoding accelerated by the native writer. State: the cache holds the committed tokens, and `pending` is the next token already known to be
        the greedy one but not yet in the cache. Each round the writer drafts `block` tokens after `pending` in parallel, ONE causal chunk pass over
        [pending, draft...] checks them, and the longest agreeing run plus the first correct token are kept. The result is IDENTICAL to plain greedy
        causal decoding (batch size 1); only the number of causal passes drops. `passes` counts causal passes (the draft passes are extra, writer-sized)."""
        if prefix.shape[0] != 1:
            raise ValueError("speculative decoding is for batch size 1")
        if max_new < 1:
            raise ValueError("max_new must be positive")
        cyc = self._cycles(cycles)
        allowed = allowed or self.cfg.text_and_end_ids()
        dev = prefix.device
        keep = torch.full((self.cfg.vocab_size,), float("-inf"), dtype=self.embed.weight.dtype, device=dev)
        keep[allowed] = 0.0
        was = self.training
        self.eval()
        try:
            hid, cache = self.prefill(prefix, cyc)
            pending = int((self.lm_head(hid[:, -1]) + keep).argmax())
            out: list[int] = [pending]
            passes, accepted = 1, 0
            while len(out) < max_new and not (stop_id is not None and stop_id in out):
                k = min(block, max_new - len(out), self.cfg.max_seq - cache[0][0].shape[2] - 1)
                if k < 1:
                    break
                fixed = torch.tensor([[pending]], device=dev)
                chunk = self._draft(cache, hid, k + 1, steps, allowed, cyc, fixed=fixed)            # [pending, d1..dk]
                chunk_h, chunk_cache = self.forward_causal(chunk, cache, cyc)
                passes += 1
                preds = (self.lm_head(chunk_h)[0] + keep).argmax(dim=-1)                              # preds[j]: the greedy token after chunk[:j+1]
                agree = (preds[:k] == chunk[0, 1:]).long().cumprod(dim=0)
                m = int(agree.sum())
                accepted += m
                keep_len = cache[0][0].shape[2] + 1 + m
                cache = [(kk[:, :, :keep_len], vv[:, :, :keep_len]) for kk, vv in chunk_cache]
                hid = torch.cat([hid, chunk_h[:, :1 + m]], dim=1)[:, -4096:]
                out.extend(int(t) for t in chunk[0, 1:1 + m])
                pending = int(preds[m])
                out.append(pending)
            if stop_id is not None and stop_id in out:
                out = out[:out.index(stop_id) + 1]
            out = out[:max_new]
            return torch.tensor([out], device=dev), {"tokens": len(out), "passes": passes, "accepted_draft_tokens": accepted}
        finally:
            self.train(was)
