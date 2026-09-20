"""
Sham — the real text tokenizer. Everything else built so far
(model.py, image_tokenizer.py, audio_tokenizer.py, video_tokenizer.py,
generate.py) assumed TEXT_VOCAB_SIZE=32000 real text-token ids already
exist; until this file, that number had nothing behind it — there was
no actual tool converting Arabic/English text into those ids. This is
the single biggest structural gap identified before this build: no
other component can be trained on real text without it.

Real, standard technique, not a novel/unverified one: byte-level BPE
(Byte-Pair Encoding operating on raw UTF-8 bytes, not characters) —
the same scheme GPT-2/GPT-3/RoBERTa use. The byte-level part matters
specifically for an Arabic-serving product: a BPE built on Unicode
CODE POINTS can hit an [UNK] token on any character absent from its
training data, but byte-level BPE's base alphabet is the 256 possible
byte values, so ANY valid UTF-8 text — Arabic included, regardless of
whether the training corpus had much Arabic in it — always encodes and
decodes exactly, with zero risk of an unknown-token failure. What DOES
depend on the training corpus is efficiency: a corpus without much
Arabic will still round-trip Arabic text correctly, just with more
tokens per sentence than a corpus that had real Arabic coverage to
learn merges from — see train_text_tokenizer()'s own docstring for why
this file's own bootstrap-trained tokenizer is a working proof of the
tool, not yet the production tokenizer.

Ids this tokenizer produces are real text ids in [0, TEXT_VOCAB_SIZE) —
it knows nothing about model.py's BOS/EOS/PAD/IMAGE_START/etc. special
tokens, which deliberately live OUTSIDE this range (see model.py's
SpecialTokens) and are added by the caller when assembling a full
sequence, not emitted by this tokenizer itself.
"""

from pathlib import Path

from tokenizers import Tokenizer, decoders, pre_tokenizers, trainers
from tokenizers.models import BPE

from model import TEXT_VOCAB_SIZE


class ShamTextTokenizer:
    def __init__(self, tokenizer: Tokenizer):
        self._tokenizer = tokenizer

    def encode(self, text: str) -> list[int]:
        ids = self._tokenizer.encode(text).ids
        # A cheap, real safety net: every id this tokenizer ever hands
        # back must fit inside model.py's reserved text range, or it
        # would silently collide with the image/audio/special ranges
        # sitting right above it in the shared vocabulary — the exact
        # class of bug already found and fixed once for the image/audio
        # offset helpers in model.py.
        for token_id in ids:
            if not (0 <= token_id < TEXT_VOCAB_SIZE):
                raise ValueError(f"tokenizer produced id {token_id}, outside the reserved [0, {TEXT_VOCAB_SIZE}) text range")
        return ids

    def decode(self, ids: list[int]) -> str:
        return self._tokenizer.decode(ids)

    @property
    def vocab_size(self) -> int:
        return self._tokenizer.get_vocab_size()

    def save(self, path: str | Path) -> None:
        self._tokenizer.save(str(path))

    @classmethod
    def load(cls, path: str | Path) -> "ShamTextTokenizer":
        return cls(Tokenizer.from_file(str(path)))


def train_text_tokenizer(
    corpus_paths: list[str],
    vocab_size: int = TEXT_VOCAB_SIZE,
    min_frequency: int = 2,
) -> ShamTextTokenizer:
    """Trains a real byte-level BPE tokenizer on the given text files.

    IMPORTANT, honestly stated rather than glossed over: this function
    is complete and correct as a TOOL, but training it here (in this
    sandbox, before the real data-gathering stage) can only be run
    against whatever bootstrap text happens to be available locally —
    a small, mostly-English sample, nowhere near the large, genuinely
    Arabic-heavy corpus this product needs. Running this exact function
    again later, pointed at that real corpus, is how the PRODUCTION
    tokenizer gets built — this file proves the mechanism works and
    gives a real, usable placeholder, not a finished deliverable.
    """
    tokenizer = Tokenizer(BPE(unk_token=None))
    tokenizer.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tokenizer.decoder = decoders.ByteLevel()

    # No reserved special tokens inside the BPE's own vocabulary: every
    # one of the 32,000 slots goes to real byte-pair merges of actual
    # text, since model.py's BOS/EOS/PAD/etc. already live in their own
    # separate reserved range above TEXT_VOCAB_SIZE (see SpecialTokens
    # in model.py) — duplicating them here would waste capacity and
    # create two different ids that both mean "end of sequence."
    trainer = trainers.BpeTrainer(
        vocab_size=vocab_size,
        min_frequency=min_frequency,
        initial_alphabet=pre_tokenizers.ByteLevel.alphabet(),
        special_tokens=[],
    )
    tokenizer.train(corpus_paths, trainer)
    return ShamTextTokenizer(tokenizer)


if __name__ == "__main__":
    import glob
    import tempfile

    # Real bootstrap corpus: every markdown/text file already in this
    # repository — small and mostly English, exactly the "proves the
    # tool, isn't the final tokenizer" caveat in train_text_tokenizer's
    # own docstring above.
    repo_root = Path(__file__).resolve().parents[3]
    corpus_paths = [
        p for p in glob.glob(str(repo_root / "**/*.md"), recursive=True) + glob.glob(str(repo_root / "**/*.txt"), recursive=True)
        if Path(p).stat().st_size > 0
    ]
    assert corpus_paths, f"no bootstrap text found under {repo_root}"
    total_bytes = sum(Path(p).stat().st_size for p in corpus_paths)
    print(f"training on {len(corpus_paths)} real local files, {total_bytes:,} bytes total (a small bootstrap "
          f"corpus, NOT the final production corpus — see this module's own docstring).")

    # A small vocab for this smoke test: 2,370 lines of bootstrap text
    # cannot support 32,000 real merges (BPE needs frequent-enough
    # repeated substrings to merge; a real 32k vocab needs a real
    # large corpus). This proves the tool, and the real 32,000-vocab
    # tokenizer gets (re)trained with the default vocab_size once real
    # training data is gathered — the exact same train_text_tokenizer()
    # call.
    tokenizer = train_text_tokenizer(corpus_paths, vocab_size=4000)
    print(f"trained tokenizer vocab size: {tokenizer.vocab_size}")
    assert tokenizer.vocab_size <= TEXT_VOCAB_SIZE, "tokenizer vocab must fit inside the reserved text range"

    with tempfile.TemporaryDirectory() as tmpdir:
        save_path = Path(tmpdir) / "text_tokenizer.json"
        tokenizer.save(save_path)
        reloaded = ShamTextTokenizer.load(save_path)
        assert reloaded.vocab_size == tokenizer.vocab_size
        print(f"save/load round trip OK: reloaded tokenizer has the same vocab size ({reloaded.vocab_size}).")

    test_strings = [
        "Sham is a real, from-scratch transformer.",
        "هذا اختبار حقيقي للنص العربي، للتأكد أن الترميز وفك الترميز يعملان بشكل صحيح تماماً.",
        "Mixed اختبار text 123 with numbers and punctuation!!! 😀",
        "",  # the empty string is a real edge case worth checking explicitly, not assumed to work
    ]
    for text in test_strings:
        ids = tokenizer.encode(text)
        decoded = tokenizer.decode(ids)
        assert decoded == text, f"round trip failed for {text!r}: got {decoded!r} back (byte-level BPE must be exact)"
        assert all(0 <= i < TEXT_VOCAB_SIZE for i in ids), f"an id in {ids} escaped the reserved text range"
        label = text if text else "(empty string)"
        print(f"round trip OK ({len(ids)} tokens): {label!r}")

    print("\nAll text tokenizer checks passed — real text (Arabic included) encodes and decodes exactly, "
          "with every id inside model.py's reserved [0, TEXT_VOCAB_SIZE) range.")
