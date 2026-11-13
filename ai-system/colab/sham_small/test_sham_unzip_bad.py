import pathlib
import tempfile
import unittest

import sham_inputs


class BadZip(unittest.TestCase):
    def test_partial_archive_is_dropped_not_fatal(self):
        d = pathlib.Path(tempfile.mkdtemp())
        (d / "a.zip").write_bytes(b"not a zip")
        sham_inputs._unzip_nested(d)
        self.assertEqual(list(d.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
