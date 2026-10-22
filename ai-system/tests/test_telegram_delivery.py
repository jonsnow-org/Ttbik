import unittest

from app.telegram_delivery import split_telegram_text


class SplitTelegramTextTests(unittest.TestCase):
    def test_empty_text_returns_no_messages(self):
        self.assertEqual(split_telegram_text(""), [])
        self.assertEqual(split_telegram_text("   \n "), [])

    def test_short_text_is_preserved(self):
        self.assertEqual(split_telegram_text("hello\nworld"), ["hello\nworld"])

    def test_chunks_never_exceed_limit(self):
        text = ("A useful sentence with several words. " * 20).strip()
        chunks = split_telegram_text(text, limit=40)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(0 < len(chunk) <= 40 for chunk in chunks))
        self.assertEqual(" ".join(chunks).split(), text.split())

    def test_prefers_paragraph_or_line_boundaries(self):
        self.assertEqual(split_telegram_text("A" * 12 + "\n" + "B" * 12, limit=15), ["A" * 12, "B" * 12])

    def test_splits_unbroken_text_without_losing_characters(self):
        text = "x" * 55
        chunks = split_telegram_text(text, limit=10)
        self.assertTrue(all(len(chunk) <= 10 for chunk in chunks))
        self.assertEqual("".join(chunks), text)

    def test_rejects_invalid_limit(self):
        with self.assertRaises(ValueError):
            split_telegram_text("hello", limit=0)


if __name__ == "__main__":
    unittest.main()
