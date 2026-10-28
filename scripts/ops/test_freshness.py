import unittest

import freshness as f

H1 = '<script src="/_next/static/chunks/app/coder-app/page-218eb519de98bc2a.js"></script><script src="/_next/static/chunks/app/layout-aa11.js"></script>'
H2 = '<script src="/_next/static/chunks/app/coder-app/page-0000000000000000.js"></script>'


class T(unittest.TestCase):
    def test_chunks(self):
        self.assertEqual(f.page_chunks(H1), ["/_next/static/chunks/app/coder-app/page-218eb519de98bc2a.js"])

    def test_texts_ignore_ids_and_hashes(self):
        a = 'x=n(123)("التطوير والنشر للمطورين");y="Development & deployment";' * 1
        b = 'x=n(9)("التطوير والنشر للمطورين");y="Development & deployment";'
        self.assertEqual(f.texts(a), f.texts(b))
        self.assertTrue(f.same_build(f.texts(a), f.texts(b)))

    def test_old_build_is_detected(self):
        new = "".join(f'"نص عربي رقم {i} طويل كفاية";' for i in range(400))
        old = "".join(f'"نص عربي رقم {i} طويل كفاية";' for i in range(380))
        self.assertFalse(f.same_build(f.texts(old), f.texts(new)))
        self.assertFalse(f.same_build(frozenset(), frozenset()))


if __name__ == "__main__":
    unittest.main()
