import unittest

import freshness as f

H1 = '<script src="/_next/static/chunks/app/coder-app/page-218eb519de98bc2a.js"></script><script src="/_next/static/chunks/app/layout-aa11.js"></script>'
H2 = '<script src="/_next/static/chunks/app/coder-app/page-0000000000000000.js"></script>'


class T(unittest.TestCase):
    def test_chunks(self):
        self.assertEqual(f.page_chunks(H1), ["/_next/static/chunks/app/coder-app/page-218eb519de98bc2a.js"])

    def test_same_and_different(self):
        self.assertTrue(f.same_build(f.page_chunks(H1), f.page_chunks(H1)))
        self.assertFalse(f.same_build(f.page_chunks(H1), f.page_chunks(H2)))
        self.assertFalse(f.same_build([], []))


if __name__ == "__main__":
    unittest.main()
