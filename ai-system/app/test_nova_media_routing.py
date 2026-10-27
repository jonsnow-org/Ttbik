from __future__ import annotations

import unittest
from unittest.mock import Mock

from app import nova_media_routing


class NovaMediaRoutingTests(unittest.TestCase):
    def providers(self):
        return {
            "hf": Mock(return_value=None),
            "cf": Mock(return_value=None),
            "studio": Mock(return_value=None),
            "model": Mock(return_value=None),
        }

    def call(self, p, external):
        return nova_media_routing.generate_image(
            "a red apple",
            external_enabled=external,
            hf_generate=p["hf"],
            cloudflare_generate=p["cf"],
            nova_studio_generate=p["studio"],
            nova_model_generate=p["model"],
        )

    def test_external_mode_tries_only_external_providers(self):
        p = self.providers()
        image, source = self.call(p, True)
        self.assertIsNone(image)
        self.assertEqual(source, "external-unavailable")
        p["hf"].assert_called_once_with("a red apple")
        p["cf"].assert_called_once_with("a red apple")
        p["studio"].assert_not_called()
        p["model"].assert_not_called()

    def test_external_success_does_not_call_any_internal_tool(self):
        p = self.providers()
        p["hf"].return_value = b"external-image"
        image, source = self.call(p, True)
        self.assertEqual(image, b"external-image")
        self.assertEqual(source, "huggingface")
        p["cf"].assert_not_called()
        p["studio"].assert_not_called()
        p["model"].assert_not_called()

    def test_internal_mode_uses_nova_media_studio_then_nova_model_only(self):
        p = self.providers()
        p["studio"].return_value = b"nova-studio-image"
        image, source = self.call(p, False)
        self.assertEqual(image, b"nova-studio-image")
        self.assertEqual(source, "nova-media-studio")
        p["hf"].assert_not_called()
        p["cf"].assert_not_called()
        p["model"].assert_not_called()

        p = self.providers()
        p["model"].return_value = b"nova-model-image"
        image, source = self.call(p, False)
        self.assertEqual(image, b"nova-model-image")
        self.assertEqual(source, "nova-modelscope")
        p["hf"].assert_not_called()
        p["cf"].assert_not_called()


if __name__ == "__main__":
    unittest.main()
