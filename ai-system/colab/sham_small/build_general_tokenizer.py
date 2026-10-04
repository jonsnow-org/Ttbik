"""Builds sham_general_tokenizer.json: Sham's own 32k byte-level BPE trained on the
general mixture (many languages + code + math), so no language pays a 3x token tax.
Run once: python build_general_tokenizer.py   (needs internet; ~10 min)."""
import sys
from pathlib import Path

import sham_text_mix
from text_tokenizer import train_text_tokenizer

OUT = Path(__file__).with_name("sham_general_tokenizer.json")

if __name__ == "__main__":
    docs = int(sys.argv[1]) if len(sys.argv) > 1 else 60_000
    files = sham_text_mix.stream_mix("/tmp/sham_tok_corpus", max_documents=docs, seed=12345)
    tok = train_text_tokenizer(files, vocab_size=32000)
    tok.save(str(OUT))
    for s in ["Hello world, how are you?", "مرحباً بك في عالم الذكاء", "def f(x):\n    return x**2", "你好，世界", "∫ x² dx = x³/3 + C"]:
        print(len(s), "chars ->", len(tok.encode(s)), "tokens:", s[:30])
