import os
import tempfile
import unittest
from pathlib import Path

import sham_memory as M


class Salt(unittest.TestCase):
    def test_random_per_install_salt_is_stable_and_private(self):
        with tempfile.TemporaryDirectory() as t:
            os.environ["SHAM_MEMORY_DIR"] = t
            os.environ.pop("SHAM_MEMORY_SALT", None)
            a, b = M.user_key("42"), M.user_key("42")
            self.assertEqual(a, b)
            self.assertNotEqual(a, M.hashlib.sha256(("sham-palmyra|42").encode()).hexdigest()[:32])
            self.assertEqual(oct((Path(t) / ".salt").stat().st_mode & 0o777), "0o600")
            os.environ["SHAM_MEMORY_SALT"] = "x" * 20
            self.assertNotEqual(M.user_key("42"), a)
        os.environ.pop("SHAM_MEMORY_DIR", None)
        os.environ.pop("SHAM_MEMORY_SALT", None)


if __name__ == "__main__":
    unittest.main()
