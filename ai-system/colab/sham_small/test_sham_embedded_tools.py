import os
import subprocess
import tempfile
import unittest

import sham_computer
import sham_embedded_tools as E


class EmbeddedTools(unittest.TestCase):
    def test_selftest(self):
        E._selftest()

    def test_changes_reports_edits_new_files_and_deletions(self):
        base = tempfile.mkdtemp()
        os.chmod(base, 0o755)
        os.environ["SHAM_COMPUTER_HOME"] = base
        os.environ.pop("SHAM_INTERNAL_COMPUTER", None)
        sham_computer._ISOLATION = "none"
        c = sham_computer.Computer("changes")
        c.run("mkdir -p repos/o-r && cd repos/o-r && git init -q && git config user.email a@b && git config user.name n && echo a>a.txt && echo b>b.txt && git add . && git commit -qm i && echo A>a.txt && rm b.txt && echo n>new.txt")
        out = c.changes("o/r")
        self.assertTrue(out["ok"], out)
        self.assertEqual(sorted(f["path"] for f in out["files"]), ["a.txt", "new.txt"])
        self.assertEqual(out["deleted"], ["b.txt"])
        self.assertFalse(c.changes("not-a-repo")["ok"])
        self.assertFalse(c.changes("o/missing")["ok"])


if __name__ == "__main__":
    unittest.main()
