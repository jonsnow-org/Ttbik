"""r18: plain chat skips tools; Arabic replies never keep CJK fragments."""
import ast
import re
import unittest
from pathlib import Path

SRC = Path(__file__).with_name("app.py").read_text(encoding="utf-8")


def load():
    tree = ast.parse(SRC)
    names = {"_is_plain_chat", "_needs_script_fix", "_strip_cjk"}
    consts = {"_TASK_HINT", "_ARABIC", "_CJK"}
    picked = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in names)
              or (isinstance(n, ast.Assign) and any(getattr(t, "id", "") in consts for t in n.targets))]
    scope = {"re": re}
    exec(compile(ast.Module(body=picked, type_ignores=[]), "app.py", "exec"), scope)
    return scope


S = load()


class FastLane(unittest.TestCase):
    def test_greetings_and_identity_are_plain(self):
        for text in ["مرحبا", "من انت يا", "من أنت", "hi", "كيف حالك؟", "شكرا"]:
            self.assertTrue(S["_is_plain_chat"](text, []), text)

    def test_tasks_keep_tools(self):
        for text in ["ارسم صورة قطة", "اعمل فيديو 10 ثواني", "افتح مستودع jonsnow-org/Ttbik", "اكتب كود بايثون",
                     "generate an image", "شغل الحاسوب", "https://example.com"]:
            self.assertFalse(S["_is_plain_chat"](text, []), text)

    def test_media_attachment_is_never_plain(self):
        self.assertFalse(S["_is_plain_chat"]("ما هذا", ["image"]))


class ScriptGuard(unittest.TestCase):
    def test_cjk_in_arabic_reply_is_detected_and_removed(self):
        reply = "أنا مساعد ذكاء的人工智能助手. أنا هنا لمساعدتك!"
        self.assertTrue(S["_needs_script_fix"]("من انت يا", reply))
        out = S["_strip_cjk"](reply)
        self.assertNotRegex(out, r"[\u4E00-\u9FFF]")
        self.assertIn("أنا هنا لمساعدتك", out)

    def test_non_arabic_prompt_untouched(self):
        self.assertFalse(S["_needs_script_fix"]("translate to chinese", "你好"))


if __name__ == "__main__":
    unittest.main()
