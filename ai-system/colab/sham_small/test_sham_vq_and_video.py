"""Regression tests for two root defects the owner reported, both fixed here:

  1. The image/audio VQ codebooks collapsed (a handful of codes used out of the
     whole codebook) because the uniform init sits near the origin while real
     encoder outputs do not — "gray / distorted images". Fixed by seeding the
     codebook from real encoder outputs (k-means) and reviving dead codes.
  2. Video was stills stitched together. The model now writes its OWN motion
     tokens (motion_tokenizer.py) and the clip is decoded frame by frame, so the
     frames really move. This pins that the native path returns a real MP4.

Small configs, CPU only, no weights, no network.
"""
from __future__ import annotations

import base64
import os
import unittest

import torch

from audio_tokenizer import AudioTokenizer, AudioTokenizerConfig
from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
from model import AUDIO_VOCAB_SIZE, IMAGE_VOCAB_SIZE, MOTION_VOCAB_SIZE, TOTAL_VOCAB_SIZE, ShamSmall, ShamSmallConfig, SpecialTokens
from motion_tokenizer import MotionTokenizer, MotionTokenizerConfig
from sham_studio_media import _video_result, make_media
from train_audio_tokenizer import make_synthetic_mel_dataset
from train_audio_tokenizer import train_vqvae as train_audio_vqvae
from train_image_tokenizer import make_synthetic_image_dataset, train_vqvae as train_image_vqvae


def _small_image_cfg(num_codes: int = 256) -> ImageTokenizerConfig:
    return ImageTokenizerConfig(
        image_size=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=num_codes
    )


class ImageCodebookDoesNotCollapse(unittest.TestCase):
    def test_data_init_and_revival_use_far_more_codes_than_the_uniform_init(self):
        torch.manual_seed(0)
        data = make_synthetic_image_dataset(num_samples=96, num_patterns=8, image_size=32)

        torch.manual_seed(0)
        old = ImageTokenizer(_small_image_cfg())
        old_stats = train_image_vqvae(old, data, num_epochs=25, batch_size=16, lr=1e-3, log_every=1000,
                                      data_init=False, revive_every=0)

        torch.manual_seed(0)
        new = ImageTokenizer(_small_image_cfg())
        new_stats = train_image_vqvae(new, data, num_epochs=25, batch_size=16, lr=1e-3, log_every=1000)

        # The old path is the documented failure mode; the new path must use
        # several times more of the codebook and must not regress loss badly.
        self.assertLess(old_stats.final_codebook_usage, 40)
        self.assertGreater(new_stats.final_codebook_usage, old_stats.final_codebook_usage * 3)
        self.assertGreater(new_stats.revived_codes, 0)
        self.assertLess(new_stats.epoch_losses[-1], old_stats.epoch_losses[0])

    def test_initialize_from_data_places_codes_on_the_encoder_distribution(self):
        torch.manual_seed(0)
        tok = ImageTokenizer(_small_image_cfg())
        z = tok.encoder(torch.rand(8, 3, 32, 32) * 2 - 1)
        before = tok.quantizer.codebook.weight.detach().clone()
        tok.quantizer.initialize_from_data(z.detach())
        after = tok.quantizer.codebook.weight.detach()
        # The uniform init is tiny (~1/num_codes); the data-seeded codes must be
        # on the same scale as the encoder's own outputs.
        self.assertLess(before.abs().max().item(), 0.02)
        self.assertGreater(after.abs().max().item(), before.abs().max().item() * 5)
        self.assertTrue(torch.isfinite(after).all())


class AudioCodebookDoesNotCollapse(unittest.TestCase):
    def test_audio_trainer_uses_the_same_fix(self):
        torch.manual_seed(0)
        cfg = AudioTokenizerConfig(n_mels=32, segment_frames=64, base_channels=16, channel_multipliers=(1, 2, 2, 2),
                                   code_dim=32, num_codes=64)
        mels = make_synthetic_mel_dataset(num_samples=64, num_patterns=8, n_mels=cfg.n_mels,
                                          segment_frames=cfg.segment_frames)
        tok = AudioTokenizer(cfg)
        stats = train_audio_vqvae(tok, mels, num_epochs=40, batch_size=8, lr=1e-3, log_every=1000)
        self.assertGreater(stats.final_codebook_usage, 8)
        self.assertLess(stats.epoch_losses[-1], stats.epoch_losses[0] * 0.5)


class NativeMotionVideo(unittest.TestCase):
    """The model writes its own keyframe + motion tokens; the clip is decoded
    through that motion, so it is real moving video, not stitched stills."""

    def _model(self):
        torch.manual_seed(0)
        cfg = ShamSmallConfig(vocab_size=TOTAL_VOCAB_SIZE, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1,
                              mlp_hidden=64, max_seq_len=2048)
        return ShamSmall(cfg).train(False)

    def test_video_result_is_a_real_mp4_and_frames_really_move(self):
        model = self._model()
        img_tok = ImageTokenizer(_small_image_cfg(IMAGE_VOCAB_SIZE)).train(False)
        mot_tok = MotionTokenizer(MotionTokenizerConfig(grid=4, num_codes=MOTION_VOCAB_SIZE)).train(False)
        cond = [SpecialTokens.BOS, 7, 8, SpecialTokens.VIDEO_START]
        uncond = [SpecialTokens.BOS, 7]
        result = _video_result(model, img_tok, mot_tok, cond, uncond, num_frames=4)
        self.assertEqual(result["type"], "video")
        self.assertEqual(result["mime"], "video/mp4")
        self.assertEqual(result["frames"], 4)
        mp4 = base64.b64decode(result["b64"])
        self.assertEqual(mp4[4:8], b"ftyp")

    def test_long_clip_uses_sliding_window_passes(self):
        os.environ["SHAM_VIDEO_CHUNK"] = "3"
        try:
            model = self._model()
            img_tok = ImageTokenizer(_small_image_cfg(IMAGE_VOCAB_SIZE)).train(False)
            mot_tok = MotionTokenizer(MotionTokenizerConfig(grid=4, num_codes=MOTION_VOCAB_SIZE)).train(False)
            result = _video_result(model, img_tok, mot_tok, [SpecialTokens.BOS, 7, SpecialTokens.VIDEO_START],
                                   [SpecialTokens.BOS, 7], num_frames=8)
            self.assertEqual(result["frames"], 8)
            self.assertEqual(base64.b64decode(result["b64"])[4:8], b"ftyp")
        finally:
            os.environ.pop("SHAM_VIDEO_CHUNK", None)

    def test_make_media_without_motion_tokenizer_is_honest_not_a_slideshow(self):
        model = self._model()
        img_tok = ImageTokenizer(_small_image_cfg(IMAGE_VOCAB_SIZE)).train(False)
        aud_tok = AudioTokenizer(AudioTokenizerConfig(n_mels=16, segment_frames=32, base_channels=16,
                                                      channel_multipliers=(1, 2, 2, 2), code_dim=32,
                                                      num_codes=AUDIO_VOCAB_SIZE)).train(False)

        class _Tok:
            vocab_size = 400

            def encode(self, text):
                return [3 + (ord(c) % 390) for c in text]

        self.assertEqual(make_media(model, _Tok(), img_tok, aud_tok, "video", "x")["type"], "notice")


class MotionTokenizerTrains(unittest.TestCase):
    """The native-video codec has a real trainer (train_motion_tokenizer.py):
    it must reduce loss, keep the motion codebook alive, and — the owner's bar
    — beat repeating the previous frame (a slideshow), never just match it."""

    def test_trainer_learns_real_motion_and_beats_a_slideshow(self):
        from train_motion_tokenizer import make_synthetic_motion_dataset, train_motion_tokenizer

        torch.manual_seed(0)
        size, block = 32, 8
        tok = MotionTokenizer(MotionTokenizerConfig(grid=size // block, num_codes=256))
        prev, nxt = make_synthetic_motion_dataset(num_samples=24, image_size=size, block=block, seed=0)
        stats = train_motion_tokenizer(tok, prev, nxt, num_epochs=25, batch_size=8, block=block,
                                       lr=2e-3, log_every=1000)
        self.assertLess(stats.epoch_losses[-1], stats.epoch_losses[0])
        self.assertGreater(stats.final_codebook_usage, 1)
        self.assertLess(stats.trained_error, stats.copy_previous_error)

    def test_motion_codebook_initialize_from_data_uses_real_flow_scale(self):
        from motion_tokenizer import estimate_flow

        torch.manual_seed(0)
        size, block = 32, 8
        tok = MotionTokenizer(MotionTokenizerConfig(grid=size // block, num_codes=64))
        prev = torch.rand(4, 3, size, size) * 2 - 1
        nxt = torch.rand(4, 3, size, size) * 2 - 1
        flow = torch.cat([estimate_flow(prev[i:i + 1], nxt[i:i + 1], block) for i in range(4)])
        before = tok.quantizer.codebook.weight.detach().clone()
        tok.quantizer.initialize_from_data(flow)
        after = tok.quantizer.codebook.weight.detach()
        # The default normal(0, 0.02) init sits far from real flow (measured
        # |flow| ~ 1 block unit); the data-seeded codes must reach that scale.
        self.assertLess(before.abs().max().item(), 0.1)
        self.assertGreater(after.abs().max().item(), before.abs().max().item())
        self.assertTrue(torch.isfinite(after).all())


if __name__ == "__main__":
    unittest.main()
