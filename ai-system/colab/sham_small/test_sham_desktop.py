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


if __name__ == "__main__":
    unittest.main()
