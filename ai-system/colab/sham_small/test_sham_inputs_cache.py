"""A half-written cached copy of a checkpoint dataset must never be handed back again.

2026-11-18, ai Studio sham-trainer-tools: a copy of sham-merged-checkpoint left on the persistent disk without final_merged.pt was returned by
fetch_dataset on every cycle, so sham_live.resolve_start found no start point and the trainer failed 8 cycles in a row.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import train_audio_tokenizer
import train_image_tokenizer

_KEEP = (train_image_tokenizer.train_vqvae, train_audio_tokenizer.train_vqvae)
import sham_inputs  # noqa: E402  (importing it swaps the tokenizer trainers process-wide: put them back so later tests see the originals)

train_image_tokenizer.train_vqvae, train_audio_tokenizer.train_vqvae = _KEEP


class StaleCacheTest(unittest.TestCase):
    def setUp(self):
        self.td = Path(tempfile.mkdtemp())
        self._root = sham_inputs.FETCH_ROOT
        sham_inputs.FETCH_ROOT = self.td
        self._env = mock.patch.dict(os.environ, {"SHAM_HEAD_SOURCE": "modelscope"})
        self._env.start()

    def tearDown(self):
        sham_inputs.FETCH_ROOT = self._root
        self._env.stop()

    def _stale(self, name, files):
        d = self.td / name
        d.mkdir(parents=True)
        for f, data in files.items():
            (d / f).write_bytes(data)
        return d

    def test_half_written_head_is_refetched(self):
        self._stale("sham-merged-checkpoint", {"sham_small_tokenizer.json": b"{}", "final_merged.pt": b""})    # truncated weights + tokenizer only

        def pull(dest):
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "final_merged.pt").write_bytes(b"w" * 10)
            (dest / "sham_small_tokenizer.json").write_bytes(b"{}")
            return True

        with mock.patch.object(sham_inputs, "_head_from_modelscope", side_effect=pull) as m:
            got = sham_inputs.fetch_dataset("sham-merged-checkpoint")
        self.assertEqual(m.call_count, 1)
        self.assertTrue((got / "final_merged.pt").stat().st_size > 0)

    def test_stale_line_without_credentials_gives_none_not_the_stale_folder(self):
        self._stale("sham-chat-checkpoint", {"notes.txt": b"x"})
        with mock.patch.object(sham_inputs, "_ensure_credentials", return_value=None):
            self.assertIsNone(sham_inputs.fetch_dataset("sham-chat-checkpoint"))
        self.assertFalse((self.td / "sham-chat-checkpoint").exists())

    def test_complete_cache_is_reused_without_download(self):
        d = self._stale("sham-merged-checkpoint", {"final_merged.pt": b"w", "sham_small_tokenizer.json": b"{}"})
        with mock.patch.object(sham_inputs, "_head_from_modelscope") as m:
            self.assertEqual(sham_inputs.fetch_dataset("sham-merged-checkpoint"), d)
        m.assert_not_called()

    def test_other_datasets_keep_the_old_cache_rule(self):
        d = self._stale("sham-crawl-ms3-corpus", {"a.txt": b"x"})
        self.assertEqual(sham_inputs.fetch_dataset("sham-crawl-ms3-corpus"), d)


if __name__ == "__main__":
    unittest.main()
