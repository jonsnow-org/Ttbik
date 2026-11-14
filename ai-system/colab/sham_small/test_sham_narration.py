import unittest

import sham_narration as N


class Narration(unittest.TestCase):
    def test_clean_script(self):
        t = "# عنوان\n**مرحبا** بكم [ضحك] في (ملاحظة) [الموقع](http://x.y/a(b)).\n- نقطة"
        c = N.clean_script(t)
        self.assertNotIn("*", c)
        self.assertNotIn("http", c)
        self.assertNotIn("ضحك", c)
        self.assertNotIn("ملاحظة", c)
        self.assertIn("الموقع", c)
        self.assertNotIn("- نقطة", c)

    def test_split_arabic_and_latin(self):
        s = N.split_sentences("ما هذا؟ إنه رائع! وهذا ثالث. 3. ok")
        self.assertEqual(s[:3], ["ما هذا؟", "إنه رائع!", "وهذا ثالث."])
        self.assertTrue(all("3." != x for x in s))

    def test_shots_timeline_and_merge(self):
        script = "جملة أولى طويلة نوعا ما. نعم. جملة ثالثة طويلة نوعا ما."
        shots = N.plan_shots(script, [3.0, 0.5, 3.0])
        self.assertEqual(len(shots), 2)                       # the 0.5 s sentence joins its neighbour
        self.assertEqual(shots[0]["start"], 0.0)
        self.assertAlmostEqual(shots[-1]["end"], 6.5, places=2)
        self.assertEqual(shots[0]["end"], shots[1]["start"])

    def test_long_sentence_is_split_without_cutting_words(self):
        words = " ".join(f"كلمة{i}" for i in range(40)) + "."
        shots = N.plan_shots(words, [30.0], max_seconds=12.0)
        self.assertGreaterEqual(len(shots), 3)
        self.assertAlmostEqual(sum(s["seconds"] for s in shots), 30.0, places=1)
        joined = " ".join(s["text"] for s in shots).split()
        self.assertEqual(joined, words.split())

    def test_mismatch_raises(self):
        with self.assertRaises(ValueError):
            N.plan_shots("جملة. جملة أخرى.", [1.0])

    def test_cues_and_srt(self):
        shots = N.plan_shots("هذه جملة طويلة جدا لتحتاج إلى أكثر من سطرين في الترجمة المكتوبة على الشاشة بالتأكيد.", [8.0])
        cues = N.subtitle_cues(shots, max_chars=20, max_lines=2)
        self.assertGreaterEqual(len(cues), 2)
        self.assertTrue(all(len(c["lines"]) <= 2 for c in cues))
        self.assertAlmostEqual(cues[-1]["end"], 8.0, places=2)
        srt = N.to_srt(cues)
        self.assertIn("00:00:00,000 --> ", srt)
        self.assertTrue(srt.startswith("1\n"))

    def test_prompts_share_style(self):
        shots = N.plan_shots("جملة أولى هنا. جملة ثانية هنا.", [2.0, 2.0])
        self.assertTrue(all(p.endswith("لقطة سينمائية") for p in N.shot_prompts(shots, "لقطة سينمائية")))


if __name__ == "__main__":
    unittest.main()
