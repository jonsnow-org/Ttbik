"""BoostedSham: an unmodified Sham checkpoint + optional add-ons from sham_boost.modules.

The base ShamSmall object is used as-is (same parameter names, same
state_dict). The add-ons live in a separate module tree and are saved to
their own file (boost_state.pt). fold_in() writes ONE new self-contained
checkpoint (base weights + boost state + boost config) to a NEW path; it
refuses to overwrite final_merged.pt or the source checkpoint.

Load path for the merged file: BoostedSham.from_merged(path). A plain
checkpoint.load_checkpoint() on the same file still works and returns the
base model alone (the boost lives under extra["boost"]).
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

_HERE = Path(__file__).resolve().parent
if str(_HERE.parent) not in sys.path:
    sys.path.insert(0, str(_HERE.parent))

from model import ShamSmall, ShamSmallConfig, apply_rope  # noqa: E402
from sham_boost.modules import (  # noqa: E402
    GatedQKNorm, GatedEmbedAdapter, GatedCrossAttnMemory, GatedMediaBridge, MemoryBank, z_loss,
)

PROTECTED_NAMES = {"final_merged.pt"}


@dataclass
class BoostConfig:
    qk_norm: bool = True
    embed_adapter_ids: list = field(default_factory=list)   # empty = no adapter
    embed_rank: int = 128
    memory_layers: list = field(default_factory=list)       # e.g. [6, 13, 19]
    memory_read_layer: int = -1                             # hidden used to build/query the bank (-1 = middle)
    memory_top_k: int = 4
    memory_probe: int = 64
    media_layers: list = field(default_factory=list)        # e.g. [3, 10]
    media_d_enc: int = 256
    xattn_heads: int = 4

    def to_dict(self):
        return asdict(self)


class BoostedSham(nn.Module):
    def __init__(self, base: ShamSmall, bcfg: BoostConfig):
        super().__init__()
        self.base, self.bcfg = base, bcfg
        cfg = base.cfg
        hd = cfg.d_model // cfg.n_heads
        self.qk = nn.ModuleList(GatedQKNorm(hd) for _ in range(cfg.n_layers)) if bcfg.qk_norm else None
        self.embed = (GatedEmbedAdapter(cfg.vocab_size, cfg.d_model, bcfg.embed_adapter_ids, bcfg.embed_rank)
                      if bcfg.embed_adapter_ids else None)
        self.memory = nn.ModuleDict({str(i): GatedCrossAttnMemory(cfg.d_model, bcfg.xattn_heads, bcfg.memory_top_k,
                                                                  bcfg.memory_probe) for i in bcfg.memory_layers})
        self.media = (GatedMediaBridge(cfg.d_model, bcfg.media_d_enc, bcfg.xattn_heads, n_reads=len(bcfg.media_layers))
                      if bcfg.media_layers else None)
        self._media_at = {int(l): j for j, l in enumerate(bcfg.media_layers)}

    # ---------------------------------------------------------------- params
    def boost_parameters(self):
        return [p for n, p in self.named_parameters() if not n.startswith("base.")]

    def boost_state_dict(self) -> dict:
        return {k: v for k, v in self.state_dict().items() if not k.startswith("base.")}

    def gates(self) -> dict:
        return {n: float(torch.tanh(p)) for n, p in self.named_parameters() if n.endswith("gate")}

    def set_memory_bank(self, bank: MemoryBank) -> None:
        for m in self.memory.values():
            m.bank = bank

    # --------------------------------------------------------------- forward
    def _attn(self, layer_idx, attn, x, cos, sin, mask):
        B, T, _ = x.shape
        q = attn.q_proj(x).view(B, T, attn.n_heads, attn.head_dim).transpose(1, 2)
        k = attn.k_proj(x).view(B, T, attn.n_kv_heads, attn.head_dim).transpose(1, 2)
        v = attn.v_proj(x).view(B, T, attn.n_kv_heads, attn.head_dim).transpose(1, 2)
        if self.qk is not None:
            q, k = self.qk[layer_idx](q, k)
        q, k = apply_rope(q, cos[:T], sin[:T]), apply_rope(k, cos[:T], sin[:T])
        if attn.n_rep > 1:
            k, v = k.repeat_interleave(attn.n_rep, dim=1), v.repeat_interleave(attn.n_rep, dim=1)
        if mask is None:
            out = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        else:
            out = F.scaled_dot_product_attention(q, k, v, attn_mask=mask)
        return attn.o_proj(out.transpose(1, 2).contiguous().view(B, T, -1))

    def hidden_states(self, input_ids, doc_mask=None, media_slots=None, upto: int | None = None):
        base = self.base
        x = base.token_embedding(input_ids)
        if self.embed is not None:
            x = self.embed(input_ids, x)
        cos, sin = base.rope_cos.to(x.device), base.rope_sin.to(x.device)
        for i, layer in enumerate(base.layers):
            plain = doc_mask is None and (self.qk is None or (self.qk[i].is_closed() and not torch.is_grad_enabled()))
            if plain:
                x, _ = layer(x, cos, sin)          # exact original path
            else:
                x = x + self._attn(i, layer.attention, layer.input_norm(x), cos, sin, doc_mask)
                x = x + layer.mlp(layer.post_attention_norm(x))
            if str(i) in self.memory:
                x = self.memory[str(i)](x)
            if self.media is not None and i in self._media_at and media_slots is not None:
                x = self.media.reads[self._media_at[i]](x, media_slots)
            if upto is not None and i == upto:
                return x
        return x

    def forward(self, input_ids, labels=None, doc_mask=None, media=None, z_weight: float = 0.0):
        media_slots = self.media.encode(**media) if (self.media is not None and media) else None
        x = self.base.final_norm(self.hidden_states(input_ids, doc_mask, media_slots))
        logits = self.base.lm_head(x) * self.base.cfg.output_mult
        loss = None
        if labels is not None:
            sl, sy = logits[:, :-1], labels[:, 1:]
            loss = F.cross_entropy(sl.reshape(-1, sl.size(-1)), sy.reshape(-1), ignore_index=-100)
            if z_weight > 0:
                loss = loss + z_loss(sl, z_weight, (sy != -100).float())
        return logits, loss

    # ------------------------------------------------------------- memory
    def read_layer(self) -> int:
        r = self.bcfg.memory_read_layer
        return self.base.cfg.n_layers // 2 if r < 0 else r

    @torch.no_grad()
    def build_memory(self, chunks: list[torch.Tensor], segments: int = 8) -> MemoryBank:
        """Bank from Sham's own hidden states (add-ons excluded, so the bank
        does not drift while the gates train)."""
        L = self.read_layer()
        base = self.base

        def hidden(ids):
            x = base.token_embedding(ids)
            cos, sin = base.rope_cos, base.rope_sin
            for i, layer in enumerate(base.layers):
                x, _ = layer(x, cos, sin)
                if i == L:
                    break
            return x
        return MemoryBank.build(hidden, chunks, segments)

    # ------------------------------------------------------------ load/save
    @classmethod
    def from_checkpoint(cls, ckpt: str | Path, boost_state: str | Path | None = None,
                        bcfg: BoostConfig | None = None, map_location="cpu") -> "BoostedSham":
        payload = torch.load(ckpt, map_location=map_location, weights_only=False)
        base = ShamSmall(ShamSmallConfig.from_dict(payload["config"]))
        base.load_state_dict(payload["model_state_dict"])
        bs = torch.load(boost_state, map_location=map_location, weights_only=False) if boost_state else None
        if bcfg is None:
            bcfg = BoostConfig(**bs["config"]) if bs else BoostConfig()
        m = cls(base, bcfg)
        m.step = payload.get("step", 0)
        if bs:
            m.load_state_dict({**{"base." + k: v for k, v in base.state_dict().items()}, **bs["state"]})
        return m

    def save_boost(self, path: str | Path, extra: dict | None = None) -> None:
        torch.save({"config": self.bcfg.to_dict(), "state": self.boost_state_dict(),
                    "gates": self.gates(), "extra": extra or {}}, path)

    def fold_in(self, out_path: str | Path, step: int | None = None, source: str | Path | None = None) -> Path:
        out = Path(out_path)
        if out.name in PROTECTED_NAMES or (source and out.resolve() == Path(source).resolve()):
            raise ValueError(f"refusing to overwrite {out} — fold_in always writes a NEW file")
        out.parent.mkdir(parents=True, exist_ok=True)
        torch.save({
            "config": self.base.cfg.to_dict(),
            "step": int(step if step is not None else getattr(self, "step", 0)),
            "model_state_dict": self.base.state_dict(),
            "extra": {"boost": {"config": self.bcfg.to_dict(), "state": self.boost_state_dict(),
                                "gates": self.gates()}},
        }, out)
        return out

    @classmethod
    def from_merged(cls, path: str | Path, map_location="cpu") -> "BoostedSham":
        payload = torch.load(path, map_location=map_location, weights_only=False)
        base = ShamSmall(ShamSmallConfig.from_dict(payload["config"]))
        base.load_state_dict(payload["model_state_dict"])
        b = payload.get("extra", {}).get("boost")
        m = cls(base, BoostConfig(**b["config"]) if b else BoostConfig(qk_norm=False))
        if b:
            m.load_state_dict({**{"base." + k: v for k, v in base.state_dict().items()}, **b["state"]})
        m.step = payload.get("step", 0)
        return m
