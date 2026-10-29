"""Offline regression tests for the live Sham v2 identity smoke check."""
import unittest
from unittest.mock import patch

import sham_v2_chat_smoke as smoke


class ShamV2IdentitySmokeTests(unittest.TestCase):
    def test_accepts_model_generated_sham_identity_in_natural_wording(self):
        smoke.check_identity_answer("أنا شام v2، مساعد مستقل عن نوفا.")

    def test_rejects_wrong_nova_identity_in_arabic_and_english(self):
        for answer in ("أنا نوفا", "أنا Nova، مساعدك", "اسمي نوفا", "I am Nova"):
            with self.subTest(answer=answer):
                with self.assertRaisesRegex(RuntimeError, "identified itself as Nova"):
                    smoke.check_identity_answer(answer)

    def test_rejects_non_sham_identity_and_question_echo(self):
        with self.assertRaisesRegex(RuntimeError, "did not identify itself as Sham"):
            smoke.check_identity_answer("أنا مساعد ذكي مستقل.")
        with self.assertRaisesRegex(RuntimeError, "echoed the identity question"):
            smoke.check_identity_answer("من أنت؟")

    def test_live_context_check_requires_qwen3_and_v2_system_prompt(self):
        with patch.object(smoke, "text_answer", return_value="sham_studio_chat فعّال | قالب النموذج=qwen3 | مسار Qwen3=فعّال | prompt=مخصص لـ Sham v2"):
            smoke.check_identity_context()
        with patch.object(smoke, "text_answer", return_value="sham_studio_chat فعّال | مسار Qwen3=فعّال | prompt=الافتراضي"):
            with self.assertRaisesRegex(RuntimeError, "system identity prompt is not active"):
                smoke.check_identity_context()


if __name__ == "__main__":
    unittest.main()
