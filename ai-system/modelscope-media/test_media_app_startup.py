"""Regression tests for media Studio startup ordering (no weights, network, or GPU)."""
from pathlib import Path
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as media_app  # noqa: E402


class FakeDemo:
    def __init__(self, events):
        self.events = events
        self.launch_kwargs = None

    def queue(self, **kwargs):
        self.events.append(("queue", kwargs))
        return self

    def launch(self, **kwargs):
        self.events.append(("launch", kwargs))
        self.launch_kwargs = kwargs
        return self


class MediaStudioStartupTests(unittest.TestCase):
    def test_http_server_binds_before_weight_warmup_and_process_stays_alive(self):
        events = []

        class FakeThread:
            def __init__(self, *, target, name, daemon):
                self.target = target
                self.name = name
                self.daemon = daemon

            def start(self):
                events.append(("warm-start", self.name, self.daemon))

        class FakeEvent:
            def wait(self):
                events.append(("keepalive",))

        demo = FakeDemo(events)
        with patch.object(media_app.threading, "Thread", FakeThread), patch.object(media_app.threading, "Event", FakeEvent):
            media_app._serve_demo(demo)

        self.assertEqual([entry[0] for entry in events], ["queue", "launch", "warm-start", "keepalive"])
        self.assertTrue(demo.launch_kwargs["prevent_thread_lock"])
        self.assertEqual(demo.launch_kwargs["server_name"], "0.0.0.0")
        self.assertEqual(demo.launch_kwargs["server_port"], int(os.environ.get("PORT", 7860)))
        self.assertTrue(events[2][2])


if __name__ == "__main__":
    unittest.main()
