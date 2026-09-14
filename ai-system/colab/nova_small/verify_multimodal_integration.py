"""
Real, end-to-end proof that model.py (the shared brain),
image_tokenizer.py, audio_tokenizer.py, and video_tokenizer.py all fit
together correctly through ONE shared vocabulary — the one thing that
cannot be verified by testing each file in isolation (every one of
their own __main__ self-tests already passes on its own), since a
wrong offset or a frame-boundary mistake here would silently corrupt
every generated image/audio-clip/video while every other test still
reports success.

This builds ONE real sequence containing all four modalities together
— text, an image, an audio clip, and a short video — runs it through a
real NovaSmall forward pass, then decodes every modality back out and
checks it against the original tokens exactly. This is the owner's own
requirement, verified directly rather than assumed: "نص صوت صور فديو"
(text, audio, image, video) — one brain, one vocabulary, all four
kinds of content in the same sequence it already handles plain text
in.
"""

import torch

from audio_tokenizer import build_default_tokenizer as build_default_audio_tokenizer
from image_tokenizer import build_default_tokenizer as build_default_image_tokenizer
from model import (
    SpecialTokens,
    TEXT_VOCAB_SIZE,
    audio_token_id_to_vocab_id,
    build_default_model,
    image_token_id_to_vocab_id,
    vocab_id_to_audio_token_id,
    vocab_id_to_image_token_id,
)
from video_tokenizer import decode_video, encode_video


def main() -> None:
    text_model = build_default_model()
    image_tokenizer = build_default_image_tokenizer()
    audio_tokenizer = build_default_audio_tokenizer()
    batch = 1

    # --- 1. Build one real span per modality -------------------------
    text_prefix = torch.randint(0, TEXT_VOCAB_SIZE, (batch, 8))

    dummy_image = torch.rand(batch, 3, image_tokenizer.cfg.image_size, image_tokenizer.cfg.image_size) * 2 - 1
    image_tokens = image_tokenizer.encode(dummy_image).view(batch, -1)  # (batch, 256)
    offset_image_tokens = image_token_id_to_vocab_id(image_tokens)
    image_span = torch.cat([
        torch.full((batch, 1), SpecialTokens.IMAGE_START),
        offset_image_tokens,
        torch.full((batch, 1), SpecialTokens.IMAGE_END),
    ], dim=1)

    dummy_mel = torch.rand(batch, 1, audio_tokenizer.cfg.n_mels, audio_tokenizer.cfg.segment_frames) * 2 - 1
    audio_tokens = audio_tokenizer.encode(dummy_mel).view(batch, -1)  # (batch, 80)
    offset_audio_tokens = audio_token_id_to_vocab_id(audio_tokens)
    audio_span = torch.cat([
        torch.full((batch, 1), SpecialTokens.AUDIO_START),
        offset_audio_tokens,
        torch.full((batch, 1), SpecialTokens.AUDIO_END),
    ], dim=1)

    num_frames = 2
    dummy_video = torch.rand(batch, num_frames, 3, image_tokenizer.cfg.image_size, image_tokenizer.cfg.image_size) * 2 - 1
    video_span = encode_video(image_tokenizer, dummy_video)  # already includes VIDEO_START/END + per-frame IMAGE_START/END

    full_sequence = torch.cat([text_prefix, image_span, audio_span, video_span], dim=1)
    print(f"built one real mixed sequence of length {full_sequence.shape[1]}: "
          f"{text_prefix.shape[1]} text + {image_span.shape[1]} image-span + "
          f"{audio_span.shape[1]} audio-span + {video_span.shape[1]} video-span")
    assert full_sequence.shape[1] <= text_model.cfg.max_seq_len, "sequence exceeds max_seq_len"

    # --- 2. Run the real shared brain over all four modalities at once
    logits, loss = text_model(full_sequence, labels=full_sequence)
    assert logits.shape == (batch, full_sequence.shape[1], text_model.cfg.vocab_size), f"unexpected logits shape {logits.shape}"
    assert torch.isfinite(loss), f"loss is not finite: {loss}"
    print(f"NovaSmall processed the full text+image+audio+video sequence OK: "
          f"logits shape={tuple(logits.shape)}, loss={loss.item():.4f}")

    # --- 3. Decode every modality back out of the same sequence and
    #        verify each recovers exactly what was encoded -----------
    offset = text_prefix.shape[1]

    recovered_image_span = full_sequence[:, offset:offset + image_span.shape[1]]
    recovered_image_tokens = vocab_id_to_image_token_id(recovered_image_span[:, 1:-1])
    assert torch.equal(recovered_image_tokens, image_tokens), "image tokens did not round-trip through the sequence"
    decoded_image = image_tokenizer.decode(recovered_image_tokens.view(batch, image_tokenizer.cfg.latent_grid_size, image_tokenizer.cfg.latent_grid_size))
    assert decoded_image.shape == dummy_image.shape and torch.isfinite(decoded_image).all()
    print("image span round trip OK: exact token match, decoded to a real image.")
    offset += image_span.shape[1]

    recovered_audio_span = full_sequence[:, offset:offset + audio_span.shape[1]]
    recovered_audio_tokens = vocab_id_to_audio_token_id(recovered_audio_span[:, 1:-1])
    assert torch.equal(recovered_audio_tokens, audio_tokens), "audio tokens did not round-trip through the sequence"
    decoded_audio = audio_tokenizer.decode(recovered_audio_tokens.view(batch, audio_tokenizer.cfg.latent_mel_bins, audio_tokenizer.cfg.latent_time_steps))
    assert decoded_audio.shape == dummy_mel.shape and torch.isfinite(decoded_audio).all()
    print("audio span round trip OK: exact token match, decoded to a real mel-spectrogram.")
    offset += audio_span.shape[1]

    recovered_video_span = full_sequence[:, offset:offset + video_span.shape[1]]
    assert torch.equal(recovered_video_span, video_span), "video span did not round-trip through the sequence unchanged"
    decoded_video = decode_video(image_tokenizer, recovered_video_span, num_frames=num_frames)
    assert decoded_video.shape == dummy_video.shape and torch.isfinite(decoded_video).all()
    print("video span round trip OK: exact token match, decoded to real frames.")
    offset += video_span.shape[1]

    assert offset == full_sequence.shape[1], "did not account for the entire sequence length"

    print("\nAll checks passed — text, image, audio, and video coexist correctly "
          "in one sequence through NovaSmall's single shared brain and vocabulary.")


if __name__ == "__main__":
    main()
