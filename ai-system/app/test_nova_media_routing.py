from __future__ import annotations

import unittest
from unittest.mock import Mock

from app import nova_media_routing


class NovaMediaRoutingTests(unittest.TestCase):
    def test_image_uses_only_nova_media_studio(self):
        studio = Mock(return_value=b"nova-studio-image")
        image, source = nova_media_routing.generate_image(
            "a red apple", nova_studio_generate=studio
        )
        self.assertEqual(image, b"nova-studio-image")
        self.assertEqual(source, "nova-media-studio")
        studio.assert_called_once_with("a red apple")

    def test_unavailable_studio_does_not_select_another_generator(self):
        studio = Mock(return_value=None)
        image, source = nova_media_routing.generate_image(
            "a red apple", nova_studio_generate=studio
        )
        self.assertIsNone(image)
        self.assertEqual(source, "nova-media-studio-unavailable")
        studio.assert_called_once_with("a red apple")

    def test_studio_exception_fails_closed(self):
        studio = Mock(side_effect=TimeoutError("timeout"))
        image, source = nova_media_routing.generate_image(
            "a red apple", nova_studio_generate=studio
        )
        self.assertIsNone(image)
        self.assertEqual(source, "nova-media-studio-error")
        studio.assert_called_once_with("a red apple")


if __name__ == "__main__":
    unittest.main()
