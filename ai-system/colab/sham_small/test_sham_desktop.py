import os
import unittest

import sham_desktop
import sham_embedded_tools as E


class DesktopTests(unittest.TestCase):
    def test_selftest(self):
        sham_desktop._selftest()

    def test_the_tool_is_part_of_the_embedded_loop_and_never_crashes_without_packages(self):
        self.assertIn("desktop", E.EMBEDDED)
        out = E.run_embedded("desktop", {"action": "click", "x": 1, "y": 1}, "no-such-session")
        self.assertTrue(out.startswith("error"), out)
        self.assertTrue(E.run_embedded("desktop", {"action": "start"}, "t-pkgless").startswith(("error", "phase=")))

    def test_switch_off(self):
        os.environ["SHAM_DESKTOP"] = "0"
        try:
            self.assertIn("switched off", sham_desktop.run_tool({"action": "start"}, "x"))
        finally:
            del os.environ["SHAM_DESKTOP"]

    def test_http_access_needs_the_token(self):
        try:
            from fastapi import FastAPI
            from fastapi.testclient import TestClient
        except Exception:  # noqa: BLE001 - CI image without fastapi/httpx
            self.skipTest("fastapi test client not installed")
        import sham_desktop_api as api
        app = FastAPI()
        app.include_router(api.router)
        client = TestClient(app)
        os.environ.pop("SHAM_DESKTOP_TOKEN", None)
        self.assertEqual(client.post("/desktop/input", json={"session": "s"}).status_code, 401)   # no token configured: refuses everyone
        os.environ["SHAM_DESKTOP_TOKEN"] = "secret"
        try:
            self.assertEqual(client.post("/desktop/input", json={"session": "s"}, headers={"x-sham-desktop-token": "wrong"}).status_code, 401)
            self.assertEqual(client.get("/desktop/frame?session=s", headers={"x-sham-desktop-token": "secret"}).status_code, 404)
        finally:
            del os.environ["SHAM_DESKTOP_TOKEN"]


class ChromeForDesktopTest(unittest.TestCase):
    def test_finds_chrome_for_testing_and_old_layout_newest_first(self):
        import sham_desktop as d
        fake = {"chrome-linux64": ["/r/chromium-1200/chrome-linux64/chrome"], "chrome-linux": ["/r/chromium-1100/chrome-linux/chrome"]}
        hit = d._playwright_chrome(lambda pat: next((v for k, v in fake.items() if f"/{k}/" in pat), []))
        self.assertEqual(hit, "/r/chromium-1200/chrome-linux64/chrome")
        self.assertIsNone(d._playwright_chrome(lambda pat: []))

    def test_missing_chrome_starts_one_background_install(self):
        import sham_desktop as d
        d._CHROME_INSTALL.update(started=False, note="")
        calls = []
        r = d.chrome_missing_reply(start=lambda: calls.append(1))
        if r.get("phase") == "installing":            # playwright importable here
            self.assertEqual(len(calls), 1)
            d.chrome_missing_reply(start=lambda: calls.append(1))
            self.assertEqual(len(calls), 1)             # once per process
            d._CHROME_INSTALL["note"] = "playwright install failed: x"
            self.assertIn("could not be installed", d.chrome_missing_reply()["error"])
        else:
            self.assertIn("no Chromium", r["error"])
        d._CHROME_INSTALL.update(started=False, note="")


class BrowserAliveTest(unittest.TestCase):
    """ok=True from launch means the browser is still running; one that dies at once reports why (a black screen never passes as a working browser)."""

    class Proc:
        def __init__(self, code):
            self.code = code

        def poll(self):
            return self.code

    def _log(self, text):
        import tempfile
        f = tempfile.NamedTemporaryFile("w", delete=False, suffix=".log")
        f.write(text)
        f.close()
        return f.name

    def test_alive_browser_is_ok(self):
        import sham_desktop as d
        self.assertIsNone(d.browser_exit(self.Proc(None), self._log(""), wait=0.3))

    def test_dead_browser_reports_the_reason(self):
        import sham_desktop as d
        r = d.browser_exit(self.Proc(1), self._log("[1:1] Failed to connect to the bus\nMissing X server"), wait=0)
        self.assertFalse(r["ok"])
        self.assertIn("exited at once (code 1)", r["error"])
        self.assertIn("Missing X server", r["error"])

    def test_missing_libraries_start_one_background_fetch(self):
        import sham_desktop as d
        d._CHROME_DEPS.update(started=False, note="")
        calls = []
        log = self._log("chrome: error while loading shared libraries: libnss3.so: cannot open shared object file")
        r = d.browser_exit(self.Proc(127), log, wait=0, start_deps=lambda: calls.append(1))
        self.assertEqual((r["phase"], len(calls)), ("installing", 1))
        d.browser_exit(self.Proc(127), log, wait=0, start_deps=lambda: calls.append(1))
        self.assertEqual(len(calls), 1)
        d._CHROME_DEPS["note"] = "needs root (run install_desktop.sh on the host)"
        self.assertIn("could not be installed", d.browser_exit(self.Proc(127), log, wait=0)["error"])
        d._CHROME_DEPS.update(started=False, note="")


if __name__ == "__main__":
    unittest.main()
