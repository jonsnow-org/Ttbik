import tempfile
import unittest
from pathlib import Path

import dataset


class _Tok:
    def encode(self, text):
        return [7 for _ in text.split()]


class DocBoundaries(unittest.TestCase):
    def test_blank_line_separated_documents_each_end_in_eos(self):
        with tempfile.TemporaryDirectory() as t:
            f = Path(t) / "a.txt"
            f.write_text("one two\nthree\n\nfour five\n\nsix\n", encoding="utf-8")
            ds = dataset.TextSequenceDataset([str(f)], _Tok(), seq_len=1)
            flat = [x for c in ds.chunks for x in c]
            self.assertEqual(flat.count(dataset.SpecialTokens.EOS), 3)

    def test_file_without_blank_lines_is_one_document(self):
        with tempfile.TemporaryDirectory() as t:
            f = Path(t) / "b.txt"
            f.write_text("one two\nthree four\nfive six\n", encoding="utf-8")
            ds = dataset.TextSequenceDataset([str(f)], _Tok(), seq_len=1)
            flat = [x for c in ds.chunks for x in c]
            self.assertEqual(flat.count(dataset.SpecialTokens.EOS), 1)


if __name__ == "__main__":
    unittest.main()
