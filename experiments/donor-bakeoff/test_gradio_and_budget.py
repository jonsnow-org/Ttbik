"""Pure-function tests for app.py (no gradio / llama needed): the helpers are pulled out of the source with ast."""
import ast
import json
import re
import unittest
from pathlib import Path

SRC = Path(__file__).with_name("app.py").read_text(encoding="utf-8")


def load(*names, **env):
    tree = ast.parse(SRC)
    picked = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    scope = {"json": json, "re": re, **env}
    exec(compile(ast.Module(body=picked, type_ignores=[]), "app.py", "exec"), scope)
    return scope


class GradioData(unittest.TestCase):
    def test_slow_call_uses_the_complete_event_not_a_heartbeat(self):
        raw = "event: heartbeat\ndata: null\n\nevent: generating\ndata: null\n\nevent: complete\ndata: [{\"path\": \"/tmp/x.png\"}, {\"result\": \"image_generated\"}]\n\n"
        got = load("_decode_gradio_data")["_decode_gradio_data"](raw)
        self.assertEqual(got[1]["result"], "image_generated")

    def test_double_encoded_payload_is_decoded(self):
        raw = "event: complete\ndata: " + json.dumps(json.dumps([{"a": 1}])) + "\n\n"
        self.assertEqual(load("_decode_gradio_data")["_decode_gradio_data"](raw), [{"a": 1}])

    def test_only_null_frames_give_none(self):
        self.assertIsNone(load("_decode_gradio_data")["_decode_gradio_data"]("event: heartbeat\ndata: null\n\n"))


class ToolResultBudget(unittest.TestCase):
    def fit(self, n_ctx, text_len, calls=1):
        s = load("_approx_tokens", "_fit_tool_result", N_CTX=n_ctx)
        out = s["_fit_tool_result"]({"ok": True, "content": "x" * text_len}, [{"role": "user", "content": "q" * 300}], {"tools": [{"a": "b" * 600}], "max_tokens": 700}, calls)
        return out, s["_approx_tokens"](out)

    def test_small_window_cuts_hard_and_says_so(self):
        out, tokens = self.fit(2048, 20000)
        self.assertIn("cut to fit the context window", out)
        self.assertLessEqual(tokens, 800)

    def test_big_window_keeps_more(self):
        small, _ = self.fit(2048, 20000)
        big, _ = self.fit(8192, 20000)
        self.assertGreater(len(big), len(small))
        self.assertLessEqual(len(big), 8100)

    def test_short_result_is_untouched(self):
        out, _ = self.fit(2048, 50)
        self.assertNotIn("cut to fit", out)

    def test_many_calls_share_the_room(self):
        one, _ = self.fit(4096, 20000, 1)
        three, _ = self.fit(4096, 20000, 3)
        self.assertLess(len(three), len(one))


class LongTaskRubric(unittest.TestCase):
    def test_word_scripts_counts(self):
        f = load("_mentions_script")["_mentions_script"]
        self.assertTrue(f("الأمر في scripts هو build", []))

    def test_real_command_from_the_tool_result_counts(self):
        f = load("_mentions_script")["_mentions_script"]
        tools = [{"name": "github_read_files", "result": {"files": [{"content": '{"scripts": {"build": "prisma generate && next build --webpack"}}'}]}}]
        self.assertTrue(f('أمر التشغيل `"build": "prisma generate && next build --webpack"`', tools))

    def test_invented_command_does_not_count(self):
        f = load("_mentions_script")["_mentions_script"]
        tools = [{"name": "github_read_files", "result": {"files": [{"content": '{"build": "next build"}'}]}}]
        self.assertFalse(f('تم تشغيل "deploy": "make it so"', tools))


if __name__ == "__main__":
    unittest.main()


class CandidateImageSettings(unittest.TestCase):
    """The resolution a candidate sends must be one of the choices of ITS image Studio (a wrong string made Gradio answer with an error event)."""
    PAIRS = {"qwen35-9b": "cyberrealistic-test", "gemma4-e4b": "gemma4-realistic-vision-v6-test", "minicpm-o45": "umranz-image-test"}

    def test_resolution_is_a_real_choice(self):
        here = Path(__file__).parent
        for cand, studio in self.PAIRS.items():
            conf = json.loads((here / "candidates" / f"{cand}.json").read_text(encoding="utf-8"))
            res = conf["image_generation"]["resolution"]
            app = (here.parent / studio / "app.py").read_text(encoding="utf-8")
            self.assertIn('"' + res + '"', app, f"{cand}: '{res}' is not a choice of {studio}")
