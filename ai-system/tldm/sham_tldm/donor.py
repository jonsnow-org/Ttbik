"""DonorTLDM: the model-agnostic T-LDM head on ANY frozen pretrained text encoder (Hugging Face AutoModel path). Sham 2 / Nova later plug in their own body the
same way (ShamBodyTLDM is the ShamSmall-specific twin). Only proj + Compressor + Thinker + Writer train; the donor is frozen and never saved with the head."""
from __future__ import annotations

import torch
import torch.nn as nn

from .model import _Core


class FeatureTLDM(nn.Module):
    """The head on PRE-COMPUTED reader features (B, L, d_in) of any frozen body: proj + Compressor + Thinker + Writer. Used when the body is too big to run at every
    training step on a CPU (Sham 2, 1.7B): each text goes through the body once, its features are kept, and only this head trains."""

    def __init__(self, d_in: int, d: int = 256, latents: int = 16, think_steps: int = 5, block: int = 32, writer_layers: int = 3, heads: int = 4, vocab: int = 257,
                 think_exit: str = "change", think_min_steps: int = 2):
        super().__init__()
        self.proj = nn.Linear(d_in, d)
        self.core = _Core(d, latents, think_steps, block, writer_layers, heads, vocab, think_exit, think_min_steps)

    def loss(self, h, pad, target):
        return self.core.loss(self.proj(h), pad, target)

    @torch.no_grad()
    def generate(self, h, pad, steps: int = 10, early_exit: bool = False, temperature: float = 0.0, confident: float = 0.0):
        return self.core.generate(self.proj(h), pad, steps, early_exit, temperature, confident)

    def count_params(self):
        return sum(p.numel() for p in self.parameters())


class DonorTLDM(nn.Module):
    def __init__(self, donor_path: str, d: int = 256, latents: int = 16, think_steps: int = 5, block: int = 24, writer_layers: int = 3, heads: int = 4, vocab: int = 257,
                 in_len: int = 32, think_exit: str = "change", think_min_steps: int = 2):
        super().__init__()
        from transformers import AutoModel, AutoTokenizer
        self.dtok = AutoTokenizer.from_pretrained(donor_path)
        self.donor = AutoModel.from_pretrained(donor_path).eval()
        for p in self.donor.parameters():
            p.requires_grad = False
        self.in_len = in_len
        self.proj = nn.Linear(self.donor.config.hidden_size, d)
        self.core = _Core(d, latents, think_steps, block, writer_layers, heads, vocab, think_exit, think_min_steps)
        self._cache: dict = {}

    def train(self, mode: bool = True):
        super().train(mode)
        self.donor.eval()                                            # frozen: no dropout in the donor
        return self

    @torch.no_grad()
    def _feats(self, texts):
        miss = [t for t in dict.fromkeys(texts) if t not in self._cache]
        if miss:
            enc = self.dtok(miss, padding="max_length", truncation=True, max_length=self.in_len, return_tensors="pt")
            h = self.donor(**enc).last_hidden_state
            for i, t in enumerate(miss):
                self._cache[t] = (h[i], enc["attention_mask"][i] == 0)
            if len(self._cache) > 50000:
                self._cache.clear()
        return torch.stack([self._cache[t][0] for t in texts]), torch.stack([self._cache[t][1] for t in texts])

    def loss(self, texts, target):
        h, pad = self._feats(texts)
        return self.core.loss(self.proj(h), pad, target)

    @torch.no_grad()
    def generate(self, texts, steps: int = 10, early_exit: bool = False, temperature: float = 0.0, confident: float = 0.0):
        h, pad = self._feats(texts)
        return self.core.generate(self.proj(h), pad, steps, early_exit, temperature, confident)

    def head_state(self):
        return {k: v for k, v in self.state_dict().items() if not k.startswith("donor.")}

    def count_params(self):
        return sum(p.numel() for n, p in self.named_parameters() if not n.startswith("donor."))
