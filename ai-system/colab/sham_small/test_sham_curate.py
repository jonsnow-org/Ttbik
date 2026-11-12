import tempfile
import unittest
from pathlib import Path

import sham_curate as C

AR = "هذه فقرة عربية طويلة تشرح موضوعاً علمياً بأسلوب واضح ومفهوم للقارئ، وتحتوي جملاً كاملة وكلمات متنوعة بما يكفي لتكون نصاً صالحاً للتدريب. " * 3
EN = "This is a long English paragraph explaining a scientific topic in clear prose with complete sentences and varied vocabulary for training. " * 3
CODE = "import os\n\ndef run(x):\n    if x > 1:\n        return x * 2\n    return 0\n\nclass A:\n    def f(self):\n        return 1\n\nfor i in range(3):\n    print(i);\n" * 2


class Curate(unittest.TestCase):
    def test_language_and_kind(self):
        self.assertEqual(C.classify(AR)["bucket"], "ar_prose")
        self.assertEqual(C.classify(EN)["bucket"], "latin_prose")
        self.assertEqual(C.classify(CODE)["bucket"], "code")

    def test_rejects(self):
        self.assertEqual(C.classify("قصير")["reject"], "too_short")
        self.assertEqual(C.classify("1234 5678 " * 60)["reject"], "mostly_digits")
        self.assertEqual(C.classify("a" * 300)["reject"], "char_run")
        self.assertEqual(C.classify("\n".join(["https://x.example/a"] * 12))["reject"], "link_list")
        self.assertEqual(C.classify(("same line here\n" * 8) + EN[:150])["reject"], "repeated_lines")

    def test_pipeline_dedupes_and_holds_out(self):
        with tempfile.TemporaryDirectory() as t:
            src, out = Path(t) / "in", Path(t) / "out"
            (src / "text").mkdir(parents=True)
            docs = [AR + str(i) * 5 for i in range(300)] + [EN]
            (src / "text" / "a.txt").write_text("\n\n".join(docs + [docs[0], "قصير"]) + "\n\n", encoding="utf-8")
            s = C.curate(src, out)
            self.assertEqual(s["duplicates"], 1)
            self.assertEqual(s["rejects"].get("too_short"), 1)
            self.assertGreater(s["buckets"]["heldout"]["docs"], 0)
            self.assertLess(s["buckets"]["heldout"]["docs"], 15)
            self.assertEqual(sum(b["docs"] for b in s["buckets"].values()), 301)
            held = "".join(p.read_text(encoding="utf-8") for p in (out / "heldout").rglob("*.txt"))
            train = "".join(p.read_text(encoding="utf-8") for p in (out / "ar_prose").rglob("*.txt"))
            first_held = held.split("\n\n")[0]
            self.assertNotIn(first_held, train)


if __name__ == "__main__":
    unittest.main()
