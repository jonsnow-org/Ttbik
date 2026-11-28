import unittest

from remotion_publish import has_earnings_claim, public_caption


class RemotionPublishTests(unittest.TestCase):
    def base(self, **overrides):
        value = {
            "channel": "general",
            "lang": "ar",
            "title": "أداة جديدة",
            "hook": "أداة نافعة",
            "caption": "أداة جديدة من شام AI",
            "script": "هذه أداة مجانية.",
            "site": "https://example.com",
            "path": "/tool",
        }
        value.update(overrides)
        return value

    def test_general_channel_gets_english_first_but_keeps_arabic_copy(self):
        caption = public_caption(self.base())
        self.assertTrue(caption.startswith("Sham AI update\n\n"))
        self.assertIn("أداة جديدة", caption)

    def test_coins_channel_requires_english_caption_and_narration(self):
        episode = self.base(
            channel="coins",
            lang="en",
            title="A Palmyra keepsake",
            hook="A keepsake from Palmyra",
            caption="A keepsake only; no promise of any return.",
            script="This is a keepsake, not an investment.",
        )
        self.assertEqual(
            public_caption(episode),
            episode["caption"] + "\n\nhttps://example.com/tool",
        )

    def test_coins_channel_rejects_arabic_in_any_public_field(self):
        episode = self.base(
            channel="coins",
            lang="en",
            title="Palmyra",
            hook="A keepsake",
            caption="A keepsake only.",
            script="تذكار من تدمر.",
        )
        with self.assertRaisesRegex(ValueError, "English-only"):
            public_caption(episode)

    def test_coins_channel_requires_english_language(self):
        episode = self.base(channel="coins", lang="ar", title="Palmyra", hook="A keepsake", caption="A keepsake.", script="Keepsake only.")
        with self.assertRaisesRegex(ValueError, "lang=en"):
            public_caption(episode)

    def test_both_languages_block_profit_promises_but_allow_disclaimers(self):
        self.assertTrue(has_earnings_claim("Guaranteed returns every week"))
        self.assertTrue(has_earnings_claim("Get paid to watch ads"))
        self.assertTrue(has_earnings_claim("Earn from viewing videos"))
        self.assertTrue(has_earnings_claim("اكسب من مشاهدة الإعلانات"))
        self.assertFalse(has_earnings_claim("A keepsake only; no promise of any return."))
        self.assertFalse(has_earnings_claim("The points are ranks and titles only, not profit."))

    def test_allows_only_the_two_existing_telegram_destinations(self):
        with self.assertRaisesRegex(ValueError, "Only the existing"):
            public_caption(self.base(channel="other-channel"))


if __name__ == "__main__":
    unittest.main()
