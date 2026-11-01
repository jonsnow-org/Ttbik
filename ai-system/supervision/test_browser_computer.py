"""Unit tests for the model's free headless browser: the pure parts (address safety, element list, session folders). No browser is started."""
import importlib.util
import unittest
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "modelscope-media" / "browser_computer.py"
spec = importlib.util.spec_from_file_location("browser_computer", PATH)
bc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bc)


class SafeUrl(unittest.TestCase):
    def test_private_and_local_addresses_are_refused(self):
        for bad in ("http://127.0.0.1/", "http://10.1.2.3/x", "https://192.168.0.5", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://0.0.0.0/"):
            with self.assertRaises(ValueError, msg=bad):
                bc.safe_url(bad)

    def test_other_schemes_are_refused(self):
        for bad in ("file:///etc/passwd", "ftp://93.184.216.34/x", "javascript:alert(1)"):
            with self.assertRaises(ValueError, msg=bad):
                bc.safe_url(bad)

    def test_a_public_address_is_kept_and_a_bare_host_gets_https(self):
        self.assertEqual(bc.safe_url("http://93.184.216.34/page"), "http://93.184.216.34/page")
        self.assertTrue(bc.safe_url("93.184.216.34").startswith("https://"))


class Helpers(unittest.TestCase):
    def test_elements_are_numbered_lines(self):
        text = bc.format_elements([{"id": 1, "role": "link", "label": "  Home  page ", "href": "https://x.test/"}, {"id": 2, "role": "button", "label": "Sign in"}])
        self.assertEqual(text.splitlines()[0], '[1] link "Home page" -> https://x.test/')
        self.assertEqual(text.splitlines()[1], '[2] button "Sign in"')

    def test_text_is_cut_with_a_hint(self):
        out = bc.clip_text("a" * 20000, 100)
        self.assertLessEqual(len(out), 140)
        self.assertIn("scroll", out)

    def test_session_folder_cannot_escape_the_store(self):
        folder = bc.session_dir("../../etc/passwd")
        self.assertEqual(folder.parent, bc.STORE)
        self.assertNotEqual(bc.session_dir("a"), bc.session_dir("b"))          # one folder per session (user + model)
        self.assertEqual(bc.session_dir("a"), bc.session_dir("a"))

    def test_unknown_request_is_answered_without_a_browser(self):
        self.assertIn("bad request", bc.api_browser_do("not json"))
        self.assertIn('"phase"', bc.api_browser_status(""))


if __name__ == "__main__":
    unittest.main()
