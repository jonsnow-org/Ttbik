"""A model that fills most of the box's memory is locked in RAM (--load-mode mmap+mlock); a small one keeps the default loading; the env overrides.
Run: python -m unittest ai-system/modelscope-coder/tests/test_load_mode.py"""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ["CODER_MODEL_PATH"] = "/nonexistent"
spec = importlib.util.spec_from_file_location("coder_app_lm", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

TOTAL_KB = 16 * 1024 * 1024        # a 16 GiB box


class LoadMode(unittest.TestCase):
    def model(self, gib):
        d = tempfile.mkdtemp()
        p = Path(d) / "m.gguf"
        with open(p, "wb") as f:
            f.truncate(int(gib * 2 ** 30))        # sparse: no real disk use
        return p

    def mode(self, gib, env=None):
        real_open = open

        def fake_open(path, *a, **k):
            if path == "/proc/meminfo":
                import io
                return io.StringIO(f"MemTotal:       {TOTAL_KB} kB\n")
            return real_open(path, *a, **k)
        with mock.patch.dict(os.environ, env or {}, clear=False), mock.patch("builtins.open", fake_open):
            if not env:
                os.environ.pop("CODER_LOAD_MODE", None)
            return app._load_mode(self.model(gib))

    def test_big_model_is_locked(self):
        self.assertEqual(self.mode(12.3), "mmap+mlock")

    def test_small_model_keeps_default(self):
        self.assertEqual(self.mode(2.7), "")

    def test_refused_mlock_goes_plain_mmap(self):
        app._LOCK["refused"] = True
        try:
            self.assertEqual(self.mode(12.3), "")
        finally:
            app._LOCK["refused"] = False

    def test_env_overrides(self):
        self.assertEqual(self.mode(2.7, {"CODER_LOAD_MODE": "none"}), "none")
        self.assertEqual(self.mode(12.3, {"CODER_LOAD_MODE": "off"}), "")


class CacheBudget(unittest.TestCase):
    """The 35B (12.3 GiB on a 16 GiB box) gets a small RAM prompt cache and fewer checkpoints so its weights stay resident (live 2026-11-25: ~1 GiB evicted)."""
    def budget(self, gib, env=None):
        lm = LoadMode()
        real_open = open

        def fake_open(path, *a, **k):
            if path == "/proc/meminfo":
                import io
                return io.StringIO(f"MemTotal:       {TOTAL_KB} kB\n")
            return real_open(path, *a, **k)
        m = lm.model(gib)
        with mock.patch.dict(os.environ, env or {}, clear=False), mock.patch("builtins.open", fake_open):
            if not env:
                os.environ.pop("CODER_CACHE_RAM_MB", None)
                os.environ.pop("CODER_CTX_CHECKPOINTS", None)
            return app._cache_budget(m)

    def test_big_model_keeps_measured_values(self):
        self.assertEqual(self.budget(12.3), ("1024", "8"))           # reverted: 256 / 4 measured slower live (2026-11-25)

    def test_small_model_keeps_old_values(self):
        self.assertEqual(self.budget(2.7), ("1024", "8"))

    def test_env_overrides(self):
        self.assertEqual(self.budget(12.3, {"CODER_CACHE_RAM_MB": "256", "CODER_CTX_CHECKPOINTS": "4"}), ("256", "4"))


if __name__ == "__main__":
    unittest.main()
