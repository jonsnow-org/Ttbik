"""Unit tests for the Sham v2 Gradio smoke client's SSE event reader."""
from __future__ import annotations

import unittest
from unittest.mock import patch

import sham_v2_media_smoke as smoke


class FakeResponse:
    def __init__(self, *, body: bytes = b"", lines: list[bytes] | None = None, stream: bool = False):
        self.body = body
        self.lines = list(lines or [])
        self.stream = stream

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, *_args, **_kwargs):
        if self.stream:
            raise AssertionError("SSE responses must be consumed line-by-line, not via read()")
        return self.body

    def readline(self):
        return self.lines.pop(0) if self.lines else b""


class ShamV2MediaSmokeStreamTests(unittest.TestCase):
    def test_call_parses_complete_sse_event_without_waiting_for_stream_eof(self):
        submitted = FakeResponse(body=b'{"event_id":"event-123"}')
        stream = FakeResponse(
            stream=True,
            lines=[
                b"event: complete\n",
                b'data: ["{\\\"phase\\\": \\\"ready\\\", \\\"detail\\\": \\\"loaded\\\"}"]\n',
            ],
        )
        with patch.object(smoke, "urlopen", side_effect=[submitted, stream]) as open_url:
            result = smoke.call("status", {}, timeout=3)

        self.assertEqual(result, {"phase": "ready", "detail": "loaded"})
        self.assertEqual(open_url.call_count, 2)

    def test_unwrap_ignores_sse_metadata_and_heartbeat_lines(self):
        self.assertIsNone(smoke.unwrap("event: heartbeat\\n"))
        self.assertIsNone(smoke.unwrap("data: null\\n"))


if __name__ == "__main__":
    unittest.main()
