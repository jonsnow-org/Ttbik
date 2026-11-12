import tempfile
import unittest
from pathlib import Path

import sham_ar_books as B
import sham_curate as C

PARA = "كان الرجل يمشي في الطريق الطويل وهو يفكر في أمر البلاد والناس، ويتذكر ما قاله له أستاذه عن الصبر والعلم. " * 4


class Books(unittest.TestCase):
    def test_split_docs_sizes_and_boundaries(self):
        text = "\n\n".join([PARA + str(i) for i in range(30)])
        docs = B.split_docs(text)
        self.assertGreaterEqual(len(docs), 2)
        self.assertTrue(all(B.DOC_MIN <= len(d) <= B.DOC_MAX + 600 for d in docs))

    def test_long_paragraph_is_cut(self):
        docs = B.split_docs((PARA.strip() + " ") * 40)
        self.assertTrue(all(len(d) <= B.DOC_MAX + 600 for d in docs))

    def test_build_skips_duplicates_and_writes_attribution(self):
        rows = [
            {"book_id": "1", "title": "ا", "authors": ["x"], "license_quote": "CC BY", "text_raw": "\n\n".join([PARA + str(i) for i in range(20)]), "near_duplicate_group": "g1", "is_translation": False},
            {"book_id": "2", "title": "ب", "authors": ["y"], "license_quote": "CC BY", "text_raw": "\n\n".join([PARA + str(i) for i in range(20)]), "near_duplicate_group": "g1", "is_translation": False},
            {"book_id": "3", "title": "ج", "authors": ["z"], "license_quote": "CC BY", "text_raw": "قصير", "near_duplicate_group": "", "is_translation": True},
        ]
        with tempfile.TemporaryDirectory() as t:
            out = Path(t)
            s = B.build(rows, out, lambda d: C.classify(d)["bucket"] == "ar_prose")
            self.assertEqual(s["books"], 1)
            self.assertEqual(s["skipped_duplicates"], 1)
            self.assertGreater(s["docs"], 0)
            self.assertTrue((out / "ATTRIBUTION.json").exists())
            self.assertIn('"book_id": "1"', (out / "ATTRIBUTION.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
