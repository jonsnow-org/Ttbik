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


class Download(unittest.TestCase):
    def test_a_mirror_is_tried_before_the_host_that_timed_out_on_a_real_studio(self):
        self.assertTrue(bc.DOWNLOAD_HOSTS[0].startswith("https://cdn.npmmirror.com/"))
        self.assertIn("", bc.DOWNLOAD_HOSTS)                                  # Playwright's own host stays as the last resort
        self.assertLess(bc.PER_HOST_SECONDS * len(bc.DOWNLOAD_HOSTS), 900)    # the whole attempt is shorter than the 900 s that failed

    def test_hosts_are_tried_in_order_and_stop_at_the_first_that_works(self):
        tried = []
        old_run, old_have = bc._run, bc.have_chromium
        installed = {"ok": False}

        def fake_run(cmd, timeout=900, cwd=None):
            tried.append(bc.os.environ.get("PLAYWRIGHT_DOWNLOAD_HOST", ""))
            installed["ok"] = len(tried) == 2                                   # the first host fails, the second works
            return (0 if installed["ok"] else 1), ""

        bc._run, bc.have_chromium = fake_run, lambda: installed["ok"]
        try:
            self.assertTrue(bc.download_chromium())
            self.assertEqual(tried, [bc.DOWNLOAD_HOSTS[0], ""])
        finally:
            bc._run, bc.have_chromium = old_run, old_have
            bc.os.environ.pop("PLAYWRIGHT_DOWNLOAD_HOST", None)


class Pooling(unittest.TestCase):
    def test_drawn_areas_are_described_and_iframes_counted(self):
        text = bc.format_visual([{"kind": "canvas", "x": 10, "y": 20, "w": 300, "h": 200}], frames=2)
        self.assertIn("canvas at x=10 y=20 size 300x200", text)
        self.assertIn("2 iframe(s)", text)
        self.assertEqual(bc.format_visual([], 0), "")

    def test_a_hibernated_session_remembers_its_page(self):
        import tempfile
        old = bc.STORE
        bc.STORE = Path(tempfile.mkdtemp())
        try:
            self.assertEqual(bc.load_meta("u:m"), {})
            bc.save_meta("u:m", "https://example.com/a")
            self.assertEqual(bc.load_meta("u:m")["url"], "https://example.com/a")
            self.assertEqual(bc.load_meta("other"), {})                       # another user / model never sees it
            self.assertEqual(bc.state_file("u:m").parent, bc.session_dir("u:m"))
        finally:
            bc.STORE = old

    def test_idle_sessions_are_saved_then_closed_and_the_oldest_makes_room(self):
        calls = []

        class Ctx:
            def __init__(self, name): self.name = name
            def storage_state(self, path): calls.append(("save", self.name))
            def close(self): calls.append(("close", self.name))

        class Page:
            url = "https://example.com/"

        import tempfile
        old = bc.STORE
        bc.STORE = Path(tempfile.mkdtemp())
        try:
            worker = bc._Worker()
            now = bc.time.time()
            worker.pages = {"idle": (Ctx("idle"), Page(), now - bc.IDLE_SECONDS - 5), "busy": (Ctx("busy"), Page(), now)}
            worker._reap()
            self.assertEqual(list(worker.pages), ["busy"])
            self.assertEqual(calls, [("save", "idle"), ("close", "idle")])    # state first, then the context is released
            self.assertGreaterEqual(bc.MAX_SESSIONS, 4)                       # one shared Chromium makes several sessions affordable
        finally:
            bc.STORE = old


if __name__ == "__main__":
    unittest.main()
