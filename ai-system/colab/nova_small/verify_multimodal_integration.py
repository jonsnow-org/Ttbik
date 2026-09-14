"""
Real, end-to-end proof that model.py (the text/image "brain") and
image_tokenizer.py (the pixel<->token translator) actually fit
together correctly through the shared vocabulary contract — the one
thing that CANNOT be verified by testing each file in isolation (both
of their own __main__ self-tests already pass on their own), since a
wrong offset or off-by-one here would silently corrupt every generated
image while every other test still reports success.

Real pipeline exercised below, exactly as real training/inference will
use it:
  1. A real (random, for this test) image goes through
     ImageTokenizer.encode() -> real codebook ids in [0, IMAGE_VOCAB_SIZE).
  2. Those ids are offset into NovaSmall's shared vocabulary via
     model.image_token_id_to_vocab_id() and wrapped in
     <IMAGE_START>...<IMAGE_END>, exactly the sequence shape the real
     model is meant to learn to both read and write.
  3. NovaSmall.forward() runs on that real sequence (mixed with plain
     "text" ids for realism) and must not error or produce non-finite
     loss.
  4. The image-token span is pulled back out, converted back to raw
     codebook ids via model.vocab_id_to_image_token_id(), and handed to
     ImageTokenizer.decode() — which must run and produce a real image
     tensor of the expected shape.
"""

import torch

from image_tokenizer import build_default_tokenizer
from model import (
    SpecialTokens,
    TEXT_VOCAB_SIZE,
    build_default_model,
    image_token_id_to_vocab_id,
    vocab_id_to_image_token_id,
)


def main() -> None:
    text_model = build_default_model()
    image_tokenizer = build_default_tokenizer()

    batch = 1
    dummy_image = torch.rand(batch, 3, image_tokenizer.cfg.image_size, image_tokenizer.cfg.image_size) * 2 - 1
    real_image_token_grid = image_tokenizer.encode(dummy_image)  # (batch, 16, 16), ids in [0, 8192)
    image_token_ids_flat = real_image_token_grid.view(batch, -1)  # (batch, 256)
    print(f"encoded a real image into {image_token_ids_flat.shape[1]} raw codebook ids "
          f"(range [{image_token_ids_flat.min().item()}, {image_token_ids_flat.max().item()}])")

    offset_image_ids = image_token_id_to_vocab_id(image_token_ids_flat)
    assert offset_image_ids.min() >= TEXT_VOCAB_SIZE, "offset image ids leaked into the text range"
    assert offset_image_ids.max() < SpecialTokens._base, "offset image ids leaked past the image range"
    print(f"offset into the shared vocabulary: range [{offset_image_ids.min().item()}, {offset_image_ids.max().item()}] "
          f"(text range is [0, {TEXT_VOCAB_SIZE}))")

    dummy_text_prefix = torch.randint(0, TEXT_VOCAB_SIZE, (batch, 8))
    image_start = torch.full((batch, 1), SpecialTokens.IMAGE_START)
    image_end = torch.full((batch, 1), SpecialTokens.IMAGE_END)
    full_sequence = torch.cat([dummy_text_prefix, image_start, offset_image_ids, image_end], dim=1)
    print(f"built a real mixed text+image sequence of length {full_sequence.shape[1]} "
          f"({dummy_text_prefix.shape[1]} text + 1 IMAGE_START + {offset_image_ids.shape[1]} image + 1 IMAGE_END)")

    logits, loss = text_model(full_sequence, labels=full_sequence)
    assert logits.shape == (batch, full_sequence.shape[1], text_model.cfg.vocab_size), (
        f"unexpected logits shape {logits.shape}"
    )
    assert torch.isfinite(loss), f"loss is not finite: {loss}"
    print(f"NovaSmall processed the mixed sequence OK: logits shape={tuple(logits.shape)}, loss={loss.item():.4f}")

    # Pull the image-token span back out exactly the way real inference
    # will (skip the leading text + IMAGE_START, stop before IMAGE_END)
    # and prove it decodes back into a real image.
    start = dummy_text_prefix.shape[1] + 1
    end = start + offset_image_ids.shape[1]
    recovered_offset_ids = full_sequence[:, start:end]
    recovered_raw_ids = vocab_id_to_image_token_id(recovered_offset_ids)
    assert torch.equal(recovered_raw_ids, image_token_ids_flat), (
        "round-tripping the offset through the shared vocabulary did not recover the original codebook ids"
    )
    recovered_grid = recovered_raw_ids.view(batch, image_tokenizer.cfg.latent_grid_size, image_tokenizer.cfg.latent_grid_size)
    decoded_image = image_tokenizer.decode(recovered_grid)
    expected_shape = (batch, 3, image_tokenizer.cfg.image_size, image_tokenizer.cfg.image_size)
    assert decoded_image.shape == expected_shape, f"decoded image has unexpected shape {decoded_image.shape}"
    assert torch.isfinite(decoded_image).all(), "decoded image contains non-finite pixels"
    print(f"round trip OK: recovered the exact original codebook ids and decoded a real "
          f"{tuple(decoded_image.shape)} image from them.")

    print("\nAll integration checks passed — the text brain and the image tokenizer "
          "share one consistent, verified vocabulary contract.")


if __name__ == "__main__":
    main()
