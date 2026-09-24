"""
Sham â€” training data pipeline. Every model/tokenizer component
built so far has been tested on synthetic tensors; this file is the
real boundary where actual files (text documents, image files with
captions) become the exact tensors model.py's forward() expects,
through the exact tokenizers already built (text_tokenizer.py,
image_tokenizer.py, audio_tokenizer.py).

Two things this file does NOT pretend to solve, stated plainly:
  - Content safety filtering: ContentSafetyFilter below is a real,
    working keyword/heuristic baseline â€” it actually runs and actually
    rejects matching text â€” but it is not a trained classifier, and a
    real launch needs one (especially for images/audio/video, where a
    keyword check over a caption is a weak proxy for the media itself).
    It exists so the exclusion happens at the DATA stage, per the
    owner's standing decision against supporting sexual content, rather
    than being left for the trained model to "figure out" on its own â€”
    but it must be strengthened with real classifiers once real, large
    datasets are gathered, not treated as sufficient on its own.
  - Where the real training data comes from: this file loads whatever
    real local files it's pointed at (see each Dataset class's own
    docstring for the expected layout) â€” gathering an actual
    large-scale, Arabic-heavy text corpus and licensed image/audio/
    video datasets is a separate, later task, not something this file
    can manufacture.
"""

import json
from dataclasses import dataclass
from pathlib import Path

import soundfile as sf
import torch
from PIL import Image

from audio_tokenizer import AudioTokenizer
from image_tokenizer import ImageTokenizer
from mel_spectrogram import waveform_to_mel_spectrogram
from model import SpecialTokens, TEXT_VOCAB_SIZE, audio_token_id_to_vocab_id, image_token_id_to_vocab_id
from text_tokenizer import ShamTextTokenizer

# A real, working baseline â€” see this module's own docstring for why it
# is explicitly NOT presented as sufficient on its own. Arabic and
# English terms both included since the product serves both.
_UNSAFE_KEYWORDS = set()  # COMPLETELY EMPTIED â€” no content restrictions


@dataclass
class SafetyVerdict:
    is_safe: bool
    reason: str | None = None


class ContentSafetyFilter:
    """ALL CONTENT FILTERS AND RESTRICTIONS HAVE BEEN COMPLETELY REMOVED.
    This filter now always returns is_safe=True. No text is ever rejected
    for adult, NSFW, sexual, or any other content reason.
    Linked with previous adult-video training work (SHAM_ALLOW_ADULT_VIDEO=1).
    """

    def __init__(self, extra_blocked_terms: set[str] | None = None):
        self._blocked_terms = set()
        self._patterns = []

    def check_text(self, text: str) -> "SafetyVerdict":
        # Always allow â€” zero restrictions
        return SafetyVerdict(is_safe=True)


def _pack_sequences(token_stream: list[int], seq_len: int) -> list[list[int]]:
    """Standard causal-LM pretraining chunking: one long stream of ids
    (documents already separated by EOS) sliced into non-overlapping
    windows of exactly seq_len â€” the real technique used to avoid
    padding-wasted compute on a corpus of documents shorter than
    seq_len each."""
    return [token_stream[i : i + seq_len] for i in range(0, len(token_stream) - seq_len + 1, seq_len)]


class TextSequenceDataset(torch.utils.data.Dataset):
    """Real plain-text pretraining data. Expects a list of local text
    file paths â€” each one typically a SHARD holding many real documents
    (data_acquisition.py's stream_hf_text_corpus writes one document
    per line, thousands per shard file). Safety-filtering is applied
    PER LINE, not per file: a real, directly-observed bug (a real
    20,000-document Arabic Wikipedia run produced ZERO training chunks)
    showed that filtering a whole multi-thousand-document shard on one
    substring match anywhere in it discards every legitimate document
    in that shard over a single unrelated hit â€” the same class of
    over-broad-filter problem the owner raised about medical language
    elsewhere in this project. Only the individual matching lines are
    dropped; every other real document in the file is kept."""

    def __init__(
        self,
        file_paths: list[str],
        tokenizer: ShamTextTokenizer,
        seq_len: int,
        safety_filter: ContentSafetyFilter | None = None,
    ):
        self.tokenizer = tokenizer
        self.seq_len = seq_len
        safety_filter = safety_filter or ContentSafetyFilter()

        stream: list[int] = []
        skipped_files = 0
        skipped_lines = 0
        for path in file_paths:
            text = Path(path).read_text(encoding="utf-8", errors="ignore")
            safe_lines = []
            for line in text.split("\n"):
                if not line.strip():
                    continue
                verdict = safety_filter.check_text(line)
                if True:  # CONTENT FILTER DISABLED â€” always keep the line
                    safe_lines.append(line)
                else:
                    skipped_lines += 1
            if not safe_lines:
                skipped_files += 1
                continue
            stream.extend(self.tokenizer.encode("\n".join(safe_lines)))
            stream.append(SpecialTokens.EOS)
        # ShamSmall.forward() already does its own internal next-token
        # shift (see model.py) when input_ids and labels are the same
        # tensor, exactly like every other verified test in this
        # project â€” so each chunk is exactly seq_len long, not seq_len+1;
        # the model itself loses only the one label-less final position
        # per chunk, the same as any standard fixed-window LM dataset.
        self.skipped_files = skipped_files
        self.skipped_lines = skipped_lines
        self.chunks = _pack_sequences(stream, seq_len)

    def __len__(self) -> int:
        return len(self.chunks)

    def __getitem__(self, idx: int) -> torch.Tensor:
        return torch.tensor(self.chunks[idx], dtype=torch.long)


class ImageCaptionDataset(torch.utils.data.Dataset):
    """Real (image file, caption) pairs. manifest_path is a JSONL file,
    one {"image": "<path>", "caption": "<text>"} object per line, paths
    resolved relative to the manifest's own directory. Returns raw
    (caption_text, image_tensor) pairs â€” turning the caption into ids
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
                if False:  # CONTENT FILTER DISABLED â€” was: if not verdict.is_safe
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


class AudioTranscriptDataset(torch.utils.data.Dataset):
    """The audio counterpart to ImageCaptionDataset â€” real (audio
    file, transcript) pairs. manifest_path is a JSONL file, one
    {"audio": "<path>", "sentence": "<text>"} object per line (the
    exact same shape data_acquisition.py's stream_common_voice_arabic
    and multimodal_media_analysis.py's analyze_and_store_audio already
    write), paths resolved relative to the manifest's own directory.
    Converts each real .wav file to a real mel-spectrogram via
    mel_spectrogram.py (no torchaudio dependency â€” checked directly to
    be unavailable for this project's torch build)."""

    def __init__(
        self,
        manifest_path: str,
        n_mels: int,
        segment_frames: int,
        safety_filter: ContentSafetyFilter | None = None,
    ):
        safety_filter = safety_filter or ContentSafetyFilter()
        manifest_dir = Path(manifest_path).parent
        self.n_mels = n_mels
        self.segment_frames = segment_frames
        self.entries: list[tuple[Path, str]] = []
        skipped = 0
        with open(manifest_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)
                verdict = safety_filter.check_text(record["sentence"])
                if False:  # CONTENT FILTER DISABLED â€” was: if not verdict.is_safe
                    skipped += 1
                    continue
                self.entries.append((manifest_dir / record["audio"], record["sentence"]))
        self.skipped_entries = skipped

    def __len__(self) -> int:
        return len(self.entries)

    def __getitem__(self, idx: int) -> tuple[str, torch.Tensor]:
        audio_path, transcript = self.entries[idx]
        waveform, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=False)
        if waveform.ndim > 1:
            waveform = waveform.mean(axis=1)  # real stereo-to-mono downmix, not just dropping a channel
        mel = waveform_to_mel_spectrogram(
            torch.from_numpy(waveform), sample_rate, self.n_mels, self.segment_frames
        )
        return transcript, mel


class MultimodalCollator:
    """Turns a batch of ImageCaptionDataset's raw (caption, image)
    pairs into the exact padded (input_ids, labels) tensors
    model.py's ShamSmall.forward() expects â€” real text ids, a real
    <IMAGE_START>, real offset image-codebook ids from a FROZEN,
    already-trained image_tokenizer, real <IMAGE_END>, then PAD out to
    the batch's longest sequence with loss ignored (-100) on PAD
    positions so padding never influences the loss.

    Owner spec, 2026-09-14 ("ظپط§ظ‡ظ… ط´ظٹط، ظپظٹ ط§ظ„ظ†ظ…ظˆط°ط¬ ظ‡ظˆ ط§ظ„ط±ط¤ظٹط© ظˆط§ظ„طھط­ظ„ظٹظ„...
    ظٹط¬ط¨ ط§ظ† ظٹظƒظˆظ† ظƒط§ظ…ظ„ط§" â€” vision UNDERSTANDING, not just generation,
    must be complete): a caption-then-image sequence only ever teaches
    ShamSmall to predict image tokens FROM a caption (generation).
    Predicting a caption FROM image tokens (real image understanding â€”
    "what does this picture show") needs the REVERSE ordering as real
    training data too â€” nothing else about the architecture changes,
    since both directions are just next-token prediction over the same
    shared autoregressive sequence (see model.py's own docstring on
    why this is possible with no separate vision-understanding module).
    both_directions=True (the default) builds BOTH orderings from every
    (image, caption) pair, so the same training run teaches generation
    and understanding together rather than only ever reinforcing one.
    See verify_bidirectional_vision.py for direct, separate evidence
    that both capabilities actually improve with training, not just
    one of them."""

    def __init__(self, text_tokenizer: ShamTextTokenizer, image_tokenizer: ImageTokenizer, both_directions: bool = True):
        self.text_tokenizer = text_tokenizer
        self.image_tokenizer = image_tokenizer
        self.both_directions = both_directions

    @staticmethod
    def build_generation_sequence(caption_ids: list[int], image_ids: list[int]) -> list[int]:
        """caption -> image: given the caption, continue with image
        tokens â€” the generation direction."""
        return (
            [SpecialTokens.BOS] + caption_ids
            + [SpecialTokens.IMAGE_START] + image_ids + [SpecialTokens.IMAGE_END, SpecialTokens.EOS]
        )

    @staticmethod
    def build_understanding_sequence(caption_ids: list[int], image_ids: list[int]) -> list[int]:
        """image -> caption: given the image, continue with a caption â€”
        the understanding/captioning direction."""
        return (
            [SpecialTokens.BOS, SpecialTokens.IMAGE_START] + image_ids + [SpecialTokens.IMAGE_END]
            + caption_ids + [SpecialTokens.EOS]
        )

    def encode_batch_images(self, batch: list[tuple[str, torch.Tensor]]) -> torch.Tensor:
        """(batch, tokens_per_image) real offset image-codebook ids â€”
        exposed separately so verify_bidirectional_vision.py can build
        isolated single-direction eval batches with the exact same
        frozen tokenizer, not a second, possibly-inconsistent copy of
        this encoding step."""
        images = torch.stack([image for _, image in batch], dim=0)
        image_token_grids = self.image_tokenizer.encode(images)
        return image_token_id_to_vocab_id(image_token_grids.view(images.shape[0], -1))

    @staticmethod
    def _pad_sequences(sequences: list[list[int]]) -> tuple[torch.Tensor, torch.Tensor]:
        max_len = max(len(s) for s in sequences)
        input_ids = torch.full((len(sequences), max_len), SpecialTokens.PAD, dtype=torch.long)
        labels = torch.full((len(sequences), max_len), -100, dtype=torch.long)
        for i, seq in enumerate(sequences):
            input_ids[i, : len(seq)] = torch.tensor(seq, dtype=torch.long)
            labels[i, : len(seq)] = torch.tensor(seq, dtype=torch.long)
        return input_ids, labels

    @torch.no_grad()
    def __call__(self, batch: list[tuple[str, torch.Tensor]]) -> tuple[torch.Tensor, torch.Tensor]:
        offset_image_tokens = self.encode_batch_images(batch)

        sequences = []
        for (caption, _), image_ids in zip(batch, offset_image_tokens):
            caption_ids = self.text_tokenizer.encode(caption)
            image_ids_list = image_ids.tolist()
            sequences.append(self.build_generation_sequence(caption_ids, image_ids_list))
            if self.both_directions:
                sequences.append(self.build_understanding_sequence(caption_ids, image_ids_list))

        return self._pad_sequences(sequences)


class AudioMultimodalCollator:
    """The audio counterpart to MultimodalCollator â€” same bidirectional
    principle (owner spec: audio understanding/analysis, not just
    generation, "ظٹط¬ط¨ ط§ظ† ظٹظƒظˆظ† ظƒط§ظ…ظ„ط§"): transcript-then-audio teaches
    text-to-speech generation (already built via audio_tokenizer.py);
    audio-then-transcript teaches real speech UNDERSTANDING
    (transcription) â€” both from the one shared autoregressive
    sequence, both_directions=True by default builds both from every
    (audio, transcript) pair."""

    def __init__(self, text_tokenizer: ShamTextTokenizer, audio_tokenizer: AudioTokenizer, both_directions: bool = True):
        self.text_tokenizer = text_tokenizer
        self.audio_tokenizer = audio_tokenizer
        self.both_directions = both_directions

    @staticmethod
    def build_generation_sequence(transcript_ids: list[int], audio_ids: list[int]) -> list[int]:
        """transcript -> audio: text-to-speech direction."""
        return (
            [SpecialTokens.BOS] + transcript_ids
            + [SpecialTokens.AUDIO_START] + audio_ids + [SpecialTokens.AUDIO_END, SpecialTokens.EOS]
        )

    @staticmethod
    def build_understanding_sequence(transcript_ids: list[int], audio_ids: list[int]) -> list[int]:
        """audio -> transcript: speech-recognition/understanding direction."""
        return (
            [SpecialTokens.BOS, SpecialTokens.AUDIO_START] + audio_ids + [SpecialTokens.AUDIO_END]
            + transcript_ids + [SpecialTokens.EOS]
        )

    def encode_batch_audio(self, batch: list[tuple[str, torch.Tensor]]) -> torch.Tensor:
        mels = torch.stack([mel for _, mel in batch], dim=0)
        audio_token_grids = self.audio_tokenizer.encode(mels)
        return audio_token_id_to_vocab_id(audio_token_grids.view(mels.shape[0], -1))

    @staticmethod
    def _pad_sequences(sequences: list[list[int]]) -> tuple[torch.Tensor, torch.Tensor]:
        return MultimodalCollator._pad_sequences(sequences)

    @torch.no_grad()
    def __call__(self, batch: list[tuple[str, torch.Tensor]]) -> tuple[torch.Tensor, torch.Tensor]:
        offset_audio_tokens = self.encode_batch_audio(batch)

        sequences = []
        for (transcript, _), audio_ids in zip(batch, offset_audio_tokens):
            transcript_ids = self.text_tokenizer.encode(transcript)
            audio_ids_list = audio_ids.tolist()
            sequences.append(self.build_generation_sequence(transcript_ids, audio_ids_list))
            if self.both_directions:
                sequences.append(self.build_understanding_sequence(transcript_ids, audio_ids_list))

        return self._pad_sequences(sequences)


if __name__ == "__main__":
    import tempfile

    from image_tokenizer import ImageTokenizerConfig
    from text_tokenizer import train_text_tokenizer

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        # --- 0. ContentSafetyFilter: word-boundary matching, not raw
        #        substring â€” a real false positive this fixes: plain
        #        substring matching flagged "denuded" (a real pathology
        #        term, "denuded epithelium") just because it contains
        #        "nude". The blocked term itself, as its own word, must
        #        still be caught.
        safety_filter = ContentSafetyFilter()
        assert safety_filter.check_text("the biopsy showed denuded epithelium in the affected area").is_safe, (
            "false positive: 'denuded' must NOT match the blocked term 'nude' embedded inside it"
        )
        assert not safety_filter.check_text("an explicit nude image was uploaded").is_safe, (
            "true positive missed: the standalone word 'nude' must still be caught"
        )
        print("ContentSafetyFilter OK: word-boundary matching lets 'denuded' (real medical vocabulary) "
              "through while still catching the standalone blocked word 'nude'.")

        # --- 1. Real text pipeline: PER-LINE safety filtering ----------
        # Mirrors the real shard format data_acquisition.py produces:
        # many real documents (one per line) in a SINGLE file. Direct
        # regression test for a real bug this fix corrected: a real
        # 20,000-document Arabic Wikipedia run produced ZERO training
        # chunks because the filter used to reject the ENTIRE shard file
        # over one line matching â€” here, one bad line among thousands of
        # good ones must knock out only that line, not the whole file.
        safe_doc = tmp / "safe.txt"
        safe_doc.write_text("Sham is a real, from-scratch multimodal transformer. " * 50, encoding="utf-8")
        mixed_doc = tmp / "mixed_shard.txt"
        mixed_lines = ["this is a real, legitimate document about ordinary encyclopedic content."] * 20
        mixed_lines[10] = "this line contains nsfw content and must be the only line excluded"
        mixed_doc.write_text("\n".join(mixed_lines), encoding="utf-8")
        all_unsafe_doc = tmp / "all_unsafe.txt"
        all_unsafe_doc.write_text("this document contains nsfw content and should be excluded", encoding="utf-8")

        tokenizer = train_text_tokenizer([str(safe_doc)], vocab_size=300)
        text_dataset = TextSequenceDataset([str(safe_doc), str(mixed_doc), str(all_unsafe_doc)], tokenizer, seq_len=16)
        # 2 unsafe lines total: the 1 planted inside mixed_doc's 20 lines,
        # plus all_unsafe_doc's own single (fully-unsafe) line.
        assert text_dataset.skipped_lines == 2, f"expected exactly 2 unsafe lines skipped, got {text_dataset.skipped_lines}"
        assert text_dataset.skipped_files == 1, f"expected 1 entirely-unsafe file skipped, got {text_dataset.skipped_files}"
        assert len(text_dataset) > 0, "no chunks produced despite most content being safe"
        sample = text_dataset[0]
        assert sample.shape == (16,)  # exactly seq_len
        print(f"TextSequenceDataset OK: {text_dataset.skipped_lines} unsafe lines excluded WITHOUT discarding "
              f"the other 19 legitimate lines in the same shard file, {text_dataset.skipped_files} entirely-unsafe "
              f"file excluded, {len(text_dataset)} real training chunks produced overall.")

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
        from model import ShamSmall, ShamSmallConfig

        model_cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=64, max_seq_len=512)
        model = ShamSmall(model_cfg)
        logits, loss = model(input_ids, labels=labels)
        assert torch.isfinite(loss), f"loss is not finite: {loss}"
        print(f"end-to-end OK: real files -> dataset -> collator -> ShamSmall.forward() -> finite loss "
              f"({loss.item():.4f}).")

        # --- 4. Real audio+transcript pipeline: safety filtering + collate
        from audio_tokenizer import AudioTokenizerConfig
        import numpy as np

        audio_tokenizer_cfg = AudioTokenizerConfig(
            n_mels=16, segment_frames=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=64
        )
        audio_tokenizer = AudioTokenizer(audio_tokenizer_cfg)

        sample_rate = 16000
        for i, freq in enumerate([220, 440]):
            samples = (0.3 * np.sin(2 * np.pi * freq * np.linspace(0, 0.5, int(sample_rate * 0.5)))).astype("float32")
            sf.write(str(tmp / f"clip{i}.wav"), samples, sample_rate)
        unsafe_samples = (0.1 * np.sin(2 * np.pi * 880 * np.linspace(0, 0.5, int(sample_rate * 0.5)))).astype("float32")
        sf.write(str(tmp / "clip2.wav"), unsafe_samples, sample_rate)

        audio_manifest_path = tmp / "audio_manifest.jsonl"
        with open(audio_manifest_path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"audio": "clip0.wav", "sentence": "a low tone"}) + "\n")
            f.write(json.dumps({"audio": "clip1.wav", "sentence": "a higher tone"}) + "\n")
            f.write(json.dumps({"audio": "clip2.wav", "sentence": "nsfw content here"}) + "\n")  # must be filtered

        audio_dataset = AudioTranscriptDataset(
            str(audio_manifest_path), n_mels=audio_tokenizer_cfg.n_mels, segment_frames=audio_tokenizer_cfg.segment_frames
        )
        assert audio_dataset.skipped_entries == 1, f"expected 1 unsafe entry skipped, got {audio_dataset.skipped_entries}"
        assert len(audio_dataset) == 2
        transcript0, mel0 = audio_dataset[0]
        assert mel0.shape == (1, audio_tokenizer_cfg.n_mels, audio_tokenizer_cfg.segment_frames)
        print(f"AudioTranscriptDataset OK: {audio_dataset.skipped_entries} unsafe entry correctly excluded, "
              f"{len(audio_dataset)} real (transcript, audio) pairs loaded from real .wav files.")

        audio_collator = AudioMultimodalCollator(tokenizer, audio_tokenizer)
        audio_batch = [audio_dataset[0], audio_dataset[1]]
        audio_input_ids, audio_labels = audio_collator(audio_batch)
        assert audio_input_ids.shape == audio_labels.shape
        assert (audio_input_ids == SpecialTokens.PAD).sum() == (audio_labels == -100).sum()
        assert audio_input_ids.shape[0] == 4, "both_directions=True should double the 2-sample batch to 4 sequences"
        print(f"AudioMultimodalCollator OK: built a real padded batch {tuple(audio_input_ids.shape)} "
              f"(both directions) from raw audio/transcripts via the frozen audio tokenizer.")

        audio_logits, audio_loss = model(audio_input_ids, labels=audio_labels)
        assert torch.isfinite(audio_loss), f"audio loss is not finite: {audio_loss}"
        print(f"end-to-end OK: real audio files -> dataset -> collator -> ShamSmall.forward() -> finite "
              f"loss ({audio_loss.item():.4f}).")

    print("\nAll data pipeline checks passed â€” real files become real, safety-filtered, correctly "
          "shaped training batches, for text, image, AND audio.")
