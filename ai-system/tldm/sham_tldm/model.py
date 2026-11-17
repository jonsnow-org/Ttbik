"""The two assemblies of the project book.

  Sham1_TLDM    from scratch: byte embedding -> Mamba reader -> Compressor -> Latent Thinker -> Diffusion Writer   (the 0.3B decisive experiment, and Sham 1)
  ShamBodyTLDM  the Sham 2 recipe on a COPY of an existing Sham body (ShamSmall: v1, or v2 = Qwen3-1.7B donor): the body is the frozen reader (its LoRA adapters may train), and only the
                Compressor + Latent Thinker + Diffusion Writer are new. The writer writes BYTES (vocab 257), not the body's 152k-token vocabulary: with that vocabulary one writer pass would cost
                64 x 151,936 x 2,048 multiplications, slower than writing token by token; commands are ASCII and bytes keep them exact.
Nothing here edits ai-system/colab/sham_small/model.py: the body is only read through a hook on its final norm.
"""
from __future__ import annotations

import torch
import torch.nn as nn

from .compressor import Compressor
from .mamba import MambaBlock
from .thinker import LatentThinker
from .writer import DiffusionWriter

PAD = 0
VOCAB = 257           # bytes 0..255 (0 = padding / end) + nothing else: the hidden positions are a learned vector, not a token id


def encode_bytes(text: str, n: int) -> list[int]:
    b = list(text.encode("utf-8"))[:n]
    return b + [PAD] * (n - len(b))


def decode_bytes(tokens) -> str:
    out = bytearray()
    for t in tokens:
        t = int(t)
        if t == PAD or t > 255:
            break
        out.append(t)
    return out.decode("utf-8", "replace")


class _Core(nn.Module):
    def __init__(self, d: int, latents: int, think_steps: int, block: int, writer_layers: int, heads: int):
        super().__init__()
        self.compressor = Compressor(d, latents, heads)
        self.thinker = LatentThinker(d, think_steps, heads)
        self.writer = DiffusionWriter(d, block, VOCAB, writer_layers, heads)

    def latents(self, h, pad_mask=None, early_exit=False):
        z, used = self.thinker(self.compressor(h, pad_mask), early_exit=early_exit)
        return z, used

    def loss(self, h, pad_mask, target):
        z, _ = self.latents(h, pad_mask)
        return self.writer.loss(z, target)

    @torch.no_grad()
    def generate(self, h, pad_mask=None, steps: int = 10, early_exit: bool = False):
        z, used = self.latents(h, pad_mask, early_exit)
        return self.writer.generate(z, steps), {"latent_steps_used": used, "latents": z.shape[1]}


class Sham1_TLDM(nn.Module):
    def __init__(self, d: int = 640, layers: int = 8, latents: int = 16, think_steps: int = 5, block: int = 64, writer_layers: int = 3, heads: int = 4, bitnet: bool = False, in_len: int = 64):
        super().__init__()
        self.cfg = dict(d=d, layers=layers, latents=latents, think_steps=think_steps, block=block, writer_layers=writer_layers, heads=heads, bitnet=bitnet, in_len=in_len)
        self.embed = nn.Embedding(VOCAB, d)
        self.reader = nn.ModuleList(MambaBlock(d, bitnet) for _ in range(layers))
        self.norm = nn.LayerNorm(d)
        self.core = _Core(d, latents, think_steps, block, writer_layers, heads)

    def read(self, ids):
        h = self.embed(ids)
        for b in self.reader:
            h = b(h)
        return self.norm(h)

    def loss(self, ids, target):
        return self.core.loss(self.read(ids), ids == PAD, target)

    @torch.no_grad()
    def generate(self, ids, steps: int = 10, early_exit: bool = False):
        return self.core.generate(self.read(ids), ids == PAD, steps, early_exit)

    def count_params(self):
        return sum(p.numel() for p in self.parameters())


class ShamBodyTLDM(nn.Module):
    """`body` is a ShamSmall (usually a COPY of v2). `tokenize(text) -> list[int]` is the body's own text tokenizer; the writer's block is bytes."""

    def __init__(self, body: nn.Module, latents: int = 16, think_steps: int = 5, block: int = 64, writer_layers: int = 3, heads: int = 4, train_adapters: bool = True):
        super().__init__()
        self.body = body
        for p in body.parameters():
            p.requires_grad = False
        d = body.cfg.d_model
        if train_adapters:
            for m in body.modules():
                if hasattr(m, "adapter_down"):
                    m.adapter_down.requires_grad = True
                    m.adapter_up.requires_grad = True
        self._hs: list = []
        body.final_norm.register_forward_hook(lambda mod, inp, out: self._hs.append(out))
        self.core = _Core(d, latents, think_steps, block, writer_layers, heads)
        self.pad_id = getattr(body.cfg, "pad_token_id", None)

    def read(self, ids):
        self._hs.clear()
        self.body(ids)
        return self._hs[-1]

    def loss(self, ids, target, pad_mask=None):
        return self.core.loss(self.read(ids), pad_mask, target)

    @torch.no_grad()
    def generate(self, ids, steps: int = 10, early_exit: bool = False, pad_mask=None):
        return self.core.generate(self.read(ids), pad_mask, steps, early_exit)

    def trainable_report(self) -> dict:
        tot = sum(p.numel() for p in self.parameters())
        tr = sum(p.numel() for p in self.parameters() if p.requires_grad)
        return {"total": tot, "trainable": tr, "trainable_pct": round(100 * tr / tot, 2), "new_head": sum(p.numel() for p in self.core.parameters())}
