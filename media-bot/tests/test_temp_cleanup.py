import tempfile
import unittest
from pathlib import Path

from services.downloader import cleanup_download_directory


class DownloadCleanupTests(unittest.TestCase):
    def test_removes_downloader_owned_temp_directory(self):
        temp_root = Path(tempfile.mkdtemp(prefix="mediabot_"))
        media_file = temp_root / "clip.mp4"
        media_file.write_bytes(b"media")

        self.assertTrue(cleanup_download_directory(media_file))
        self.assertFalse(temp_root.exists())

    def test_removes_tikwm_temp_directory(self):
        temp_root = Path(tempfile.mkdtemp(prefix="tikwm_"))
        media_file = temp_root / "audio.mp3"
        media_file.write_bytes(b"audio")

        self.assertTrue(cleanup_download_directory(media_file))
        self.assertFalse(temp_root.exists())

    def test_does_not_remove_unrelated_temp_directory(self):
        temp_root = Path(tempfile.mkdtemp(prefix="user_upload_"))
        media_file = temp_root / "keep.txt"
        media_file.write_text("keep")

        self.assertFalse(cleanup_download_directory(media_file))
        self.assertTrue(media_file.exists())
        self.assertTrue(temp_root.exists())

    def test_ignores_missing_path(self):
        self.assertFalse(cleanup_download_directory(None))


if __name__ == "__main__":
    unittest.main()
