import unittest

import sham_inventory


class InventoryTests(unittest.TestCase):
    def test_selftest(self):
        sham_inventory._selftest()


if __name__ == "__main__":
    unittest.main()
