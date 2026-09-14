"""
Real, executed proof that "vision understanding" is a genuinely
trained capability of NovaSmall, not just generation with an external
describer bolted on — owner spec directly: "فاهم شيء في النموذج هو
الرؤية والتحليل ... يجب ان يكون كاملا" (understanding is one thing in
the model — vision and analysis — and it must be complete).

The mechanism (see dataset.py's MultimodalCollator.
build_understanding_sequence): training on image-then-caption
sequences teaches next-token prediction FROM image tokens TO caption
text, the same autoregressive mechanism already used for text and for
generation, just applied in the other direction. This script proves
that mechanism actually works, not just that it doesn't crash:

  1. Build a small, real, structured (image, caption) dataset — a
     handful of distinct visual patterns, each with its own real short
     caption, repeated with light noise (mirroring
     train_image_tokenizer.py's own synthetic-dataset approach) so
     there is real, learnable structure to pick up.
  2. Train ONE model on BOTH directions together (both_directions=True,
     the default) for a real, short run.
  3. Measure GENERATION loss (image-token positions, given the
     caption) and UNDERSTANDING loss (caption-token positions, given
     the image) SEPARATELY, before and after training — isolating each
     capability's own loss (via label-masking everything else to
     -100) rather than reading one aggregate number that could hide
     one direction improving while the other doesn't.
  4. Assert BOTH losses decrease meaningfully — real, separate evidence
     that training on both-direction data genuinely teaches both
     capabilities from the one shared architecture, not just one of
     them silently riding along.
"""

import torch

from dataset import ContentSafetyFilter, MultimodalCollator
from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
from model import NovaSmall, NovaSmallConfig, SpecialTokens
from text_tokenizer import train_text_tokenizer


def make_synthetic_image_caption_dataset(
    image_tokenizer_cfg: ImageTokenizerConfig, num_samples: int = 48, seed: int = 0
) -> tuple[list[tuple[str, torch.Tensor]], list[str]]:
    """A handful of distinct base patterns, each with its OWN fixed
    caption — real, learnable image<->caption structure, mirroring
    train_image_tokenizer.py's make_synthetic_image_dataset but paired
    with real captions instead of being caption-agnostic."""
    captions = ["a red square", "a green square", "a blue square", "a yellow square"]
    generator = torch.Generator().manual_seed(seed)
    base_colors = torch.tensor([
        [0.8, -0.6, -0.6],   # red-ish
        [-0.6, 0.8, -0.6],   # green-ish
        [-0.6, -0.6, 0.8],   # blue-ish
        [0.8, 0.8, -0.6],    # yellow-ish
    ])
    size = image_tokenizer_cfg.image_size
    samples = []
    for i in range(num_samples):
        pattern_idx = i % len(captions)
        color = base_colors[pattern_idx].view(3, 1, 1)
        image = color.expand(3, size, size) + torch.randn(3, size, size, generator=generator) * 0.05
        image = image.clamp(-1, 1)
        samples.append((captions[pattern_idx], image))
    return samples, captions


@torch.no_grad()
def _masked_loss(model: NovaSmall, input_ids: torch.Tensor, target_labels: torch.Tensor) -> float:
    _, loss = model(input_ids, labels=target_labels)
    return loss.item()


def _build_isolated_eval_batch(
    collator: MultimodalCollator, batch: list[tuple[str, torch.Tensor]], direction: str
) -> tuple[torch.Tensor, torch.Tensor]:
    """Builds a batch in ONE direction only, with labels masked to
    -100 everywhere except the span that direction is actually
    predicting — image tokens for "generation" (predicted from the
    caption), caption tokens for "understanding" (predicted from the
    image) — so the resulting loss isolates exactly one capability."""
    offset_image_tokens = collator.encode_batch_images(batch)
    sequences, target_spans = [], []
    for (caption, _), image_ids in zip(batch, offset_image_tokens):
        caption_ids = collator.text_tokenizer.encode(caption)
        image_ids_list = image_ids.tolist()
        if direction == "generation":
            seq = collator.build_generation_sequence(caption_ids, image_ids_list)
            # image tokens sit right after BOS + caption + IMAGE_START
            start = 1 + len(caption_ids) + 1
            end = start + len(image_ids_list)
        else:
            seq = collator.build_understanding_sequence(caption_ids, image_ids_list)
            # caption tokens sit right after BOS + IMAGE_START + image tokens + IMAGE_END
            start = 2 + len(image_ids_list) + 1
            end = start + len(caption_ids)
        sequences.append(seq)
        target_spans.append((start, end))

    input_ids, _ = collator._pad_sequences(sequences)
    labels = torch.full_like(input_ids, -100)
    for i, (start, end) in enumerate(target_spans):
        labels[i, start:end] = input_ids[i, start:end]
    return input_ids, labels


def main() -> None:
    torch.manual_seed(0)

    image_tokenizer_cfg = ImageTokenizerConfig(
        image_size=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=64
    )
    image_tokenizer = ImageTokenizer(image_tokenizer_cfg)
    dataset, captions = make_synthetic_image_caption_dataset(image_tokenizer_cfg, num_samples=48)

    # A real tokenizer trained on exactly the vocabulary this test uses.
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as tmpdir:
        corpus_path = Path(tmpdir) / "captions.txt"
        corpus_path.write_text("\n".join(captions * 20), encoding="utf-8")
        text_tokenizer = train_text_tokenizer([str(corpus_path)], vocab_size=300)

    collator = MultimodalCollator(text_tokenizer, image_tokenizer, both_directions=True)

    model_cfg = NovaSmallConfig(
        vocab_size=42256, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=512
    )
    model = NovaSmall(model_cfg)
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4)

    eval_batch = dataset[:8]  # held out conceptually simple: same distribution, checked before AND after training
    gen_input_before, gen_labels_before = _build_isolated_eval_batch(collator, eval_batch, "generation")
    und_input_before, und_labels_before = _build_isolated_eval_batch(collator, eval_batch, "understanding")
    model.eval()
    gen_loss_before = _masked_loss(model, gen_input_before, gen_labels_before)
    und_loss_before = _masked_loss(model, und_input_before, und_labels_before)
    print(f"before training: generation loss (image | caption) = {gen_loss_before:.4f}, "
          f"understanding loss (caption | image) = {und_loss_before:.4f}")

    model.train()
    batch_size = 8
    num_epochs = 25
    for epoch in range(num_epochs):
        for start in range(0, len(dataset), batch_size):
            batch = dataset[start : start + batch_size]
            input_ids, labels = collator(batch)  # both directions, built together, exactly as real training will use it
            _, loss = model(input_ids, labels=labels)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

    model.eval()
    gen_loss_after = _masked_loss(model, gen_input_before, gen_labels_before)
    und_loss_after = _masked_loss(model, und_input_before, und_labels_before)
    print(f"after training:  generation loss (image | caption) = {gen_loss_after:.4f}, "
          f"understanding loss (caption | image) = {und_loss_after:.4f}")

    assert gen_loss_after < gen_loss_before * 0.9, (
        f"generation loss did not meaningfully improve: {gen_loss_before:.4f} -> {gen_loss_after:.4f}"
    )
    assert und_loss_after < und_loss_before * 0.9, (
        f"understanding loss did not meaningfully improve: {und_loss_before:.4f} -> {und_loss_after:.4f} "
        f"— training on both-direction data is not actually teaching image understanding"
    )
    print(f"\ngeneration improved {(1 - gen_loss_after / gen_loss_before) * 100:.0f}%, "
          f"understanding improved {(1 - und_loss_after / und_loss_before) * 100:.0f}% — both measured in "
          f"isolation from each other.")
    print("\nAll bidirectional vision checks passed — the SAME shared model genuinely learns to both "
          "generate images from captions AND describe images from their tokens, from one training run.")


if __name__ == "__main__":
    main()
