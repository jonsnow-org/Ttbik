"""select_pretrained_tokenizer returns (tokenizer, step, path); motion_job.main used it as the tokenizer and crashed every cycle on `.cfg`
(cn Studio coder-inference-server-3, 2026-11-22). The job must unpack the tuple."""
import re
import unittest
from pathlib import Path

SRC = (Path(__file__).resolve().parents[1] / "lightning" / "motion_job.py").read_text(encoding="utf-8")


class MotionJobTokenizerTuple(unittest.TestCase):
    def test_unpacks_the_selected_tokenizer(self):
        self.assertRegex(SRC, r'picked = select_pretrained_tokenizer\("image"\)')
        self.assertRegex(SRC, r"image_tok = picked\[0\] if picked else None")
        self.assertIsNone(re.search(r'image_tok = select_pretrained_tokenizer\("image"\)', SRC))


if __name__ == "__main__":
    unittest.main()
