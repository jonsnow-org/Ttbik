"""The script guard: no token of a script absent from the conversation is sampled (live 2026-11-11: «العاصمة của سوريا»)."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sham_studio_chat as chat


class Tok:
    vocab = ["مرحبا", " của", " hello", "中文", " Привет", "دمشق", "<|im_end|>"]
    vocab_size = len(vocab)

    def decode(self, ids):
        return "".join(self.vocab[i] for i in ids)


def test_banned_scripts_follow_the_conversation():
    os.environ.pop("SHAM_SCRIPT_GUARD", None)
    chat._SCRIPT_TOKENS.clear()
    tok = Tok()
    banned = set(chat.script_banned_ids(tok, ["ما هي عاصمة سوريا؟"]))
    assert {1, 3, 4} <= banned and not banned & {0, 2, 5, 6}
    assert 3 not in chat.script_banned_ids(tok, ["ترجم إلى الصينية: 中文"])            # the user wrote it: allowed
    assert 1 not in chat.script_banned_ids(tok, ["dịch: của"])
    os.environ["SHAM_SCRIPT_GUARD"] = "0"
    try:
        assert chat.script_banned_ids(tok, ["مرحبا"]) == []
    finally:
        os.environ.pop("SHAM_SCRIPT_GUARD", None)


def test_message_texts_reads_string_and_part_lists():
    assert chat._message_texts([{"role": "user", "content": "أ"}, {"role": "user", "content": [{"type": "text", "text": "ب"}]}]) == ["أ", "ب"]


def test_iter_tokens_never_samples_a_banned_id():
    import torch
    from model import ShamSmall, ShamSmallConfig
    from sham_stream import iter_tokens
    torch.manual_seed(0)
    m = ShamSmall(ShamSmallConfig(vocab_size=64, d_model=16, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=32, max_seq_len=64)).eval()
    banned = list(range(0, 60))
    got = list(iter_tokens(m, [1, 2, 3], 20, temperature=1.0, top_k=None, top_p=None, text_vocab=64, banned_ids=banned, no_repeat_ngram=0))
    assert got and not set(got) & set(banned), got
