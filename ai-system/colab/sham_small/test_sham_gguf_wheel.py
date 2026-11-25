"""The llama-cpp-python wheel is taken from the model's own ModelScope repo first (the cn Studio times out on GitHub release assets)."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sham_gguf  # noqa: E402

TAG = "cp%d%d" % sys.version_info[:2]


class HubWheel(unittest.TestCase):
    def setUp(self):
        self.old = os.environ.get("SHAM_GGUF_WHEEL")
        os.environ["SHAM_GGUF_WHEEL"] = f"runtime_wheels/llama_cpp_python-0.3.19-{TAG}-{TAG}-linux_x86_64.whl"

    def tearDown(self):
        if self.old is None:
            os.environ.pop("SHAM_GGUF_WHEEL", None)
        else:
            os.environ["SHAM_GGUF_WHEEL"] = self.old

    def test_mirrored_wheel_is_used(self):
        d = tempfile.mkdtemp()
        asked = []

        def dl(repo, name):
            asked.append((repo, name))
            p = os.path.join(d, os.path.basename(name))
            open(p, "wb").write(b"w")
            return p
        got = sham_gguf.hub_wheel("novaai2026/sham-v2", download=dl)
        self.assertTrue(got and got.endswith(".whl") and os.path.isfile(got))
        self.assertEqual(asked, [("novaai2026/sham-v2", os.environ["SHAM_GGUF_WHEEL"])])

    def test_missing_wheel_or_repo_falls_back(self):
        def dl(repo, name):
            raise FileNotFoundError(name)
        self.assertIsNone(sham_gguf.hub_wheel("novaai2026/sham-v2", download=dl))
        self.assertIsNone(sham_gguf.hub_wheel("", download=dl))

    def test_other_python_is_not_offered_the_wheel(self):
        os.environ["SHAM_GGUF_WHEEL"] = "runtime_wheels/llama_cpp_python-0.3.19-cp27-cp27-linux_x86_64.whl"
        self.assertIsNone(sham_gguf.hub_wheel("novaai2026/sham-v2", download=lambda r, n: (_ for _ in ()).throw(AssertionError("must not download"))))

    def test_pinned_default_is_cp311(self):
        self.assertIn("cp311-cp311-linux_x86_64.whl", sham_gguf.WHEEL)


if __name__ == "__main__":
    unittest.main()
