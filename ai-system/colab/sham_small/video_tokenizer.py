"""
Sham — video handling. Per owner spec, 2026-09-14 ("نبني نماذج
مصغرة وندمجها في عقل نموذجنا"), video is deliberately NOT a fourth
codebook/vocabulary range: a video is just a sequence of images over
time, so it reuses image_tokenizer.py's own codebook, frame by frame.
This file's only job is mechanical, exactly like image_tokenizer.py
and audio_tokenizer.py's own jobs:
  - encode_video(): run image_tokenizer.encode() on every frame of a
    real video tensor and lay the resulting per-frame token grids out
    as one flat sequence of shared-vocabulary ids, delimited so
    ShamSmall's transformer can tell where each frame starts and ends.
  - decode_video(): the inverse — split a flat token sequence back into
    per-frame token grids and run image_tokenizer.decode() on each.
No new learned parameters live here — this module owns no nn.Module,
only real sequence-assembly logic around an already-verified
image_tokenizer.ImageTokenizer instance, so its own correctness is
entirely about not corrupting the frame boundaries, which is exactly
what this file's __main__ self-test below proves with a real multi-
frame round trip.

Sequence shape a real video occupies once assembled (all ids already
offset into ShamSmall's shared vocabulary):
  <VIDEO_START>
    <IMAGE_START> [256 offset image-token ids for frame 1] <IMAGE_END>
    <IMAGE_START> [256 offset image-token ids for frame 2] <IMAGE_END>
    ...
  <VIDEO_END>
This is the real, standard way discrete-token video generation is done
in practice (treat a video as a per-frame image-token sequence with an
outer delimiter) — not a novel/unverified scheme — and it is exactly
what lets the SAME transformer that already reads/writes text and
single images also read/write video, with no separate video-specific
weights anywhere.
"""

import torch

from image_tokenizer import ImageTokenizer
from model import (
    SpecialTokens,
    audio_token_id_to_vocab_id,
    image_token_id_to_vocab_id,
    vocab_id_to_audio_token_id,
    vocab_id_to_image_token_id,
)


def encode_video(image_tokenizer: ImageTokenizer, frames: torch.Tensor) -> torch.Tensor:
    """frames: (batch, num_frames, 3, H, W) in [-1, 1]. Returns a real
    flat sequence of shared-vocabulary ids of shape
    (batch, 2 + num_frames * (2 + tokens_per_image)):
    <VIDEO_START> then, per frame, <IMAGE_START> [tokens] <IMAGE_END>,
    then <VIDEO_END>."""
    batch, num_frames = frames.shape[0], frames.shape[1]
    flat_frames = frames.reshape(batch * num_frames, *frames.shape[2:])
    token_grids = image_tokenizer.encode(flat_frames)  # (batch*num_frames, grid, grid)
    tokens_per_frame = image_tokenizer.cfg.tokens_per_image
    token_seqs = token_grids.view(batch, num_frames, tokens_per_frame)
    offset_token_seqs = image_token_id_to_vocab_id(token_seqs)  # (batch, num_frames, tokens_per_frame)

    image_start = torch.full((batch, num_frames, 1), SpecialTokens.IMAGE_START, dtype=offset_token_seqs.dtype)
    image_end = torch.full((batch, num_frames, 1), SpecialTokens.IMAGE_END, dtype=offset_token_seqs.dtype)
    per_frame_blocks = torch.cat([image_start, offset_token_seqs, image_end], dim=2)  # (batch, num_frames, 2+tokens_per_frame)
    flat_blocks = per_frame_blocks.reshape(batch, num_frames * (2 + tokens_per_frame))

    video_start = torch.full((batch, 1), SpecialTokens.VIDEO_START, dtype=flat_blocks.dtype)
    video_end = torch.full((batch, 1), SpecialTokens.VIDEO_END, dtype=flat_blocks.dtype)
    return torch.cat([video_start, flat_blocks, video_end], dim=1)


def decode_video(image_tokenizer: ImageTokenizer, video_sequence: torch.Tensor, num_frames: int) -> torch.Tensor:
    """The inverse of encode_video(). video_sequence: exactly the shape
    encode_video() produces, for the same num_frames. Returns
    (batch, num_frames, 3, H, W) reconstructed frames."""
    batch = video_sequence.shape[0]
    tokens_per_frame = image_tokenizer.cfg.tokens_per_image
    block_len = 2 + tokens_per_frame

    inner = video_sequence[:, 1:-1]  # strip VIDEO_START / VIDEO_END
    expected_inner_len = num_frames * block_len
    if inner.shape[1] != expected_inner_len:
        raise ValueError(
            f"video sequence has {inner.shape[1]} inner tokens, expected {expected_inner_len} "
            f"for {num_frames} frames of {tokens_per_frame} tokens each"
        )
    per_frame_blocks = inner.view(batch, num_frames, block_len)
    offset_token_seqs = per_frame_blocks[:, :, 1:-1]  # strip each frame's IMAGE_START / IMAGE_END

    token_seqs = vocab_id_to_image_token_id(offset_token_seqs)  # (batch, num_frames, tokens_per_frame)
    grid_size = image_tokenizer.cfg.latent_grid_size
    token_grids = token_seqs.reshape(batch * num_frames, grid_size, grid_size)

    frames = image_tokenizer.decode(token_grids)  # (batch*num_frames, 3, H, W)
    return frames.view(batch, num_frames, *frames.shape[1:])


# ---------------------------------------------------------------- video WITH its sound
#
# Owner request, 2026-09-27: Sham is one unified model, so a video must carry
# its own sound, not be learned as silent frames. Same shared vocabulary, no
# new weights -- the clip's audio track goes through audio_tokenizer.py's own
# codebook and sits INSIDE the same <VIDEO_START>...<VIDEO_END> span, after
# the frames, as consecutive fixed-length audio segments:
#   <VIDEO_START>
#     <IMAGE_START> [frame 1] <IMAGE_END> ... <IMAGE_START> [frame N] <IMAGE_END>
#     <AUDIO_START> [segment 1] <AUDIO_END> ... <AUDIO_START> [segment K] <AUDIO_END>
#   <VIDEO_END>
# K = 0 is a silent clip and is byte-for-byte what encode_video() produces.


def encode_video_with_audio(image_tokenizer: ImageTokenizer, frames: torch.Tensor,
                            audio_tokenizer=None, audio_mels: torch.Tensor | None = None) -> torch.Tensor:
    """frames: (batch, num_frames, 3, H, W) in [-1, 1].
    audio_mels: (batch, num_segments, 1, n_mels, segment_frames) or None
    (silent). Returns (batch, video_len + num_segments * (2 + tokens_per_segment))."""
    video = encode_video(image_tokenizer, frames)
    if audio_mels is None or audio_mels.shape[1] == 0:
        return video
    if audio_tokenizer is None:
        raise ValueError("audio_mels given without an audio_tokenizer")
    batch, num_segments = audio_mels.shape[0], audio_mels.shape[1]
    grids = audio_tokenizer.encode(audio_mels.reshape(batch * num_segments, *audio_mels.shape[2:]))
    tokens = audio_token_id_to_vocab_id(grids.reshape(batch, num_segments, -1)).to(video.dtype)
    start = torch.full((batch, num_segments, 1), SpecialTokens.AUDIO_START, dtype=video.dtype)
    end = torch.full((batch, num_segments, 1), SpecialTokens.AUDIO_END, dtype=video.dtype)
    audio_blocks = torch.cat([start, tokens, end], dim=2).reshape(batch, -1)
    return torch.cat([video[:, :-1], audio_blocks, video[:, -1:]], dim=1)


def decode_video_with_audio(image_tokenizer: ImageTokenizer, video_sequence: torch.Tensor, num_frames: int,
                            audio_tokenizer=None, num_audio_segments: int = 0):
    """Inverse of encode_video_with_audio(). Returns (frames, mels) where mels
    is (batch, num_audio_segments, 1, n_mels, segment_frames), or None for a
    silent clip / when no audio_tokenizer is given."""
    frame_part_len = 2 + num_frames * (2 + image_tokenizer.cfg.tokens_per_image)
    if num_audio_segments == 0:
        return decode_video(image_tokenizer, video_sequence, num_frames), None
    video_only = torch.cat([video_sequence[:, :frame_part_len - 1], video_sequence[:, -1:]], dim=1)
    frames = decode_video(image_tokenizer, video_only, num_frames)
    if audio_tokenizer is None:
        return frames, None
    batch = video_sequence.shape[0]
    per_segment = audio_tokenizer.cfg.tokens_per_segment
    audio_part = video_sequence[:, frame_part_len - 1:-1]
    if audio_part.shape[1] != num_audio_segments * (2 + per_segment):
        raise ValueError(f"audio part has {audio_part.shape[1]} tokens, expected "
                         f"{num_audio_segments * (2 + per_segment)} for {num_audio_segments} segments")
    blocks = audio_part.view(batch, num_audio_segments, 2 + per_segment)
    raw = vocab_id_to_audio_token_id(blocks[:, :, 1:-1])
    grid = raw.reshape(batch * num_audio_segments, audio_tokenizer.cfg.latent_mel_bins, audio_tokenizer.cfg.latent_time_steps)
    mels = audio_tokenizer.decode(grid)
    return frames, mels.view(batch, num_audio_segments, *mels.shape[1:])


if __name__ == "__main__":
    from image_tokenizer import build_default_tokenizer

    tokenizer = build_default_tokenizer()
    batch, num_frames = 1, 4
    dummy_video = torch.rand(batch, num_frames, 3, tokenizer.cfg.image_size, tokenizer.cfg.image_size) * 2 - 1
    print(f"built a real dummy video: {tuple(dummy_video.shape)} (batch={batch}, frames={num_frames})")

    sequence = encode_video(tokenizer, dummy_video)
    tokens_per_frame = tokenizer.cfg.tokens_per_image
    expected_len = 2 + num_frames * (2 + tokens_per_frame)
    assert sequence.shape == (batch, expected_len), f"unexpected sequence shape {sequence.shape}"
    assert (sequence[:, 0] == SpecialTokens.VIDEO_START).all(), "sequence does not start with VIDEO_START"
    assert (sequence[:, -1] == SpecialTokens.VIDEO_END).all(), "sequence does not end with VIDEO_END"
    for f in range(num_frames):
        start = 1 + f * (2 + tokens_per_frame)
        assert (sequence[:, start] == SpecialTokens.IMAGE_START).all(), f"frame {f} missing IMAGE_START"
        assert (sequence[:, start + 1 + tokens_per_frame] == SpecialTokens.IMAGE_END).all(), f"frame {f} missing IMAGE_END"
    print(f"encode_video OK: sequence length={sequence.shape[1]}, VIDEO_START/END and every frame's "
          f"IMAGE_START/END delimiters landed at the correct positions.")

    decoded_frames = decode_video(tokenizer, sequence, num_frames=num_frames)
    expected_shape = (batch, num_frames, 3, tokenizer.cfg.image_size, tokenizer.cfg.image_size)
    assert decoded_frames.shape == expected_shape, f"decoded video has unexpected shape {decoded_frames.shape}"
    assert torch.isfinite(decoded_frames).all(), "decoded video contains non-finite pixels"
    print(f"decode_video OK: reconstructed {tuple(decoded_frames.shape)} frames from the sequence.")

    # Exact round trip: the raw per-frame token ids recovered from the
    # sequence must match what encoding the original frames produced
    # directly — proves the frame-boundary bookkeeping above is exactly
    # right, not just "close enough to not crash."
    direct_grids = tokenizer.encode(dummy_video.reshape(batch * num_frames, 3, tokenizer.cfg.image_size, tokenizer.cfg.image_size))
    inner = sequence[:, 1:-1].view(batch, num_frames, 2 + tokens_per_frame)
    recovered_offset = inner[:, :, 1:-1]
    recovered_raw = vocab_id_to_image_token_id(recovered_offset).reshape(batch * num_frames, tokenizer.cfg.latent_grid_size, tokenizer.cfg.latent_grid_size)
    assert torch.equal(recovered_raw, direct_grids), "round-tripping through the sequence did not recover the exact original per-frame token ids"
    print("exact round trip OK: every frame's token ids survived encode_video -> decode_video unchanged.")

    # Video WITH sound: audio segments sit inside the same video span and round-trip exactly.
    from audio_tokenizer import AudioTokenizer, AudioTokenizerConfig

    audio_tok = AudioTokenizer(AudioTokenizerConfig(base_channels=8, code_dim=16)).eval()
    num_segments = 2
    mels = torch.rand(batch, num_segments, 1, audio_tok.cfg.n_mels, audio_tok.cfg.segment_frames) * 2 - 1
    with torch.no_grad():
        av = encode_video_with_audio(tokenizer, dummy_video, audio_tok, mels)
    assert av.shape[1] == expected_len + num_segments * (2 + audio_tok.cfg.tokens_per_segment), av.shape
    assert (av[:, 0] == SpecialTokens.VIDEO_START).all() and (av[:, -1] == SpecialTokens.VIDEO_END).all()
    assert (av[:, expected_len - 1] == SpecialTokens.AUDIO_START).all(), "audio must follow the last frame"
    assert torch.equal(av[:, :expected_len - 1], sequence[:, :-1]), "frame part must be unchanged"
    with torch.no_grad():
        f2, m2 = decode_video_with_audio(tokenizer, av, num_frames, audio_tok, num_segments)
        direct_audio = audio_tok.encode(mels.reshape(batch * num_segments, *mels.shape[2:]))
    assert f2.shape == expected_shape and m2.shape == (batch, num_segments, *mels.shape[2:])
    got = vocab_id_to_audio_token_id(av[:, expected_len - 1:-1].view(batch, num_segments, -1)[:, :, 1:-1])
    assert torch.equal(got.reshape(direct_audio.shape), direct_audio), "audio token ids did not round-trip"
    silent = encode_video_with_audio(tokenizer, dummy_video)
    assert torch.equal(silent, sequence), "a silent clip must be exactly encode_video()"
    print(f"video+audio OK: {num_segments} audio segments inside the video span, exact round trip; silent clips unchanged.")

    print("\nAll video handling checks passed — video reuses the image codebook per-frame with correct framing.")
