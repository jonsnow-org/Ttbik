"""The taskbar drawn INSIDE the Linux desktop (owner 2026-11-09): configuration and launcher scripts, no X11 needed."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import desktop_computer as d  # noqa: E402


class PanelTests(unittest.TestCase):
    def test_config_has_a_button_per_app_and_the_taskbar(self):
        text = d.panel_config([("Browser", "/h/browser.sh"), ("Terminal", "/h/terminal.sh"), ("Files", "/h/files.sh")])
        self.assertIn("panel_items = PPPTC", text)
        self.assertEqual(text.count("button = new"), 3)
        self.assertIn("button_lclick_command = /h/terminal.sh", text)
        self.assertIn(f"panel_size = 100% {d.PANEL_HEIGHT}", text)
        self.assertIn("panel_position = bottom center horizontal", text)

    def test_terminal_leaves_room_for_the_panel(self):
        cmd = d._terminal_command()
        geometry = cmd[cmd.index("-geometry") + 1]
        rows = int(geometry.split("x")[1].split("+")[0])
        self.assertLessEqual(rows * 15, d.HEIGHT - d.PANEL_HEIGHT)

    def test_files_launcher_uses_options_this_pcmanfm_knows(self):
        # the live log said "Unknown option --new-window": this pcmanfm opens a folder window from a plain path
        old = d.shutil.which
        d.shutil.which = lambda name: "/usr/bin/" + name if name == "pcmanfm" else old(name)
        try:
            script = d._launcher_script("s", "files")
        finally:
            d.shutil.which = old
        self.assertIn("exec pcmanfm ", script)
        self.assertNotIn("--new-window", script)
        self.assertNotIn("--no-desktop", script)

    def test_browser_script_finds_chromium_when_clicked(self):
        script = d._launcher_script("s", "browser")
        self.assertTrue(script.startswith("#!/bin/sh"))
        self.assertIn("--no-sandbox", script)
        self.assertIn("find ", script)
        self.assertIsNone(d._launcher_script("s", "unknown"))


class AssetsTests(unittest.TestCase):
    def test_desktop_icons_wallpaper_and_quick_exec(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            scripts = {"browser": "/h/browser.sh", "terminal": "/h/terminal.sh", "files": "/h/files.sh"}
            desktop = d.write_desktop_assets(home, scripts)
            names = sorted(p.name for p in desktop.iterdir())
            self.assertEqual(names, ["Browser.desktop", "Files.desktop", "Terminal.desktop"])
            text = (desktop / "Terminal.desktop").read_text()
            self.assertIn("Exec=/h/terminal.sh", text)
            self.assertIn("Terminal=false", text)
            self.assertTrue((home / ".desktop" / "icons" / "browser.png").exists())
            conf = (home / ".config" / "pcmanfm" / "default" / "desktop-items-0.conf").read_text()
            self.assertIn("wallpaper_mode=color", conf)
            libfm = (home / ".config" / "libfm" / "libfm.conf").read_text()
            self.assertIn("quick_exec=1", libfm)
            self.assertIn("single_click=1", libfm)


class SizeTests(unittest.TestCase):
    def test_start_size_is_clamped_and_only_applies_to_a_stopped_desktop(self):
        old = (d.WIDTH, d.HEIGHT, d._PHASE)
        try:
            d._PHASE = "stopped"
            d._set_size(900, 1300)
            self.assertEqual((d.WIDTH, d.HEIGHT), (900, 1300))
            d._set_size(99999, 5)
            self.assertEqual((d.WIDTH, d.HEIGHT), (1600, 600))
            d._set_size("x", None)                       # no usable size -> the default landscape screen
            self.assertEqual((d.WIDTH, d.HEIGHT), d.DEFAULT_SIZE)
            d._set_size(99999, 5)
            d._PHASE = "running"
            d._set_size(700, 700)
            self.assertEqual((d.WIDTH, d.HEIGHT), (1600, 600))
        finally:
            d.WIDTH, d.HEIGHT, d._PHASE = old

    def test_small_screens_get_bigger_ui(self):
        old = (d.WIDTH, d.HEIGHT)
        try:
            d.WIDTH, d.HEIGHT = 640, 1070
            small = d.ui()
            d.WIDTH, d.HEIGHT = 1344, 840
            big = d.ui()
        finally:
            d.WIDTH, d.HEIGHT = old
        self.assertGreater(small["fs"], big["fs"])
        self.assertGreater(small["panel"], big["panel"])
        self.assertGreater(small["icon"], big["icon"])

    def test_input_actions_settle_so_their_reply_can_carry_a_picture(self):
        for action in ("click", "key", "type", "scroll", "launch"):
            self.assertIn(action, d.SETTLE)


class AptTests(unittest.TestCase):
    def test_a_stuck_apt_update_is_a_failed_result_not_an_exception(self):
        box = d.box
        saved = (box.subprocess.run, box.is_root, box.prepare_ubuntu_apt_sources, box.shutil.which, box._APT_INDEX_UPDATED_AT)
        seen = {}

        def fake_run(cmd, **kw):
            seen["cmd"] = cmd
            raise box.subprocess.TimeoutExpired(cmd, kw.get("timeout", 1))
        try:
            box.subprocess.run = fake_run
            box.is_root = lambda: True
            box.prepare_ubuntu_apt_sources = lambda: None
            box.shutil.which = lambda name: "/usr/bin/" + name
            box._APT_INDEX_UPDATED_AT = 0
            result = box.apt_update(timeout=5)
        finally:
            box.subprocess.run, box.is_root, box.prepare_ubuntu_apt_sources, box.shutil.which, box._APT_INDEX_UPDATED_AT = saved
        self.assertEqual(result.returncode, 124)
        self.assertIn("timed out", result.stderr)
        self.assertIn("Acquire::http::Timeout=25", seen["cmd"])
        self.assertIn("DPkg::Lock::Timeout=120", seen["cmd"])


if __name__ == "__main__":
    unittest.main()
