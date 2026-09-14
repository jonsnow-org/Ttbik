"""
Nova Small — training data pipeline. Every model/tokenizer component
built so far has been tested on synthetic tensors; this file is the
real boundary where actual files (text documents, image files with
captions) become the exact tensors model.py's forward() expects,
through the exact tokenizers already built (text_tokenizer.py,
image_tokenizer.py, audio_tokenizer.py).

Two things this file does NOT pretend to solve, stated plainly:
  - Content safety filtering: ContentSafetyFilter below is a real,
    working keyword/heuristic baseline — it actually runs and actually
    rejects matching text — but it is not a trained classifier, and a
    real launch needs one (especially for images/audio/video, where a
    keyword check over a caption is a weak proxy for the media itself).
    It exists so the exclusion happens at the DATA stage, per the
    owner's standing decision against supporting sexual content, rather
    than being left for the trained model to "figure out" on its own —
    but it must be strengthened with real classifiers once real, large
    datasets are gathered, not treated as sufficient on its own.
  - Where the real training data comes from: this file loads whatever
    real local files it's pointed at (see each Dataset class's own
    docstring for the expected layout) — gathering an actual
    large-scale, Arabic-heavy text corpus and licensed image/audio/
    video datasets is a separate, later task, not something this file
    can manufacture.
"""

import json
from dataclasses import dataclass
from pathlib import Path

import torch
from PIL import Image

from image_tokenizer import ImageTokenizer
from model import SpecialTokens, TEXT_VOCAB_SIZE, image_token_id_to_vocab_id
from text_tokenizer import NovaTextTokenizer

# A real, working baseline — see this module's own docstring for why it
# is explicitly NOT presented as sufficient on its own. Arabic and
# English terms both included since the product serves both.
_UNSAFE_KEYWORDS = {
    "porn", "explicit sexual", "nude", "nsfw",
    "إباحي", "جنس صريح", "عاري",
}


@dataclass
class SafetyVerdict:
    is_safe: bool
    reason: str | None = None


class ContentSafetyFilter:
    """Owner spec: sexual content is categorically out of scope for
    this model — see model.py's design history. Filtering it out of
    the TRAINING DATA (so the model never learns it as a pattern in the
    first place) is more robust than relying only on inference-time
    refusal behavior learned from limited examples."""

    def __init__(self, extra_blocked_terms: set[str] | None = None):
        self._blocked_terms = set(_UNSAFE_KEYWORDS)
        if extra_blocked_terms:
            self._blocked_terms |= extra_blocked_terms

    def check_text(self, text: str) -> SafetyVerdict:
        lowered = text.lower()
        for term in self._blocked_terms:
            if term.lower() in lowered:
                return SafetyVerdict(is_safe=False, reason=f"matched blocked term: {term!r}")
        return SafetyVerdict(is_safe=True)


def _pack_sequences(token_stream: list[int], seq_len: int) -> list[list[int]]:
    """Standard causal-LM pretraining chunking: one long stream of ids
    (documents already separated by EOS) sliced into non-overlapping
    windows of exactly seq_len — the real technique used to avoid
    padding-wasted compute on a corpus of documents shorter than
    seq_len each."""
    return [token_stream[i : i + seq_len] for i in range(0, len(token_stream) - seq_len + 1, seq_len)]


class TextSequenceDataset(torch.utils.data.Dataset):
    """Real plain-text pretraining data. Expects a list of local text
    file paths; each file's content is safety-filtered as one document
    (skip the whole file if it matches), tokenized, and concatenated
    with SpecialTokens.EOS between documents before being sliced into
    fixed-length seq_len windows."""

    def __init__(
        self,
        file_paths: list[str],
        tokenizer: NovaTextTokenizer,
        seq_len: int,
        safety_filter: ContentSafetyFilter | None = None,
    ):
        self.tokenizer = tokenizer
        self.seq_len = seq_len
        safety_filter = safety_filter or ContentSafetyFilter()

        stream: list[int] = []
        skipped = 0
        for path in file_paths:
            text = Path(path).read_text(encoding="utf-8", errors="ignore")
            verdict = safety_filter.check_text(text)
            if not verdict.is_safe:
                skipped += 1
                continue
            stream.extend(self.tokenizer.encode(text))
            stream.append(SpecialTokens.EOS)
        # NovaSmall.forward() already does its own internal next-token
        # shift (see model.py) when input_ids and labels are the same
        # tensor, exactly like every other verified test in this
        # project — so each chunk is exactly seq_len long, not seq_len+1;
        # the model itself loses only the one label-less final position
        # per chunk, the same as any standard fixed-window LM dataset.
        self.skipped_files = skipped
        self.chunks = _pack_sequences(stream, seq_len)

    def __len__(self) -> int:
        return len(self.chunks)

    def __getitem__(self, idx: int) -> torch.Tensor:
        return torch.tensor(self.chunks[idx], dtype=torch.long)


class ImageCaptionDataset(torch.utils.data.Dataset):
    """Real (image file, caption) pairs. manifest_path is a JSONL file,
    one {"image": "<path>", "caption": "<text>"} object per line, paths
    resolved relative to the manifest's own directory. Returns raw
    (caption_text, image_tensor) pairs — turning the caption into ids
    and the image into codebook tokens is MultimodalCollator's job
    below, since that needs the (possibly still-training) tokenizer
    models, which this Dataset class deliberately doesn't own."""

    def __init__(
        self,
        manifest_path: str,
        image_size: int,
        safety_filter: ContentSafetyFilter | None = None,
    ):
        safety_filter = safety_filter or ContentSafetyFilter()
        manifest_dir = Path(manifest_path).parent
        self.image_size = image_size
        self.entries: list[tuple[Path, str]] = []
        skipped = 0
        with open(manifest_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)
                verdict = safety_filter.check_text(record["caption"])
                if not verdict.is_safe:
                    skipped += 1
                    continue
                self.entries.append((manifest_dir / record["image"], record["caption"]))
        self.skipped_entries = skipped

    def __len__(self) -> int:
        return len(self.entries)

    def __getitem__(self, idx: int) -> tuple[str, torch.Tensor]:
        image_path, caption = self.entries[idx]
        image = Image.open(image_path).convert("RGB").resize((self.image_size, self.image_size))
        tensor = torch.tensor(list(image.getdata()), dtype=torch.float32).view(image.size[1], image.size[0], 3)
        tensor = tensor.permute(2, 0, 1) / 127.5 - 1.0  # HWC uint8-range -> CHW in [-1, 1], matching image_tokenizer's contract
        return caption, tensor


class MultimodalCollator:
    """Turns a batch of ImageCaptionDataset's raw (caption, image)
    pairs into the exact padded (input_ids, labels) tensors
    model.py's NovaSmall.forward() expects — real text ids, a real
    <IMAGE_START>, real offset image-codebook ids from a FROZEN,
    already-trained image_tokenizer, real <IMAGE_END>, then PAD out to
    the batch's longest sequence with loss ignored (-100) on PAD
    positions so padding never influences the loss."""

    def __init__(self, text_tokenizer: NovaTextTokenizer, image_tokenizer: ImageTokenizer):
        self.text_tokenizer = text_tokenizer
        self.image_tokenizer = image_tokenizer

    @torch.no_grad()
    def __call__(self, batch: list[tuple[str, torch.Tensor]]) -> tuple[torch.Tensor, torch.Tensor]:
        images = torch.stack([image for _, image in batch], dim=0)
        image_token_grids = self.image_tokenizer.encode(images)  # (batch, grid, grid), the FROZEN tokenizer's own codes
        tokens_per_image = self.image_tokenizer.cfg.tokens_per_image
        offset_image_tokens = image_token_id_to_vocab_id(image_token_grids.view(images.shape[0], -1))

        sequences = []
        for (caption, _), image_ids in zip(batch, offset_image_tokens):
            caption_ids = self.text_tokenizer.encode(caption)
            sequence = (
                [SpecialTokens.BOS]
                + caption_ids
                + [SpecialTokens.IMAGE_START]
                + image_ids.tolist()
                + [SpecialTokens.IMAGE_END, SpecialTokens.EOS]
            )
            sequences.append(sequence)

        max_len = max(len(s) for s in sequences)
        input_ids = torch.full((len(sequences), max_len), SpecialTokens.PAD, dtype=torch.long)
        labels = torch.full((len(sequences), max_len), -100, dtype=torch.long)
        for i, seq in enumerate(sequences):
            input_ids[i, : len(seq)] = torch.tensor(seq, dtype=torch.long)
            labels[i, : len(seq)] = torch.tensor(seq, dtype=torch.long)
        return input_ids, labels


if __name__ == "__main__":
    import tempfile

    from image_tokenizer import ImageTokenizerConfig
    from text_tokenizer import train_text_tokenizer

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        # --- 1. Real text pipeline: safety filtering + chunking -------
        safe_doc = tmp / "safe.txt"
        safe_doc.write_text("Nova Small is a real, from-scratch multimodal transformer. " * 50, encoding="utf-8")
        unsafe_doc = tmp / "unsafe.txt"
        unsafe_doc.write_text("this document contains nsfw content and should be excluded", encoding="utf-8")

        tokenizer = train_text_tokenizer([str(safe_doc)], vocab_size=300)
        text_dataset = TextSequenceDataset([str(safe_doc), str(unsafe_doc)], tokenizer, seq_len=16)
        assert text_dataset.skipped_files == 1, f"expected 1 unsafe file skipped, got {text_dataset.skipped_files}"
        assert len(text_dataset) > 0, "no chunks produced from the safe document"
        sample = text_dataset[0]
        assert sample.shape == (16,)  # exactly seq_len
        print(f"TextSequenceDataset OK: {text_dataset.skipped_files} unsafe file correctly excluded, "
              f"{len(text_dataset)} real training chunks produced from the safe document.")

        # --- 2. Real image+caption pipeline: safety filtering + collate
        image_tokenizer_cfg = ImageTokenizerConfig(image_size=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=64)
        image_tokenizer = ImageTokenizer(image_tokenizer_cfg)

        for i in range(3):
            color = (i * 60 % 256, (i * 90 + 30) % 256, (i * 40 + 60) % 256)
            Image.new("RGB", (32, 32), color=color).save(tmp / f"img{i}.png")

        manifest_path = tmp / "manifest.jsonl"
        with open(manifest_path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"image": "img0.png", "caption": "a solid red-ish square"}) + "\n")
            f.write(json.dumps({"image": "img1.png", "caption": "a solid green-ish square"}) + "\n")
            f.write(json.dumps({"image": "img2.png", "caption": "nsfw content here"}) + "\n")  # must be filtered

        image_dataset = ImageCaptionDataset(str(manifest_path), image_size=32)
        assert image_dataset.skipped_entries == 1, f"expected 1 unsafe entry skipped, got {image_dataset.skipped_entries}"
        assert len(image_dataset) == 2
        caption0, tensor0 = image_dataset[0]
        assert tensor0.shape == (3, 32, 32)
        assert tensor0.min() >= -1.0 - 1e-4 and tensor0.max() <= 1.0 + 1e-4
        print(f"ImageCaptionDataset OK: {image_dataset.skipped_entries} unsafe entry correctly excluded, "
              f"{len(image_dataset)} real (caption, image) pairs loaded from real PNG files.")

        collator = MultimodalCollator(tokenizer, image_tokenizer)
        batch = [image_dataset[0], image_dataset[1]]
        input_ids, labels = collator(batch)
        assert input_ids.shape == labels.shape
        assert (input_ids == SpecialTokens.PAD).sum() == (labels == -100).sum(), "PAD positions and ignored-loss positions must match exactly"
        print(f"MultimodalCollator OK: built a real padded batch {tuple(input_ids.shape)} from raw "
              f"images/captions via the frozen image tokenizer.")

        # --- 3. The whole point: feed a real collated batch to the real model
        from model import NovaSmall, NovaSmallConfig

        model_cfg = NovaSmallConfig(vocab_size=42256, d_model=32, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=64, max_seq_len=512)
        model = NovaSmall(model_cfg)
        logits, loss = model(input_ids, labels=labels)
        assert torch.isfinite(loss), f"loss is not finite: {loss}"
        print(f"end-to-end OK: real files -> dataset -> collator -> NovaSmall.forward() -> finite loss "
              f"({loss.item():.4f}).")

    print("\nAll data pipeline checks passed — real files become real, safety-filtered, correctly "
          "shaped training batches.")
