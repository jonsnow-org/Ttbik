"""qwen3_chat_stream sends the WHOLE answer: the held-back last token is flushed when the model stops (live 2026-11-25: «17 × 3 = 5» for 51)."""
from __future__ import annotations

import sham_studio_chat as sc


class Tok:
    vocab_size = 100
    _m = {1: "17", 2: " × ", 3: "3", 4: " = ", 5: "5", 6: "1"}

    def encode(self, text):
        return [99] if text == "<|im_end|>" else [0]

    def decode(self, ids):
        return "".join(self._m.get(i, "") for i in ids)


def _run(tokens, monkeypatch):
    monkeypatch.setattr(sc, "_qwen3_messages_prompt_ids", lambda tok, msgs, n: [0])
    monkeypatch.setattr(sc, "_roll_tokens", lambda *a, **k: iter(tokens))
    monkeypatch.setattr(sc, "script_banned_ids", lambda *a, **k: [])
    return "".join(sc.qwen3_chat_stream(object(), Tok(), [{"role": "user", "content": "كم يساوي 17 ضرب 3؟"}], 16))


def test_last_token_flushed_on_end_token(monkeypatch):
    assert _run([1, 2, 3, 4, 5, 6, 99], monkeypatch) == "17 × 3 = 51"


def test_last_token_flushed_when_budget_ends(monkeypatch):
    assert _run([1, 2, 3, 4, 5, 6], monkeypatch) == "17 × 3 = 51"


def test_pieces_are_deltas_never_repeated(monkeypatch):
    monkeypatch.setattr(sc, "_qwen3_messages_prompt_ids", lambda tok, msgs, n: [0])
    monkeypatch.setattr(sc, "_roll_tokens", lambda *a, **k: iter([1, 2, 3, 99]))
    monkeypatch.setattr(sc, "script_banned_ids", lambda *a, **k: [])
    pieces = list(sc.qwen3_chat_stream(object(), Tok(), [{"role": "user", "content": "x"}], 8))
    assert pieces == ["17", " × ", "3"]
