"""Nova's backend generates media only on its own Studio: no external media service is referenced or called."""
import pathlib
import re
import unittest
from unittest import mock

APP = pathlib.Path(__file__).resolve().parent
BANNED = re.compile(r"api\.cloudflare\.com|cloudflare_ai|CLOUDFLARE_|import edge_tts|from edge_tts|from gtts|import gtts|edge-tts==|gTTS==|replicate\.com|import replicate|heygen|hyperframes", re.I)


class NoExternalMedia(unittest.TestCase):
    def test_removed_modules_are_gone(self):
        self.assertFalse((APP / "cloudflare_ai.py").exists())
        self.assertFalse((APP / "media_finish.py").exists())

    def test_no_banned_service_in_backend_code_or_requirements(self):
        hits = []
        for f in list(APP.glob("*.py")) + [APP.parent / "requirements.txt"]:
            if f.name == pathlib.Path(__file__).name:
                continue
            for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                if BANNED.search(line):
                    hits.append(f"{f.name}:{n}: {line.strip()[:100]}")
        self.assertEqual(hits, [], "\n".join(hits))


class LocalVoice(unittest.TestCase):
    def setUp(self):
        from app import tts
        self.tts = tts

    def test_arabic_goes_to_nova_studio_and_is_returned(self):
        wav = b"RIFF" + b"\0" * 200
        with mock.patch.object(self.tts.nova_media_studio, "generate_media", return_value=wav) as g, mock.patch.object(self.tts, "_to_ogg_opus", return_value=b"OGG"):
            self.assertEqual(self.tts.synthesize("مرحبا بك"), (b"OGG", "ogg"))
            self.assertEqual(g.call_args[0][0], "audio")

    def test_wav_when_no_transcoder(self):
        wav = b"RIFF" + b"\0" * 200
        with mock.patch.object(self.tts.nova_media_studio, "generate_media", return_value=wav), mock.patch.object(self.tts, "_to_ogg_opus", return_value=None):
            self.assertEqual(self.tts.synthesize("مرحبا"), (wav, "wav"))

    def test_studio_failure_is_text_only_never_raises(self):
        with mock.patch.object(self.tts.nova_media_studio, "generate_media", side_effect=RuntimeError("down")):
            self.assertIsNone(self.tts.synthesize("مرحبا"))
        with mock.patch.object(self.tts.nova_media_studio, "generate_media", return_value=None):
            self.assertIsNone(self.tts.synthesize("مرحبا"))

    def test_non_arabic_is_not_sent_to_the_arabic_voice(self):
        with mock.patch.object(self.tts.nova_media_studio, "generate_media") as g:
            self.assertIsNone(self.tts.synthesize("hello there"))
            g.assert_not_called()


if __name__ == "__main__":
    unittest.main()
