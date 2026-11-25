"""qwen3_chat_stream sends the WHOLE answer: the held-back last token is flushed when the model stops (live 2026-11-25: «17 × 3 = 5» for 51)."""
from __future__ import annotations

import unittest
from unittest import mock

import sham_studio_chat as sc


class Tok:
    vocab_size = 100
    _m = {1: "17", 2: " × ", 3: "3", 4: " = ", 5: "5", 6: "1"}

    def encode(self, text):
        return [99] if text == "<|im_end|>" else [0]

    def decode(self, ids):
        return "".join(self._m.get(i, "") for i in ids)


def pieces(tokens):
    with mock.patch.object(sc, "_qwen3_messages_prompt_ids", lambda tok, msgs, n: [0]), \
         mock.patch.object(sc, "_roll_tokens", lambda *a, **k: iter(tokens)), \
         mock.patch.object(sc, "script_banned_ids", lambda *a, **k: []):
        return list(sc.qwen3_chat_stream(object(), Tok(), [{"role": "user", "content": "كم يساوي 17 ضرب 3؟"}], 16))


class StreamFlush(unittest.TestCase):
    def test_last_token_flushed_on_end_token(self):
        self.assertEqual("".join(pieces([1, 2, 3, 4, 5, 6, 99])), "17 × 3 = 51")

    def test_last_token_flushed_when_budget_ends(self):
        self.assertEqual("".join(pieces([1, 2, 3, 4, 5, 6])), "17 × 3 = 51")

    def test_pieces_are_deltas_never_repeated(self):
        self.assertEqual(pieces([1, 2, 3, 99]), ["17", " × ", "3"])


if __name__ == "__main__":
    unittest.main()
