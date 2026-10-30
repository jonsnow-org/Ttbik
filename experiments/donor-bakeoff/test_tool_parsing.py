import unittest
from tool_parsing import parse_tool_calls, strip_tool_call_markup


class ToolParsingTests(unittest.TestCase):
    def test_gemma_single_call(self):
        msg = {"content": '<|tool_call>call:github_repo_scan{repo:<|"|>jonsnow-org/Ttbik<|"|>}<tool_call|><|tool_response>'}
        self.assertEqual(parse_tool_calls(msg), [{"name": "github_repo_scan", "arguments": {"repo": "jonsnow-org/Ttbik"}}])

    def test_gemma_multiple_calls_and_array_arguments(self):
        content = (
            '<|tool_call>call:github_read_files{repo:<|"|>jonsnow-org/Ttbik<|"|>,'
            'paths:[<|"|>package.json<|"|>,<|"|>src/lib/donorTests.ts<|"|>],'
            'ref:<|"|>main<|"|>,focus_terms:[<|"|>donorTestChat<|"|>]}<tool_call|>'
            '<|tool_call>call:vercel_deployment_status{project:<|"|>ttbik<|"|>}<tool_call|>'
        )
        calls = parse_tool_calls({"content": content})
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["arguments"]["paths"], ["package.json", "src/lib/donorTests.ts"])
        self.assertEqual(calls[0]["arguments"]["focus_terms"], ["donorTestChat"])
        self.assertEqual(calls[1]["arguments"], {"project": "ttbik"})

    def test_openai_function_call(self):
        msg = {"tool_calls": [{"function": {"name": "github_repo_scan", "arguments": '{"repo":"a/b"}'}}]}
        self.assertEqual(parse_tool_calls(msg), [{"name": "github_repo_scan", "arguments": {"repo": "a/b"}}])

    def test_qwen_json_tool_call(self):
        msg = {"content": '<tool_call>{"name":"github_repo_scan","arguments":{"repo":"a/b"}}</tool_call>'}
        self.assertEqual(parse_tool_calls(msg), [{"name": "github_repo_scan", "arguments": {"repo": "a/b"}}])

    def test_minicpm_json_tool_call_with_surrounding_text(self):
        msg = {
            "content": 'Use the requested function now.\\n<tool_call>\\n'
                       '{"name":"github_repo_scan","arguments":{"repo":"example/repo"}}\\n'
                       '</tool_call>\\n',
        }
        self.assertEqual(
            parse_tool_calls(msg),
            [{"name": "github_repo_scan", "arguments": {"repo": "example/repo"}}],
        )
        self.assertNotIn("<tool_call>", strip_tool_call_markup(msg["content"]))

    def test_function_parameter_call(self):
        msg = {"content": '<function=github_repo_scan><parameter=repo>"a/b"</parameter></function>'}
        self.assertEqual(parse_tool_calls(msg), [{"name": "github_repo_scan", "arguments": {"repo": "a/b"}}])

    def test_strip_gemma_markup(self):
        raw = 'hello<|tool_call>call:github_repo_scan{repo:<|"|>a/b<|"|>}<tool_call|><|tool_response>'
        self.assertEqual(strip_tool_call_markup(raw), "hello")


if __name__ == "__main__":
    unittest.main()
