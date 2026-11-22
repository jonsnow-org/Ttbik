import pathlib, unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class BanksSync(unittest.TestCase):
    def test_sham_copy_equals_hub_copy(self):
        a = (ROOT / "modelscope-media" / "computer_banks.py").read_bytes()
        b = (ROOT / "colab" / "sham_small" / "computer_banks.py").read_bytes()
        self.assertEqual(a, b, "sham_small/computer_banks.py must stay identical to modelscope-media/computer_banks.py")


if __name__ == "__main__":
    unittest.main()
