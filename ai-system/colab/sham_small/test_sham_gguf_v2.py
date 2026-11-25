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

    def _big_model(self):
        # k-quants work on 256-wide blocks: a body whose rows are multiples of 256, so q4_k_m really quantises (not a fallback type)
        from model import ShamSmall, ShamSmallConfig
        torch.manual_seed(3)
        cfg = ShamSmallConfig(vocab_size=512, d_model=256, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=512, max_seq_len=128,
                              qk_norm=True, head_dim=64)
        return ShamSmall(cfg).eval()

    def test_q4_k_m_on_a_small_disk_goes_through_q8_0_not_f16(self):
        """Sham Pro's Studio (2026-11-25): ~5.7 GB free before the export, f16 (4.2 GB) + q4_k_m (1.3 GB) did not fit, so it stayed on q8_0.
        Now Q8_0 is written directly and requantised: no f16 file, the result is q4_k_m, and the Q8_0 file is gone afterwards."""
        import shutil as sh
        import sham_gguf
        model = self._big_model()
        n = sum(p.numel() for p in model.parameters())
        real = sh.disk_usage
        fake_free = int(n * 1.07) + int(n * 0.7) + 200 * 2**20 + int(n * 0.4)      # room for Q8_0 + q4_k_m, NOT for f16 + q4_k_m
        written = []
        orig_write = sham_gguf.write_gguf

        def spy(m, path, dtype="f32"):
            written.append(dtype)
            return orig_write(m, path, dtype)
        sham_gguf.write_gguf = spy
        sham_gguf.shutil.disk_usage = lambda p: type(real(p))(real(p).total, real(p).total - fake_free, fake_free)
        try:
            fm = sham_gguf.fast_model(model, "q4_k_m")
        finally:
            sham_gguf.shutil.disk_usage = real
            sham_gguf.write_gguf = orig_write
        try:
            self.assertIsNotNone(fm)
            self.assertEqual(written, ["q8_0"])
            self.assertEqual(sham_gguf.fast_kind(model), "q4_k_m")
            folder = Path(fm.llm.model_path).parent
            self.assertEqual(sorted(f.name for f in folder.iterdir()), ["sham-q4_k_m.gguf"])
        finally:
            sham_gguf._FAST.pop((id(model), "q4_k_m"), None)
            sh.rmtree(Path(fm.llm.model_path).parent, ignore_errors=True) if fm is not None else None

    def test_stale_export_folders_are_freed_but_a_live_copy_is_kept(self):
        import shutil as sh
        import sham_gguf
        stale = Path(tempfile.mkdtemp(prefix=sham_gguf._TMP_PREFIX))
        (stale / "sham-q8_0.gguf").write_bytes(b"x" * 4096)
        live = Path(tempfile.mkdtemp(prefix=sham_gguf._TMP_PREFIX))
        (live / "sham-q4_k_m.gguf").write_bytes(b"y" * 10)
        try:
            freed = sham_gguf.free_stale_exports(keep=[live / "sham-q4_k_m.gguf"])
            self.assertGreaterEqual(freed, 4096)
            self.assertFalse(stale.exists())
            self.assertTrue(live.exists())
        finally:
            sh.rmtree(stale, ignore_errors=True)
            sh.rmtree(live, ignore_errors=True)

    def test_unsupported_donors_are_refused_not_exported_wrong(self):
        from model import ShamSmall, ShamSmallConfig
        import sham_gguf
        cfg = ShamSmallConfig(vocab_size=500, d_model=128, n_layers=4, n_heads=8, n_kv_heads=4, mlp_hidden=256, max_seq_len=64, qkv_bias=True)
        with self.assertRaises(ValueError):
            sham_gguf.write_gguf(ShamSmall(cfg).eval(), "/tmp/never.gguf", "f16")


class AgreementVerdict(unittest.TestCase):
    """The gate that decides whether a llama.cpp copy is used (no llama.cpp needed). Live 2026-11-25: Sham Pro's q4_k_m agreed on 3/6 top tokens and was refused,
    exactly what the donor's own Q8_0 -> Q4_K_M copy gives on this box (top-5 6/6... 5/6, cosine 0.983); a wrongly wired copy has cosine ~0.5."""

    def _pairs(self, noise: float, shuffle: bool = False, flat: bool = True):
        g = torch.Generator().manual_seed(0)
        refs = [torch.randn(2000, generator=g) * (0.3 if flat else 3.0) for _ in range(6)]
        for r in refs:
            r[torch.randint(0, 2000, (1,), generator=g)] += 4.0          # one clear favourite and a crowd of near-ties behind it
        got = [r + noise * torch.randn(2000, generator=g) for r in refs]
        if shuffle:
            got = got[1:] + got[:1]
        return list(zip(refs, got))

    def test_quantisation_noise_on_flat_logits_keeps_the_k_quant(self):
        from sham_gguf import agreement_verdict
        ok, agree, why = agreement_verdict("q4_k_m", self._pairs(0.05))
        self.assertTrue(ok, why)

    def test_a_wrong_copy_is_refused(self):
        from sham_gguf import agreement_verdict
        ok, _, why = agreement_verdict("q4_k_m", self._pairs(0.05, shuffle=True))
        self.assertFalse(ok, why)
        self.assertFalse(agreement_verdict("q4_k_m", self._pairs(1.5))[0])

    def test_top_token_rule_is_kept_and_8_bit_or_f16_never_use_the_looser_rule(self):
        from sham_gguf import agreement_verdict
        exact = [(r, r.clone()) for r, _ in self._pairs(0.0)]
        self.assertEqual(agreement_verdict("f16", exact)[:2], (True, 6))
        g = torch.Generator().manual_seed(1)
        tied = []
        for _ in range(6):
            r = torch.randn(50, generator=g)
            r[0], r[1] = 5.0, 4.999
            c = r.clone()
            c[0], c[1] = 4.999, 5.0                                          # every top token flips between two near-ties, the function is the same
            tied.append((r, c))
        self.assertTrue(agreement_verdict("q4_k_m", tied)[0])
        self.assertFalse(agreement_verdict("q8_0", tied)[0])
        self.assertFalse(agreement_verdict("f16", tied)[0])


if __name__ == "__main__":
    unittest.main()
