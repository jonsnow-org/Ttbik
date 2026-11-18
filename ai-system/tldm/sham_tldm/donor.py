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


def _donor_vocab_size(tok) -> int | None:
    n = getattr(tok, "vocab_size", None)
    if isinstance(n, int):
        return n
    get = getattr(tok, "get_vocab", None)
    if callable(get):
        try:
            return len(get())
        except Exception:
            return None
    return None


def check_donor_tokenizer(tok, texts=("list files", "what is the date", "اعرض كل الملفات")):
    """Fail if AutoTokenizer fell back because tokenizer.json / sentencepiece was missing (every token UNK on a large vocab).
    Tiny Bert unit-test tokenizers (vocab < 10k, letters only) are allowed to UNK these phrases."""
    special = {i for i in (
        getattr(tok, "pad_token_id", None), getattr(tok, "cls_token_id", None),
        getattr(tok, "sep_token_id", None), getattr(tok, "bos_token_id", None),
        getattr(tok, "eos_token_id", None), getattr(tok, "unk_token_id", None),
    ) if i is not None}
    unk = getattr(tok, "unk_token_id", None)
    vocab_size = _donor_vocab_size(tok)
    # MiniLM / XLM-R have ~250k tokens; a silent Bert fallback and a mocked all-UNK tok have no/large vocab and must be refused.
    strict = vocab_size is None or vocab_size >= 10_000
    encs = []
    for text in texts:
        ids = list(tok(text, add_special_tokens=True)["input_ids"])
        encs.append(ids)
        content = [i for i in ids if i not in special]
        if strict and (not content or (unk is not None and all(i == unk for i in content))):
            raise RuntimeError(
                f"donor tokenizer at {getattr(tok, 'name_or_path', '?')} encoded {text!r} as {ids} "
                f"(almost all UNK). tokenizer.json / sentencepiece is missing and AutoTokenizer silently fell back; "
                f"refusing to train a head on unusable reader features"
            )
    if strict and len({tuple(e) for e in encs}) < 2:
        raise RuntimeError(
            f"donor tokenizer encoded distinct texts identically ({encs[0]}); refusing to train"
        )
    return encs


def check_donor_features(model, tok, texts=("list files", "what is the date", "اعرض كل الملفات")):
    """Tiny sanity eval of the frozen reader: two different texts must not produce nearly identical features."""
    import torch
    enc = tok(list(texts), padding=True, truncation=True, max_length=32, return_tensors="pt")
    with torch.no_grad():
        h = model(**enc).last_hidden_state
        mask = enc["attention_mask"].unsqueeze(-1)
        pooled = (h * mask).sum(1) / mask.sum(1).clamp(min=1)
        pooled = torch.nn.functional.normalize(pooled, dim=-1)
    sim = (pooled @ pooled.T)
    off = [float(sim[i, j]) for i in range(len(texts)) for j in range(i + 1, len(texts))]
    if off and min(off) > 0.99:
        raise RuntimeError(
            f"donor reader features are collapsed (cosine {off}); a missing tokenizer or a random encoder would score at the floor"
        )
    return off


def load_frozen_encoder(donor_path: str):
    """Load a pretrained AutoModel reader. Raises if embeddings/encoder weights were not actually loaded,
    or if the tokenizer is a silent BertTokenizer fallback (missing tokenizer.json / sentencepiece)."""
    from pathlib import Path as _Path
    from transformers import AutoModel, AutoTokenizer
    root = _Path(donor_path)
    has_tok = any((root / n).is_file() and (root / n).stat().st_size > 0 for n in (
        "tokenizer.json", "sentencepiece.bpe.model", "vocab.txt", "spiece.model",
    ))
    if root.is_dir() and not has_tok:
        raise RuntimeError(
            f"donor reader at {donor_path} has no tokenizer.json / sentencepiece / vocab.txt; "
            "AutoTokenizer would silently fall back to BertTokenizer and every text would become UNK"
        )
    tok = AutoTokenizer.from_pretrained(donor_path)
    check_donor_tokenizer(tok)
    model, info = AutoModel.from_pretrained(donor_path, output_loading_info=True)
    missing = list((info or {}).get("missing_keys") or [])
    bad = [k for k in missing if k.startswith("embeddings.") or k.startswith("encoder.") or ".embeddings." in k or ".encoder." in k]
    if bad:
        raise RuntimeError(
            f"donor reader at {donor_path} is missing pretrained embeddings/encoder weights "
            f"({len(bad)} keys, e.g. {bad[:6]}); refusing to train a head on a randomly initialized reader"
        )
    model = model.eval()
    for p in model.parameters():
        p.requires_grad = False
    check_donor_features(model, tok)
    return tok, model


class DonorTLDM(nn.Module):
    def __init__(self, donor_path: str, d: int = 256, latents: int = 16, think_steps: int = 5, block: int = 24, writer_layers: int = 3, heads: int = 4, vocab: int = 257,
                 in_len: int = 32, think_exit: str = "change", think_min_steps: int = 2):
        super().__init__()
        self.dtok, self.donor = load_frozen_encoder(donor_path)
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
