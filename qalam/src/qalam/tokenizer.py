"""Byte-fallback BPE: text token ids 0..255 are the raw bytes, 256.. are learned merges. Any text, code or file is representable (no unknown token ever).
Specials and media codes live in their own id ranges (config.py), not in this vocabulary."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers
from tokenizers.pre_tokenizers import ByteLevel

from .config import ModelConfig


def _byte_char_map() -> dict[str, int]:
    """The GPT-2 style byte <-> printable-character table used by ByteLevel: char -> the byte it stands for."""
    bs = list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1)) + list(range(ord("®"), ord("ÿ") + 1))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return {chr(c): b for b, c in zip(bs, cs)}


class QalamTokenizer:
    def __init__(self, tok: Tokenizer, vocab_size: int) -> None:
        self.tok = tok
        self.vocab_size = vocab_size

    # ------------------------------------------------------------------ training
    @classmethod
    def train(cls, texts: Iterable[str], vocab_size: int = 8192) -> "QalamTokenizer":
        if vocab_size < 256 + 16:
            raise ValueError("vocab_size must hold the 256 bytes plus merges")
        tok = Tokenizer(models.BPE())
        tok.pre_tokenizer = pre_tokenizers.Sequence([
            pre_tokenizers.Split(r"""(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+""", "isolated"),
            ByteLevel(add_prefix_space=False, use_regex=False)])
        tok.decoder = decoders.ByteLevel()
        tr = trainers.BpeTrainer(vocab_size=vocab_size, initial_alphabet=ByteLevel.alphabet(), special_tokens=[], show_progress=False)
        tok.train_from_iterator(texts, tr)
        return cls._byte_ids_first(tok, vocab_size)

    @classmethod
    def _byte_ids_first(cls, tok: Tokenizer, vocab_size: int) -> "QalamTokenizer":
        """Relabel so that the token for byte b has id b. Merges refer to token strings, so they do not change."""
        data = json.loads(tok.to_str())
        old = data["model"]["vocab"]
        chars = _byte_char_map()
        new: dict[str, int] = {}
        for ch, b in chars.items():
            if ch not in old:
                raise ValueError("training left a byte token out of the vocabulary")
            new[ch] = b
        rest = sorted((t for t in old if t not in new), key=lambda t: old[t])
        for i, t in enumerate(rest):
            new[t] = 256 + i
        data["model"]["vocab"] = new
        out = Tokenizer.from_str(json.dumps(data))
        return cls(out, len(new))

    # ------------------------------------------------------------------ use
    def encode(self, text: str) -> list[int]:
        return self.tok.encode(text).ids

    def decode(self, ids: list[int]) -> str:
        return self.tok.decode([i for i in ids if 0 <= i < self.vocab_size])

    def save(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.tok.save(str(path))

    @classmethod
    def load(cls, path: str | Path) -> "QalamTokenizer":
        tok = Tokenizer.from_file(str(path))
        return cls(tok, tok.get_vocab_size())

    def check_contract(self, cfg: ModelConfig) -> None:
        if self.vocab_size != cfg.text_vocab:
            raise ValueError(f"tokenizer has {self.vocab_size} tokens, the model's text vocabulary is {cfg.text_vocab}")
        ids = self.tok.get_vocab()
        chars = _byte_char_map()
        if any(ids[ch] != b for ch, b in chars.items()):
            raise ValueError("byte tokens are not ids 0..255")

    def fertility(self, texts: list[str]) -> float:
        """Tokens per byte of UTF-8 text (lower is better); a byte-only tokenizer is 1.0."""
        n = sum(len(self.encode(t)) for t in texts)
        b = sum(len(t.encode("utf-8")) for t in texts)
        return n / max(1, b)
