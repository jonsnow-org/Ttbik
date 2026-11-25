"""Nova's T-LDM feature reader is a second llama-server on the same GGUF. When it exits (memory, or the box killed it) the loaded head must keep
serving over a restarted reader; before 2026-11-25 the cached writer was returned as it was, so every generate_tldm failed until the Studio restarted.
Run: python -m unittest ai-system/modelscope-coder/tests/test_tldm_reader_recovery.py
"""
import importlib.util
import os
import sys
import unittest
from unittest import mock

os.environ["CODER_MODEL_PATH"] = "/nonexistent"
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("coder_app_rr2", os.path.join(HERE, "app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
import nova_tldm_serve as nt  # noqa: E402


class Dead:
    """A feature reader that has exited."""

    def poll(self):
        return 1


class Alive:
    """A feature reader that is still running."""

    def poll(self):
        return None


class Recovery(unittest.TestCase):
    def setUp(self):
        self._saved = dict(nt._STATE)
        nt._STATE.update(writer=None, embed=None)

    def tearDown(self):
        nt._STATE.clear()
        nt._STATE.update(self._saved)

    def test_a_dead_reader_is_restarted_and_the_same_head_keeps_serving(self):
        head = object()
        nt._STATE.update(writer=head, embed=Dead())
        with mock.patch.object(nt, "ensure_embed_server", return_value=True) as restart:
            writer, err = nt.load("llama-server", "nova.gguf")
        self.assertEqual((writer, err), (head, ""))
        restart.assert_called_once()

    def test_a_dead_reader_that_cannot_restart_is_an_honest_error(self):
        nt._STATE.update(writer=object(), embed=Dead())
        with mock.patch.object(nt, "ensure_embed_server", return_value=False):
            writer, err = nt.load("llama-server", "nova.gguf")
        self.assertIsNone(writer)
        self.assertIn("لم يُستخدم نموذج آخر", err)

    def test_a_live_reader_is_not_restarted(self):
        head = object()
        nt._STATE.update(writer=head, embed=Alive())
        with mock.patch.object(nt, "ensure_embed_server") as restart:
            self.assertEqual(nt.load("llama-server", "nova.gguf"), (head, ""))
        restart.assert_not_called()

    def test_a_writer_with_no_reader_recorded_is_served_as_before(self):
        # in-process test doubles (and the module's own self-test) set the head without a reader process
        head = object()
        nt._STATE.update(writer=head, embed=None)
        with mock.patch.object(nt, "ensure_embed_server") as restart:
            self.assertEqual(nt.load("llama-server", "nova.gguf"), (head, ""))
        restart.assert_not_called()


if __name__ == "__main__":
    unittest.main()
