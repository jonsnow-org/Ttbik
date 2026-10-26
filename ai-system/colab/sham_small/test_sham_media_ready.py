"""Offline contract tests for Sham v2 media serving; no model weights are downloaded."""
import os
import tempfile
import unittest
from pathlib import Path

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

    def test_video_never_falls_back_to_a_slideshow(self):
        old_space = os.environ.pop('HF_VIDEO_SPACE_ID', None)
        try:
            result = media.make(None, 'video', 'A horse running across a field')
            self.assertEqual(result['type'], 'error')
            self.assertEqual(result['code'], 'video_backend_not_configured')
            self.assertNotIn('b64', result)
        finally:
            if old_space is not None:
                os.environ['HF_VIDEO_SPACE_ID'] = old_space


if __name__ == '__main__':
    unittest.main()