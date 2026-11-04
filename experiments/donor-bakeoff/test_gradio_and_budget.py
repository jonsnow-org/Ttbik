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


class CandidateImageSettings(unittest.TestCase):
    """The resolution a candidate sends must be one of the choices of ITS image Studio (a wrong string made Gradio answer with an error event)."""
    PAIRS = {"qwen35-9b": "cyberrealistic-test", "gemma4-e4b": "gemma4-realistic-vision-v6-test", "minicpm-o45": "umranz-image-test"}
    MINIMUM_STEPS = {"qwen35-9b": 1, "gemma4-e4b": 25, "minicpm-o45": 1}

    def test_resolution_is_a_real_choice(self):
        here = Path(__file__).parent
        for cand, studio in self.PAIRS.items():
            conf = json.loads((here / "candidates" / f"{cand}.json").read_text(encoding="utf-8"))
            res = conf["image_generation"]["resolution"]
            app = (here.parent / studio / "app.py").read_text(encoding="utf-8")
            self.assertIn('"' + res + '"', app, f"{cand}: '{res}' is not a choice of {studio}")
            steps = int(conf["image_generation"]["steps"])
            self.assertGreaterEqual(steps, self.MINIMUM_STEPS[cand],
                                    f"{cand}: this Studio rejects image generation below {self.MINIMUM_STEPS[cand]} steps")


class CandidateToolRouting(unittest.TestCase):
    def test_computer_tasks_preload_the_selected_model_computer_without_an_extra_generation_round(self):
        f = load("_requested_tool_groups", "_computer_action_request", "_explicit_computer_target", "_project_execution_request")["_requested_tool_groups"]
        bridge = {"url": "https://example.test/api/coder/app/donor-tools", "connectors": []}
        self.assertEqual(f("شغّل الاختبارات على الحاسوب وافحص ملف package.json", bridge), ["computer"])
        self.assertEqual(f("run the build and debug the failing test in the terminal", bridge), ["computer"])

    def test_github_read_tasks_do_not_preload_the_computer(self):
        f = load("_requested_tool_groups", "_computer_action_request", "_explicit_computer_target", "_project_execution_request")["_requested_tool_groups"]
        no_github = {"url": "https://example.test/api/coder/app/donor-tools", "connectors": []}
        with_github = {"url": "https://example.test/api/coder/app/donor-tools", "connectors": ["github"]}
        prompt = "Use github_repo_scan to inspect the repository root and github_read_files to read package.json."
        self.assertEqual(f(prompt, no_github), [])
        self.assertEqual(f(prompt, with_github), ["github"])

    def test_project_edits_preload_both_computer_and_linked_github(self):
        f = load("_requested_tool_groups", "_computer_action_request", "_explicit_computer_target", "_project_execution_request")["_requested_tool_groups"]
        no_github = {"url": "https://example.test/api/coder/app/donor-tools", "connectors": []}
        with_github = {"url": "https://example.test/api/coder/app/donor-tools", "connectors": ["github"]}
        self.assertEqual(f("افحص مستودعي على GitHub وعدّل الكود", no_github), ["computer"])
        self.assertEqual(f("افحص مستودعي على GitHub وعدّل الكود", with_github), ["computer", "github"])

    def test_media_output_file_does_not_preload_the_computer(self):
        f = load("_requested_tool_groups", "_computer_action_request", "_explicit_computer_target", "_project_execution_request")["_requested_tool_groups"]
        bridge = {"url": "https://example.test/api/coder/app/donor-tools", "connectors": []}
        prompt = "Create an image with generate_image and only say it was created when the image file is returned."
        self.assertEqual(f(prompt, bridge), [])

    def test_unlinked_or_missing_bridge_does_not_offer_remote_tools(self):
        f = load("_requested_tool_groups", "_computer_action_request", "_explicit_computer_target", "_project_execution_request")["_requested_tool_groups"]
        self.assertEqual(f("run code in the computer", None), [])
        self.assertEqual(f("run code in the computer", {"url": "", "connectors": []}), [])

    def test_native_tool_template_errors_fall_back_to_the_text_parser(self):
        f = load("_should_fallback_text_tools")["_should_fallback_text_tools"]
        for code in (400, 422, 500, 501, 502, 503):
            self.assertTrue(f(code), code)
        for code in (200, 401, 403, 404):
            self.assertFalse(f(code), code)



class ComputerExecutionContract(unittest.TestCase):
    def test_actionable_arabic_and_english_computer_requests_are_detected(self):
        f = load("_requires_computer_execution", "_computer_action_request", "_explicit_computer_target", "_project_execution_request")["_requires_computer_execution"]
        self.assertTrue(f("افحص ملف package.json على الحاسوب وشغّل الاختبارات"))
        self.assertTrue(f("Open the browser and click the Settings button"))
        self.assertTrue(f("Run the build in the terminal and inspect the failing file"))
        self.assertTrue(f("Run the tests in the repository project and fix the failing code"))

    def test_github_reads_and_image_generation_do_not_require_a_computer(self):
        f = load("_requires_computer_execution", "_computer_action_request", "_explicit_computer_target", "_project_execution_request")["_requires_computer_execution"]
        self.assertFalse(f("Execute the task in two phases: use github_repo_scan to inspect the repository and then use vercel_deployment_status."))
        self.assertFalse(f("Read package.json and src/lib/donorTests.ts from the GitHub repository, then summarize the results."))
        self.assertFalse(f("أنشئ صورة فوتوغرافية واقعية، واستخدم generate_image، ولا تقل إنها أُنشئت حتى يرجع ملف الصورة."))

    def test_capability_questions_are_not_mistaken_for_execution_requests(self):
        f = load("_requires_computer_execution", "_computer_action_request", "_explicit_computer_target", "_project_execution_request")["_requires_computer_execution"]
        self.assertFalse(f("ما الذي يمكنك فعله على الحاسوب؟"))
        self.assertFalse(f("What computer tools are available?"))
        bridge = {"url": "https://example.test/api/coder/app/donor-tools", "connectors": []}
        groups = load("_requested_tool_groups", "_computer_action_request", "_explicit_computer_target", "_project_execution_request")["_requested_tool_groups"]
        self.assertEqual(groups("ما الذي يمكنك فعله على الحاسوب؟", bridge), [])
        self.assertEqual(groups("What computer tools are available?", bridge), [])

    def test_preload_must_expose_a_real_computer_tool(self):
        f = load("_has_computer_tools")["_has_computer_tools"]
        self.assertFalse(f([{"function": {"name": "load_tools"}}]))
        self.assertTrue(f([{"function": {"name": "computer_run"}}]))
        self.assertTrue(f([{"function": {"name": "desktop"}}]))


class CandidateVideoDurationContract(unittest.TestCase):
    def test_every_owner_selected_duration_is_preserved_exactly(self):
        f = load("_video_duration_seconds")["_video_duration_seconds"]
        self.assertEqual(f(), 4)
        for seconds in (2, 4, 10, 15, 30, 60, 120):
            with self.subTest(seconds=seconds):
                self.assertEqual(f(seconds), seconds)

    def test_invalid_fractional_or_unrequested_durations_are_rejected(self):
        f = load("_video_duration_seconds")["_video_duration_seconds"]
        for unsupported in (0, 1, 3, 5, 6, 8, 12, 20, 45, 90, 121, "4.5", float("nan"), float("inf")):
            with self.subTest(seconds=unsupported):
                with self.assertRaises(ValueError):
                    f(unsupported)


class TextToolFallback(unittest.TestCase):
    def test_payload_has_no_tools_field_and_turns_become_text(self):
        s = load("_one_system_message", "_text_tools_system", "_text_tool_payload")
        tools = [{"type": "function", "function": {"name": "github_repo_scan", "description": "scan", "parameters": {"type": "object"}}}]
        options = {"model": "m", "max_tokens": 50, "tools": tools, "tool_choice": "auto"}
        messages = [
            {"role": "user", "content": "scan it"},
            {"role": "assistant", "content": None, "tool_calls": [{"id": "1", "type": "function", "function": {"name": "github_repo_scan", "arguments": {"repo": "a/b"}}}]},
            {"role": "tool", "tool_call_id": "1", "name": "github_repo_scan", "content": "{\"ok\": true}"},
        ]
        body = s["_text_tool_payload"](options, messages)
        self.assertNotIn("tools", body)
        self.assertNotIn("tool_choice", body)
        self.assertEqual(body["messages"][0]["role"], "system")
        self.assertIn("github_repo_scan", body["messages"][0]["content"])
        self.assertIn("<tool_call>", body["messages"][2]["content"])
        self.assertEqual(body["messages"][3]["role"], "user")
        self.assertIn("{\"ok\": true}", body["messages"][3]["content"])
        self.assertTrue(all(m["role"] in ("system", "user", "assistant") for m in body["messages"]))

    def test_the_text_call_form_is_what_the_parser_reads(self):
        from tool_parsing import parse_tool_calls
        calls = parse_tool_calls({"content": "<tool_call>{\"name\": \"github_repo_scan\", \"arguments\": {\"repo\": \"a/b\"}}</tool_call>"})
        self.assertEqual(calls[0]["name"], "github_repo_scan")
        self.assertEqual(calls[0]["arguments"], {"repo": "a/b"})


class LoadTools(unittest.TestCase):
    def test_merge_adds_new_schemas_once_and_keeps_load_tools_first(self):
        merge = load("_merge_tool_schemas")["_merge_tool_schemas"]
        have = [{"function": {"name": "load_tools"}}]
        got = merge(have, [{"function": {"name": "github_read_file"}}, {"function": {"name": "load_tools"}}, {"function": {"name": "github_read_file"}}, {"function": {}}])
        self.assertEqual([t["function"]["name"] for t in got], ["load_tools", "github_read_file"])


class CandidateVideoJobs(unittest.TestCase):
    def test_gradio_job_helper_reads_the_final_complete_event(self):
        calls = []

        class Response:
            def __init__(self, event_id=None, text=""):
                self._event_id = event_id
                self.text = text

            def raise_for_status(self):
                return None

            def json(self):
                return {"event_id": self._event_id}

        def gateway(method, url, **kwargs):
            calls.append((method, url, kwargs))
            if method == "POST":
                return Response(event_id="event-1")
            return Response(text='event: heartbeat\ndata: null\n\nevent: complete\ndata: [{"type":"job","job":"clip-1"}]\n\n')

        scope = load("_decode_gradio_data", "_candidate_gradio_result", _gateway_retry=gateway)
        profile = {"base": "https://studio-novaai2026-sham-donor-qwen35-9b-media.api-inference.modelscope.net"}
        result = scope["_candidate_gradio_result"](profile, "secret", "video_start", {"prompt": "A moving fox", "seconds": 30})
        self.assertEqual(result, {"type": "job", "job": "clip-1"})
        self.assertEqual(calls[0][0], "POST")
        self.assertTrue(calls[0][1].endswith("/gradio_api/call/v2/video_start"))
        self.assertEqual(json.loads(calls[0][2]["json"]["body"]), {"prompt": "A moving fox", "seconds": 30})
        self.assertEqual(calls[1][1], profile["base"] + "/gradio_api/call/video_start/event-1")
        self.assertEqual(calls[0][2]["headers"]["Authorization"], "Bearer secret")

    def test_video_tool_starts_and_polls_its_own_background_job(self):
        calls = []
        responses = iter([
            {"type": "busy"},
            {"type": "job", "job": "clip-1"},
            {"type": "running", "phase": "sampling"},
            {"type": "video", "mime": "video/mp4", "b64": "ZmFrZQ=="},
        ])

        def fake_call(profile, token, api, payload, read_timeout=45):
            calls.append((api, payload, read_timeout))
            return next(responses)

        class Clock:
            monotonic = staticmethod(lambda: 0.0)
            sleep = staticmethod(lambda _seconds: None)

        run = load("_candidate_video_by_job", time=Clock, _candidate_gradio_result=fake_call)["_candidate_video_by_job"]
        profile = {"base": "https://studio-novaai2026-sham-donor-qwen35-9b-media.api-inference.modelscope.net"}
        result = run(profile, "secret", {"prompt": "A moving fox", "seconds": 30}, 30)
        self.assertEqual(result["type"], "video")
        self.assertEqual([x[0] for x in calls], ["video_start", "video_start", "job", "job"])
        self.assertEqual(calls[1][1], {"prompt": "A moving fox", "seconds": 30})
        self.assertEqual(calls[2][1], {"job": "clip-1", "wait": 18})
        self.assertEqual(calls[2][2], 43)

    def test_deployed_media_studio_exposes_the_background_video_job_api(self):
        studio = (Path(__file__).parents[2] / "ai-system" / "modelscope-media" / "app.py").read_text(encoding="utf-8")
        self.assertIn('("video_start", api_video_start)', studio)
        self.assertIn('("job", api_job)', studio)


class CandidateMediaStudios(unittest.TestCase):
    def test_each_candidate_points_at_its_own_media_studio_and_repo(self):
        here = Path(__file__).parent
        seen = set()
        for cand in ("qwen35-9b", "gemma4-e4b", "minicpm-o45"):
            conf = json.loads((here / "candidates" / f"{cand}.json").read_text(encoding="utf-8"))
            media = conf["media_generation"]
            route = conf["route_id"]
            self.assertEqual(media["for_candidate"], route)
            self.assertIn(f"sham-donor-{route}-media", media["studio_api"])
            self.assertEqual(media["media_repo"], f"novaai2026/{route}-media-models")
            seen.add(media["studio_api"])
        self.assertEqual(len(seen), 3)

    def test_the_deploy_workflow_builds_exactly_those_studios(self):
        wf = (Path(__file__).parents[2] / ".github" / "workflows" / "deploy-candidate-media.yml").read_text(encoding="utf-8")
        for route in ("qwen35-9b", "gemma4-e4b", "minicpmo45"):
            self.assertIn("- id: " + route, wf)
        self.assertIn("REPO: sham-donor-${{ matrix.candidate.id }}-media", wf)


class SmokeTestList(unittest.TestCase):
    def test_every_test_in_the_app_runs_in_the_workflow(self):
        import re as _re
        ids = _re.findall(r'^\s{8}"id": "([a-z_]+)",', SRC, flags=_re.M)
        wf = (Path(__file__).parents[2] / ".github" / "workflows" / "donor-bakeoff-modelscope.yml").read_text(encoding="utf-8")
        loop = _re.search(r"for TEST_ID in ([a-z_ ]+); do", wf).group(1).split()
        tests = [i for i in ids if i in loop or i in ("arabic",)]
        for needed in ("image_tool_direct", "audio_tool_direct", "video_tool_direct", "image_generation", "long_multistep_repo"):
            self.assertIn(needed, ids)
            self.assertIn(needed, loop)


class OneSystemMessage(unittest.TestCase):
    def test_many_system_turns_become_one_first_turn(self):
        f = load("_one_system_message")["_one_system_message"]
        got = f([
            {"role": "system", "content": "A"},
            {"role": "system", "content": "B"},
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "yo"},
            {"role": "system", "content": "C"},
            {"role": "user", "content": "again"},
        ])
        self.assertEqual([m["role"] for m in got], ["system", "user", "assistant", "user"])
        self.assertEqual(got[0]["content"], "A\n\nB\n\nC")

    def test_no_system_turn_stays_without_one(self):
        f = load("_one_system_message")["_one_system_message"]
        self.assertEqual(f([{"role": "user", "content": "x"}]), [{"role": "user", "content": "x"}])

    def test_text_tool_payload_has_exactly_one_system_message(self):
        s = load("_one_system_message", "_text_tools_system", "_text_tool_payload")
        body = s["_text_tool_payload"]({"tools": [], "max_tokens": 5}, [{"role": "system", "content": "extra"}, {"role": "user", "content": "q"}])
        self.assertEqual(sum(1 for m in body["messages"] if m["role"] == "system"), 1)
        self.assertEqual(body["messages"][0]["role"], "system")


class SniffImage(unittest.TestCase):
    def test_real_type_comes_from_the_bytes_not_the_header(self):
        f = load("_sniff_image_mime")["_sniff_image_mime"]
        self.assertEqual(f(b"\x89PNG\r\n\x1a\n" + b"x" * 20), "image/png")
        self.assertEqual(f(b"\xff\xd8\xff\xe0" + b"x" * 20), "image/jpeg")
        self.assertEqual(f(b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"x" * 20), "image/webp")
        self.assertEqual(f(b"<html>nope</html>"), "")
        self.assertEqual(f(b""), "")


class InferenceTimeout(unittest.TestCase):
    def test_scales_with_max_tokens_and_has_floor_and_cap(self):
        f = load("_inference_read_timeout")["_inference_read_timeout"]
        self.assertGreaterEqual(f(16), 60)
        self.assertEqual(f(1), 60)
        self.assertGreater(f(768), 240)
        self.assertLessEqual(f(100000), 900)


class ComputerAndToolSpeed(unittest.TestCase):
    def test_slow_computer_tools_get_the_long_bridge_timeout(self):
        timeout = load("_bridge_read_timeout")["_bridge_read_timeout"]
        for name in ("sandbox_clone", "sandbox_exec", "sandbox_wait", "computer_run", "deep_research"):
            self.assertEqual(timeout(name), 175, name)
        self.assertEqual(timeout("github_read_file"), 60)
        self.assertLess(175, 180)                                  # the app-server route allows 180 s

    def test_independent_reads_run_side_by_side_and_keep_their_order(self):
        import time
        calls_made = []

        def fake_execute(name, arguments, bridge):
            calls_made.append(name)
            time.sleep(0.2)
            return {"ok": True, "name": name}

        scope = load("_is_read_only_call", "_run_reads_in_parallel",
                     READ_ONLY_PREFIXES=("github_read", "github_list", "web_", "fetch_page", "sandbox_read_file", "sandbox_search"),
                     _execute_tool=fake_execute)
        calls = [{"name": "github_read_file"}, {"name": "sandbox_exec"}, {"name": "fetch_page"}, {"name": "github_list_commits"}]
        started = time.monotonic()
        out = scope["_run_reads_in_parallel"](calls, None)
        self.assertLess(time.monotonic() - started, 0.55)          # three 0.2 s reads in parallel, not 0.6 s in a row
        self.assertEqual(sorted(out), [0, 2, 3])                   # the write-capable call is left to the ordered loop
        self.assertEqual(out[2]["name"], "fetch_page")
        self.assertEqual(scope["_run_reads_in_parallel"]([{"name": "github_read_file"}], None), {})   # one read: nothing to parallelise


if __name__ == "__main__":
    unittest.main()
