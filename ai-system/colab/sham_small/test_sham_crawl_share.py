"""The collectors' text reaches both Shams' training mixes (it was 3.5% of v1's reading and absent from v2's)."""
import os
import random
import tempfile
import unittest
from pathlib import Path


class Tok:
    def encode(self, text):
        return [hash(w) % 1000 for w in text.split()]


class CrawlShare(unittest.TestCase):
    def test_v1_stream_weight_default_and_switch(self):
        import sham_text_stream as S
        os.environ.pop("SHAM_CRAWL_WEIGHT", None)
        os.environ.pop("SHAM_NO_CRAWL_CORPORA", None)
        st = S.Stream(Tok(), fake=True)
        w = {s[0]: s[4] for s in st.sources}
        self.assertEqual(w["crawl-corpora"], 14)
        total = sum(w.values())
        self.assertGreater(w["crawl-corpora"] / total, 0.08)
        st.stop.set()
        os.environ["SHAM_CRAWL_WEIGHT"] = "0"
        try:
            st0 = S.Stream(Tok(), fake=True)
            self.assertNotIn("crawl-corpora", {s[0] for s in st0.sources})
            st0.stop.set()
        finally:
            os.environ.pop("SHAM_CRAWL_WEIGHT", None)

    def test_v2_mix_adds_the_collectors_share(self):
        import sham_v2_train as T
        with tempfile.TemporaryDirectory() as td:
            base = Path(td) / "base.txt"
            base.write_text(" ".join(f"b{i}" for i in range(4000)), encoding="utf-8")
            crawl = []
            for i in range(5):
                p = Path(td) / f"c{i}.txt"
                p.write_text(" ".join(f"c{j}" for j in range(3000)), encoding="utf-8")
                crawl.append(str(p))
            no = list(T.text_mix_batches(Tok(), files=[str(base)], crawl=[], share=0.0, window=100, batch_size=1))
            yes = list(T.text_mix_batches(Tok(), files=[str(base)], crawl=crawl, share=0.09, window=100, batch_size=1))
            self.assertGreater(len(yes), len(no))
            self.assertLess(len(yes) - len(no), len(no) * 0.2)      # about 9%, not a takeover
            again = list(T.text_mix_batches(Tok(), files=[str(base)], crawl=[], window=100, batch_size=1))
            self.assertEqual(len(again), len(no))                   # nothing fetched = exactly the old mix


if __name__ == "__main__":
    unittest.main()
