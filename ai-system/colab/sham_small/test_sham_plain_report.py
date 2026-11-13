"""The merge notice must say in words what was accepted / refused and by how much (owner's order 2026-11-13)."""
import unittest

from sham_ci_merge import plain_summary

BEFORE = {"text": 4.837, "chat": 4.220, "media": 3.751}
AFTER = {"text": 4.784, "chat": 3.905, "media": 3.793}
REPORT = [
    "📏 sham-crawl-xlive (خطوة 51,425) وحده على الميزان: text=14.874, chat=22.326, media=11.021 | الأساس: text=4.837, chat=4.220, media=3.751",
    "قبل الدمج: text=4.837, chat=4.220, media=3.751",
    "✅ sham-chat-checkpoint (خطوة 85,917): دُمج بنسبة 0.15 — text=4.880, chat=4.137, media=3.723",
    "❌ sham-research-track-checkpoint-v2 (خطوة 62,761): لم يُدمج (لم يحسّن كل المهارات معاً) — أقرب محاولة (نسبة 0.01): text 4.880→4.879 (-0.0%), chat 4.137→4.130 (-0.2%), media 3.723→3.740 (+0.5%) — المنحنى (نسبة: تغيّر كل مهارة %): 0.01: t-0.0",
]


class PlainReport(unittest.TestCase):
    def test_words_and_percentages(self):
        t = plain_summary("sham-multimodal-checkpoint", 84755, BEFORE, AFTER, REPORT, published="x")
        self.assertIn("المحادثة: تحسّن 7.5%", t)
        self.assertIn("الوسائط: تراجع 1.1%", t)
        self.assertIn("sham-chat-checkpoint", t)
        self.assertIn("قُبل بنسبة 15%", t)
        self.assertIn("المحادثة: تحسّن 2.0%", t)       # 4.220 -> 4.137
        self.assertIn("ساءت الوسائط 0.5%", t)
        self.assertIn("sham-crawl-xlive", t)           # far too bad to merge

    def test_unpublished(self):
        t = plain_summary("b", 1, BEFORE, BEFORE, [], published=None)
        self.assertIn("لا نسخة جديدة", t)


if __name__ == "__main__":
    unittest.main()
