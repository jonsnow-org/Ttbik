"""A partial Kaggle archive must not crash the trainer. Runs in its own interpreter: importing sham_inputs installs the VQ training patch (sham_vq.install) for the whole process."""
import pathlib
import subprocess
import sys
import tempfile
import unittest

CODE = """
import pathlib, sys
sys.path.insert(0, sys.argv[1])
import sham_inputs
d = pathlib.Path(sys.argv[2])
(d / 'a.zip').write_bytes(b'not a zip')
sham_inputs._unzip_nested(d)
print('LEFT', len(list(d.iterdir())))
"""


class BadZip(unittest.TestCase):
    def test_partial_archive_is_dropped_not_fatal(self):
        d = tempfile.mkdtemp()
        r = subprocess.run([sys.executable, "-c", CODE, str(pathlib.Path(__file__).parent), d], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr[-400:])
        self.assertIn("LEFT 0", r.stdout)


if __name__ == "__main__":
    unittest.main()
