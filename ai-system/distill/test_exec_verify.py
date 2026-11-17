import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from exec_verify import extract_code, run_python_tests  # noqa: E402

ROWS = [json.loads(l) for l in open(os.path.join(os.path.dirname(__file__), "prompts", "code_exec.jsonl"), encoding="utf-8")]


class ExecVerify(unittest.TestCase):
    def test_rows_are_well_formed(self):
        self.assertGreaterEqual(len(ROWS), 20)
        for r in ROWS:
            self.assertEqual(r["verifier"], "python_tests")
            self.assertIn(r["verification"]["entry"], r["prompt"])
            self.assertIn("assert", r["verification"]["tests"])

    def test_a_correct_and_a_wrong_answer(self):
        r = next(x for x in ROWS if x["verification"]["entry"] == "gcd")
        good = "```python\ndef gcd(a, b):\n    while b:\n        a, b = b, a % b\n    return a\n```"
        bad = "```python\ndef gcd(a, b):\n    return 1\n```"
        self.assertTrue(run_python_tests(good, r["verification"]["tests"])[0])
        self.assertFalse(run_python_tests(bad, r["verification"]["tests"])[0])

    def test_no_code_and_syntax_error(self):
        self.assertFalse(run_python_tests("", "assert True")[0])
        self.assertFalse(run_python_tests("def f(:\n", "assert True")[0])

    def test_infinite_loop_times_out(self):
        ok, why = run_python_tests("while True:\n    pass\n", "assert True", timeout=3)
        self.assertFalse(ok)
        self.assertIn(why, ("timeout", "failed", "Killed"))

    def test_dangerous_code_is_refused_before_running(self):
        for code in ("import os\nos" + ".system('echo hi')", "import socket", "open('/etc/passwd').read()", "__import__('os')", "import subprocess"):
            ok, why = run_python_tests(code, "assert True")
            self.assertFalse(ok, code)
            self.assertEqual(why, "forbidden construct", code)

    def test_environment_is_empty(self):
        os.environ["DISTILL_TEST_SECRET"] = "leak"
        ok, _ = run_python_tests("def f():\n    return 1", "assert f() == 1")
        self.assertTrue(ok)       # and the child has env={}: nothing of ours can be read (the construct `os` is refused anyway)

    def test_extract_code(self):
        self.assertEqual(extract_code("text ```python\nx = 1\n``` tail"), "x = 1")
        self.assertEqual(extract_code("x = 2"), "x = 2")


if __name__ == "__main__":
    unittest.main()
