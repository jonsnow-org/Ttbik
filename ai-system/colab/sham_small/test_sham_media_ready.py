"""Offline contract tests for Sham v2 media serving; no model weights are downloaded."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import imageio_ffmpeg
import sham_media_ready as media


class MediaServingContractTests(unittest.TestCase):
    def test_empty_model_dir_is_not_ready(self):
        self.assertIsNone(media.ready_root(None))
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(media.ready_root(tmp))

    def test_image_model_requires_index_and_weights(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'media'
            model = root / 'sdxs'
            model.mkdir(parents=True)
            (model / 'model.safetensors').write_bytes(b'test')
            self.assertIsNone(media.ready_root(tmp))
            (model / 'model_index.json').write_text('{}', encoding='utf-8')
            self.assertEqual(media.ready_root(tmp), root)

    def test_piper_requires_model_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'media' / 'piper'
            root.mkdir(parents=True)
            (root / 'voice.onnx').write_bytes(b'test')
            self.assertIsNone(media.ready_root(tmp))
            (root / 'voice.onnx.json').write_text('{}', encoding='utf-8')
            self.assertEqual(media.ready_root(tmp), root.parent)

    def test_invalid_requests_fail_explicitly(self):
        self.assertEqual(media.make(None, 'image', '')['code'], 'empty_prompt')
        self.assertEqual(media.make(None, 'unknown', 'x')['code'], 'unknown_kind')

    def test_static_mp4_is_rejected(self):
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            still = tmp / 'still.png'
            video = tmp / 'still.mp4'
            subprocess.run([ffmpeg, '-y', '-f', 'lavfi', '-i', 'testsrc=size=512x512:rate=1',
                            '-frames:v', '1', str(still)], check=True, capture_output=True, timeout=30)
            subprocess.run([ffmpeg, '-y', '-loop', '1', '-i', str(still), '-t', '2', '-r', '24',
                            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(video)],
                           check=True, capture_output=True, timeout=30)
            with self.assertRaisesRegex(RuntimeError, 'الإطارات لا تُظهر حركة'):
                media._validate_mp4(video)

    def test_temporally_changing_mp4_passes_validation(self):
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        with tempfile.TemporaryDirectory() as tmp:
            video = Path(tmp) / 'moving.mp4'
            subprocess.run([ffmpeg, '-y', '-f', 'lavfi', '-i', 'testsrc2=size=512x512:rate=12:duration=2',
                            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(video)],
                           check=True, capture_output=True, timeout=30)
            raw, duration = media._validate_mp4(video)
            self.assertGreater(len(raw), 4096)
            self.assertGreaterEqual(duration, 1.5)

    def test_video_never_falls_back_to_a_slideshow(self):
        old_space = os.environ.pop('HF_VIDEO_SPACE_ID', None)
        old_token = os.environ.pop('HF_TOKEN', None)
        try:
            result = media.make(None, 'video', 'A horse running across a field')
            self.assertEqual(result['type'], 'error')
            self.assertEqual(result['code'], 'video_backend_not_configured')
            self.assertNotIn('b64', result)
        finally:
            if old_space is not None:
                os.environ['HF_VIDEO_SPACE_ID'] = old_space
            if old_token is not None:
                os.environ['HF_TOKEN'] = old_token


if __name__ == '__main__':
    unittest.main()