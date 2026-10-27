from __future__ import annotations

import base64
import json
import os
import unittest
from unittest.mock import Mock, patch

from app import media_fixtures, nova_media_studio


class NovaMediaStudioTests(unittest.TestCase):
    def test_image_uses_nova_media_studio_and_returns_bytes(self):
        raw = media_fixtures.png()
        response_payload = {"type": "image", "b64": base64.b64encode(raw).decode()}
        post = Mock()
        post.return_value.raise_for_status = Mock()
        post.return_value.json.return_value = {"event_id": "event-1"}
        get = Mock()
        get.return_value.raise_for_status = Mock()
        get.return_value.text = "event: complete\ndata: " + json.dumps([json.dumps(response_payload)]) + "\n\n"
        with patch.dict(os.environ, {"NOVA_MEDIA_STUDIO_URL": "https://nova-media.example", "MODELSCOPE_API_TOKEN": "test-token"}), patch.object(nova_media_studio.requests, "post", post), patch.object(nova_media_studio.requests, "get", get):
            result = nova_media_studio.generate_media("image", "a robot")
        self.assertEqual(result, raw)
        self.assertEqual(post.call_args.args[0], "https://nova-media.example/gradio_api/call/v2/image")
        self.assertEqual(get.call_args.args[0], "https://nova-media.example/gradio_api/call/image/event-1")
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer test-token")
        self.assertEqual(json.loads(post.call_args.kwargs["json"]["body"]), {"prompt": "a robot", "size": 512, "seed": 0})

    def test_audio_and_video_use_the_nova_studio_apis(self):
        for kind, api, prompt, expected in (
            ("audio", "speech", "مرحبا", {"text": "مرحبا"}),
            ("video", "video", "story", {"prompts": ["scene 1", "scene 2"], "narration": "صوت", "seconds": 3}),
        ):
            raw = {"audio": media_fixtures.wav, "video": media_fixtures.mp4_shell}[kind]()
            result_payload = {"type": kind, "b64": base64.b64encode(raw).decode()}
            post = Mock()
            post.return_value.raise_for_status = Mock()
            post.return_value.json.return_value = {"event_id": "e"}
            get = Mock()
            get.return_value.raise_for_status = Mock()
            get.return_value.text = "data: " + json.dumps([json.dumps(result_payload)]) + "\n"
            with patch.dict(os.environ, {"NOVA_MEDIA_STUDIO_URL": "https://nova-media.example"}), patch.object(nova_media_studio.requests, "post", post), patch.object(nova_media_studio.requests, "get", get):
                result = nova_media_studio.generate_media(kind, prompt, scenes=["scene 1", "scene 2"], narration="صوت")
            self.assertEqual(result, raw)
            self.assertTrue(post.call_args.args[0].endswith(f"/gradio_api/call/v2/{api}"))
            self.assertEqual(json.loads(post.call_args.kwargs["json"]["body"]), expected)

    def test_errors_are_returned_as_none_without_leaking_tokens(self):
        with patch.dict(os.environ, {"NOVA_MEDIA_STUDIO_URL": "https://nova-media.example", "MODELSCOPE_API_TOKEN": "secret"}), patch.object(nova_media_studio.requests, "post", side_effect=TimeoutError("timeout")):
            self.assertIsNone(nova_media_studio.generate_media("image", "x"))
        self.assertIsNone(nova_media_studio.generate_media("unknown", "x"))


if __name__ == "__main__":
    unittest.main()
