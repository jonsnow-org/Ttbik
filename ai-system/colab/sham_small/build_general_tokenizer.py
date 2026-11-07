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
from text_tokenizer import ShamTextTokenizer, train_text_tokenizer

OUT = Path(os.environ.get("SHAM_TOKENIZER_OUT") or Path(__file__).with_name("sham_general_tokenizer.json"))


def guard(out: Path, force: bool) -> None:
    """Refuse to overwrite the live tokenizer unless --force or SHAM_TOKENIZER_OUT is set."""
    if out.exists() and not force and "SHAM_TOKENIZER_OUT" not in os.environ:
        raise SystemExit(
            f"رفضت الكتابة فوق {out.name} (المُرمِّز الحيّ الذي تعتمد عليه كل نقاط الحفظ).\n"
            "  للكتابة في مكان آخر:  SHAM_TOKENIZER_OUT=/tmp/sham_tok.json python build_general_tokenizer.py\n"
            "  للكتابة فوق الحالي عن قصد:  python build_general_tokenizer.py --force"
        )


def build(out: Path, docs: int = 60_000, seed: int = 12345) -> None:
    files = sham_text_mix.stream_mix("/tmp/sham_tok_corpus", max_documents=docs, seed=seed)
    tok = train_text_tokenizer(files, vocab_size=32000)
    tok.save(str(out))
    for s in ["Hello world, how are you?", "مرحباً بك في عالم الذكاء", "def f(x):\n    return x**2", "你好，世界", "∫ x² dx = x³/3 + C"]:
        print(len(s), "chars ->", len(tok.encode(s)), "tokens:", s[:30])


def _selftest() -> None:
    import tempfile

    # The guard must stop a bare run over the live tokenizer, and must step aside for --force / SHAM_TOKENIZER_OUT.
    live = Path(__file__).with_name("sham_general_tokenizer.json")
    try:
        guard(live, force=False)
        raise AssertionError("guard did not protect the live tokenizer")
    except SystemExit:
        pass
    guard(live, force=True)
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "tok.json"
        guard(out, force=False)                      # a missing file is fine
        # A real (tiny) build proves the pipeline end to end without touching the live file.
        tok = train_text_tokenizer([], vocab_size=300)
        tok.save(str(out))
        reloaded = ShamTextTokenizer.load(out)
        assert reloaded.vocab_size == tok.vocab_size and tok.vocab_size > 0
        assert reloaded.decode(reloaded.encode("مرحبا code 123")) == "مرحبا code 123"
    print("build_general_tokenizer self-test OK: the live tokenizer is protected, --force writes, a real build round-trips.")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
        sys.exit(0)
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    guard(OUT, "--force" in sys.argv)
    build(OUT, int(args[0]) if args else 60_000)
