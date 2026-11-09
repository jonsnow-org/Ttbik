"""Sham v2's fast path: the donor body (q/k norm, wider heads, adapters) exports to llama.cpp, and the Studio chat loop uses the copy that is already built."""
import tempfile
import unittest
from pathlib import Path

import torch

try:
    import gguf  # noqa: F401
    import llama_cpp  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False


class Tok:
    vocab_size = 400


@unittest.skipUnless(HAVE, "llama-cpp-python / gguf not installed")
class V2FastPath(unittest.TestCase):
    def _model(self):
        from model import ShamSmall, ShamSmallConfig
        torch.manual_seed(2)
        cfg = ShamSmallConfig(vocab_size=500, d_model=128, n_layers=4, n_heads=8, n_kv_heads=4, mlp_hidden=256, max_seq_len=256,
                              qk_norm=True, head_dim=32, adapter_rank=4)
        m = ShamSmall(cfg).eval()
        from sham_gguf import _randomise
        _randomise(m, 5)
        return m

    def test_selftest_bodies(self):
        from sham_gguf import _selftest_donor_bodies
        _selftest_donor_bodies()

    def test_chat_loop_uses_the_built_copy_and_writes_the_same_tokens(self):
        import sham_gguf
        from sham_studio_chat import _roll_tokens
        model = self._model()
        prompt = list(range(10, 40))
        plain = list(_roll_tokens(model, prompt, Tok, 12, end=499, temperature=0.0))
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "v2.gguf"
            sham_gguf.write_gguf(model, p, "f32")
            fast = sham_gguf.LlamaCppModel(p, n_ctx=256, threads=2)
            sham_gguf._FAST[(id(model), "f32")] = fast
            try:
                self.assertIs(sham_gguf.cached_fast(model), fast)
                used = list(_roll_tokens(model, prompt, Tok, 12, end=499, temperature=0.0))
            finally:
                sham_gguf._FAST.pop((id(model), "f32"), None)
        self.assertEqual(plain, used)
        self.assertIsNone(sham_gguf.cached_fast(model))

    def test_unsupported_donors_are_refused_not_exported_wrong(self):
        from model import ShamSmall, ShamSmallConfig
        import sham_gguf
        cfg = ShamSmallConfig(vocab_size=500, d_model=128, n_layers=4, n_heads=8, n_kv_heads=4, mlp_hidden=256, max_seq_len=64, qkv_bias=True)
        with self.assertRaises(ValueError):
            sham_gguf.write_gguf(ShamSmall(cfg).eval(), "/tmp/never.gguf", "f16")


if __name__ == "__main__":
    unittest.main()
