import unittest


class VerifiedTests(unittest.TestCase):
    def test_selftest(self):
        try:
            import pytest  # noqa: F401
        except ImportError:
            self.skipTest("pytest is not installed in this image (the collector job installs it)")
        import sham_source_tests
        sham_source_tests._selftest()

    def test_without_isolation_the_source_runs_nothing(self):
        import os
        import random
        import sham_source_tests as T
        os.environ["SHAM_TESTS_NO_SANDBOX"] = "1"
        try:
            self.assertEqual(T.src_verified_tests(random.Random(1)), [])
        finally:
            os.environ.pop("SHAM_TESTS_NO_SANDBOX")


if __name__ == "__main__":
    unittest.main()
