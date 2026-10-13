"""
Sham media codec helpers: whole clips -> the model's vocabulary ids (the code moves the model; nothing here writes answers or rules).

  audio_vocab_ids(audio_tokenizer, waveform, sample_rate, max_segments)
      every consecutive 2.56 s segment of the clip, encoded and offset into the shared vocabulary, in time order, as ONE flat id list
      (an audio span is [AUDIO_START] + these ids + [AUDIO_END], any number of segments: the model already reads spans of any length).
      Replaces the single center crop that gave every clip, however long, exactly 2.56 s.
  audio_seconds(ids_len, tokenizer_cfg) -> seconds of sound a span of that many ids holds.
"""
from __future__ import annotations

import torch

from mel_spectrogram import waveform_to_mel_segments
from model import audio_token_id_to_vocab_id


@torch.no_grad()
def audio_vocab_ids(audio_tokenizer, waveform: torch.Tensor, sample_rate: int, max_segments: int = 6, device: str | None = None) -> list[int]:
    cfg = audio_tokenizer.cfg
    mels = waveform_to_mel_segments(waveform, sample_rate, cfg.n_mels, cfg.segment_frames, max_segments)
    if device:
        mels = mels.to(device)
    codes = audio_tokenizer.encode(mels).cpu()                    # (K, mel_bins, time_steps)
    return audio_token_id_to_vocab_id(codes.reshape(1, -1))[0].tolist()


def audio_seconds(n_ids: int, cfg) -> float:
    per_segment = (cfg.n_mels // cfg.downsample_factor) * (cfg.segment_frames // cfg.downsample_factor)
    return n_ids / per_segment * cfg.segment_frames * 0.01


if __name__ == "__main__":
    import math

    from audio_tokenizer import AudioTokenizer, AudioTokenizerConfig
    from mel_spectrogram import waveform_to_mel_spectrogram

    torch.manual_seed(0)
    cfg = AudioTokenizerConfig(n_mels=16, segment_frames=32, base_channels=8, channel_multipliers=(1, 2), code_dim=8, num_codes=64)
    tok = AudioTokenizer(cfg).train(False)
    sr, hop = 16000, 160
    seg_samples = cfg.segment_frames * hop
    t = torch.arange(seg_samples * 9) / sr
    wave = 0.3 * torch.sin(2 * math.pi * 220 * t)

    one = waveform_to_mel_segments(wave[: seg_samples - 400], sr, cfg.n_mels, cfg.segment_frames)
    assert one.shape == (1, 1, cfg.n_mels, cfg.segment_frames)
    old = waveform_to_mel_spectrogram(wave[: seg_samples - 400], sr, cfg.n_mels, cfg.segment_frames)
    assert torch.allclose(one[0], old, atol=1e-5), "a clip shorter than one segment must match the old function"
    assert waveform_to_mel_segments(wave[:seg_samples * 3 + 10], sr, cfg.n_mels, cfg.segment_frames).shape[0] == 3
    assert waveform_to_mel_segments(wave[:int(seg_samples * 3.6)], sr, cfg.n_mels, cfg.segment_frames).shape[0] == 4
    assert waveform_to_mel_segments(wave, sr, cfg.n_mels, cfg.segment_frames, max_segments=5).shape[0] == 5

    per = cfg.tokens_per_segment
    ids = audio_vocab_ids(tok, wave[:seg_samples * 4], sr, max_segments=6)
    assert len(ids) == 4 * per and len(set(type(i) for i in ids)) == 1
    assert abs(audio_seconds(len(ids), cfg) - 4 * cfg.segment_frames * 0.01) < 1e-6
    print(f"sham_media_codec self-test OK | 4 segments = {len(ids)} ids = {audio_seconds(len(ids), cfg):.2f} s (old behaviour: always 1 segment)")
