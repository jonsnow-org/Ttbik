"""Builds sham_general_tokenizer.json: Sham's own 32k byte-level BPE trained on the
general mixture (many languages + code + math), so no language pays a 3x token tax.
Run once: python build_general_tokenizer.py   (needs internet; ~10 min).

The output path is the LIVE tokenizer every checkpoint and notebook depends on, so this
script refuses to overwrite it unless the caller passes --force. Set SHAM_TOKENIZER_OUT to
write somewhere else (e.g. a scratch path) while experimenting. Owner rule (SHAM_GATE.md #1):
never change the tokenizer — that is why a bare run now stops instead of silently clobbering
a 32k vocabulary with whatever the current corpus happens to produce.
"""
import os
import sys
from pathlib import Path

import sham_text_mix
from text_tokenizer import train_text_tokenizer

OUT = Path(os.environ.get("SHAM_TOKENIZER_OUT") or Path(__file__).with_name("sham_general_tokenizer.json"))

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    force = "--force" in sys.argv
    if OUT.exists() and not force and "SHAM_TOKENIZER_OUT" not in os.environ:
        raise SystemExit(
            f"رفضت الكتابة فوق {OUT.name} (المُرمِّز الحيّ الذي تعتمد عليه كل نقاط الحفظ).\n"
            "  للكتابة في مكان آخر:  SHAM_TOKENIZER_OUT=/tmp/sham_tok.json python build_general_tokenizer.py\n"
            "  للكتابة فوق الحالي عن قصد:  python build_general_tokenizer.py --force"
        )
    docs = int(args[0]) if args else 60_000
    files = sham_text_mix.stream_mix("/tmp/sham_tok_corpus", max_documents=docs, seed=12345)
    tok = train_text_tokenizer(files, vocab_size=32000)
    tok.save(str(OUT))
    for s in ["Hello world, how are you?", "مرحباً بك في عالم الذكاء", "def f(x):\n    return x**2", "你好，世界", "∫ x² dx = x³/3 + C"]:
        print(len(s), "chars ->", len(tok.encode(s)), "tokens:", s[:30])
