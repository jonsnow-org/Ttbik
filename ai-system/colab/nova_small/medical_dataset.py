"""
Nova Small — medical/anatomical education video data pipeline. Real,
legitimate clinical education content (human anatomy, physiological
processes including childbirth) is a normal, standard part of medical
and midwifery training — used every day in medical schools and nursing
programs. This is a genuinely different category from, and not a route
around, the sexual-content boundary this project has repeatedly and
firmly declined elsewhere: the difference is not the anatomy shown, it
is the real clinical/educational purpose and, critically, the real
consent and licensing behind the specific footage used.

That difference is enforced here in CODE, not left as a promise: every
entry in a real manifest MUST declare its real source institution, a
real license, and explicit confirmation that informed consent was
obtained from any real person depicted — verify_provenance() below
rejects any entry missing this outright, before it ever reaches a
training batch. A manifest that just points at a pile of unlabeled
video with no provenance is refused by this code, not merely
discouraged in a comment; the person assembling the real manifest still
has to have actually done the ethical/legal sourcing work — this can't
verify that a claimed license or consent is real, only that someone
was made to explicitly assert it in a structured, auditable way rather
than the pipeline silently trusting whatever bytes show up in a
folder.

Reuses the exact bidirectional principle already built for images
(dataset.py's MultimodalCollator) and audio (AudioMultimodalCollator):
description-then-video teaches generation (illustrating a described
process), video-then-description teaches real understanding
(recognizing/explaining an anatomical structure or stage from footage)
— both from the same shared architecture, no new model code needed,
reusing video_tokenizer.py's own encode_video()/decode_video() exactly
as built for the general video case.
"""

import json
from pathlib import Path

import torch
from PIL import Image

from dataset import ContentSafetyFilter
from image_tokenizer import ImageTokenizer
from model import SpecialTokens
from text_tokenizer import NovaTextTokenizer
from video_tokenizer import encode_video

_REQUIRED_PROVENANCE_FIELDS = {"source", "license", "consent_obtained"}
_REJECTED_LICENSE_VALUES = {"", "unknown", "unlicensed", "none", "n/a", "na"}


class ProvenanceVerdict:
    def __init__(self, is_valid: bool, reason: str | None = None):
        self.is_valid = is_valid
        self.reason = reason

    def __repr__(self) -> str:
        return f"ProvenanceVerdict(is_valid={self.is_valid}, reason={self.reason!r})"


def verify_provenance(record: dict) -> ProvenanceVerdict:
    """The real, enforced gate — see this module's own docstring for
    why this is a code check and not just a documentation note. Every
    one of these three checks corresponds to a real, separate way a
    manifest entry can be unfit for training: no declared source at
    all, a license field that is empty/a placeholder rather than a
    real license, or consent that was never actually confirmed."""
    missing = _REQUIRED_PROVENANCE_FIELDS - record.keys()
    if missing:
        return ProvenanceVerdict(False, f"missing required provenance field(s): {sorted(missing)}")

    license_value = str(record.get("license", "")).strip().lower()
    if license_value in _REJECTED_LICENSE_VALUES:
        return ProvenanceVerdict(False, f"no real license specified (got {record.get('license')!r})")

    if record.get("consent_obtained") is not True:
        return ProvenanceVerdict(
            False,
            "consent_obtained must be explicitly boolean true — real, documented subject consent is "
            "required for real anatomical/clinical footage, especially anything depicting an identifiable "
            "person or a sensitive procedure such as childbirth",
        )

    return ProvenanceVerdict(True)


class MedicalVideoDataset(torch.utils.data.Dataset):
    """Real (video frames, clinical/educational description) pairs.
    manifest_path is a JSONL file, one object per line:
        {"frames_dir": "<path, relative to the manifest's own dir>",
         "description": "<real educational text>",
         "source": "<real institution or archive name>",
         "license": "<a real license, e.g. 'CC-BY-4.0' or a named institutional release>",
         "consent_obtained": true}
    frames_dir must contain real, ordered image files (frame_0000.png,
    frame_0001.png, ...) — exactly num_frames of them — matching the
    same real per-frame representation video_tokenizer.py's own
    encode_video()/decode_video() already use for any video."""

    def __init__(
        self,
        manifest_path: str,
        image_size: int,
        num_frames: int,
        safety_filter: ContentSafetyFilter | None = None,
    ):
        safety_filter = safety_filter or ContentSafetyFilter()
        manifest_dir = Path(manifest_path).parent
        self.image_size = image_size
        self.num_frames = num_frames
        self.entries: list[tuple[Path, str]] = []
        self.skipped_provenance = 0
        self.skipped_unsafe = 0
        self.rejection_log: list[tuple[str, str]] = []  # (frames_dir, reason) — a real audit trail, not silent dropping

        with open(manifest_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)

                provenance = verify_provenance(record)
                if not provenance.is_valid:
                    self.skipped_provenance += 1
                    self.rejection_log.append((record.get("frames_dir", "?"), f"provenance: {provenance.reason}"))
                    continue

                verdict = safety_filter.check_text(record["description"])
                if not verdict.is_safe:
                    self.skipped_unsafe += 1
                    self.rejection_log.append((record["frames_dir"], f"safety filter: {verdict.reason}"))
                    continue

                self.entries.append((manifest_dir / record["frames_dir"], record["description"]))

    def __len__(self) -> int:
        return len(self.entries)

    def __getitem__(self, idx: int) -> tuple[str, torch.Tensor]:
        frames_dir, description = self.entries[idx]
        frame_paths = sorted(Path(frames_dir).glob("frame_*.png"))
        if len(frame_paths) != self.num_frames:
            raise ValueError(f"{frames_dir} has {len(frame_paths)} frames, expected exactly {self.num_frames}")

        frames = []
        for path in frame_paths:
            image = Image.open(path).convert("RGB").resize((self.image_size, self.image_size))
            tensor = torch.tensor(list(image.getdata()), dtype=torch.float32).view(self.image_size, self.image_size, 3)
            frames.append(tensor.permute(2, 0, 1) / 127.5 - 1.0)
        video = torch.stack(frames, dim=0)  # (num_frames, 3, H, W), matching video_tokenizer's own contract
        return description, video


class MedicalVideoCollator:
    """The video counterpart to MultimodalCollator/AudioMultimodalCollator
    — same bidirectional principle: description-then-video (generation,
    e.g. illustrating a described anatomical stage) and video-then-
    description (understanding, e.g. explaining what a real clip
    shows), both from every real, provenance-checked (video,
    description) pair."""

    def __init__(self, text_tokenizer: NovaTextTokenizer, image_tokenizer: ImageTokenizer, both_directions: bool = True):
        self.text_tokenizer = text_tokenizer
        self.image_tokenizer = image_tokenizer
        self.both_directions = both_directions

    def _encode_video_span(self, video: torch.Tensor) -> list[int]:
        """Returns the real <VIDEO_START>...<VIDEO_END> token span
        (already offset into the shared vocabulary) for one video,
        reusing video_tokenizer.encode_video() exactly as built."""
        span = encode_video(self.image_tokenizer, video.unsqueeze(0))[0]
        return span.tolist()

    def build_generation_sequence(self, description_ids: list[int], video_span: list[int]) -> list[int]:
        return [SpecialTokens.BOS] + description_ids + video_span + [SpecialTokens.EOS]

    def build_understanding_sequence(self, description_ids: list[int], video_span: list[int]) -> list[int]:
        return [SpecialTokens.BOS] + video_span + description_ids + [SpecialTokens.EOS]

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
        sequences = []
        for description, video in batch:
            description_ids = self.text_tokenizer.encode(description)
            video_span = self._encode_video_span(video)
            sequences.append(self.build_generation_sequence(description_ids, video_span))
            if self.both_directions:
                sequences.append(self.build_understanding_sequence(description_ids, video_span))
        return self._pad_sequences(sequences)


if __name__ == "__main__":
    import tempfile

    from image_tokenizer import ImageTokenizerConfig
    from model import NovaSmall, NovaSmallConfig
    from text_tokenizer import train_text_tokenizer

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        image_size, num_frames = 32, 2

        def make_clip(name: str, base_color: tuple[int, int, int]) -> str:
            clip_dir = tmp / name
            clip_dir.mkdir()
            for i in range(num_frames):
                color = tuple(min(255, c + i * 15) for c in base_color)
                Image.new("RGB", (image_size, image_size), color=color).save(clip_dir / f"frame_{i:04d}.png")
            return name

        clip_valid = make_clip("clip_valid", (120, 80, 60))
        clip_no_consent = make_clip("clip_no_consent", (60, 120, 80))
        clip_no_license = make_clip("clip_no_license", (80, 60, 120))
        clip_unsafe_text = make_clip("clip_unsafe_text", (100, 100, 100))

        manifest_path = tmp / "manifest.jsonl"
        with open(manifest_path, "w", encoding="utf-8") as f:
            f.write(json.dumps({
                "frames_dir": clip_valid, "description": "stage two of labor, cervical dilation",
                "source": "Example University School of Medicine, OB/GYN teaching archive",
                "license": "CC-BY-4.0", "consent_obtained": True,
            }) + "\n")
            f.write(json.dumps({
                "frames_dir": clip_no_consent, "description": "a real clinical clip",
                "source": "Example Hospital", "license": "CC-BY-4.0", "consent_obtained": False,
            }) + "\n")
            f.write(json.dumps({
                "frames_dir": clip_no_license, "description": "a real clinical clip",
                "source": "Example Hospital", "license": "unknown", "consent_obtained": True,
            }) + "\n")
            f.write(json.dumps({
                "frames_dir": clip_unsafe_text, "description": "nsfw content here",
                "source": "Example Hospital", "license": "CC-BY-4.0", "consent_obtained": True,
            }) + "\n")

        tokenizer = train_text_tokenizer([str(manifest_path)], vocab_size=300)
        dataset = MedicalVideoDataset(str(manifest_path), image_size=image_size, num_frames=num_frames)

        assert dataset.skipped_provenance == 2, f"expected 2 provenance rejections, got {dataset.skipped_provenance}"
        assert dataset.skipped_unsafe == 1, f"expected 1 safety-filter rejection, got {dataset.skipped_unsafe}"
        assert len(dataset) == 1, f"expected exactly 1 valid entry, got {len(dataset)}"
        print(f"MedicalVideoDataset OK: {dataset.skipped_provenance} rejected for missing/invalid provenance "
              f"(no consent, no real license), {dataset.skipped_unsafe} rejected by the content safety filter, "
              f"{len(dataset)} genuinely valid entry kept.")
        for frames_dir, reason in dataset.rejection_log:
            print(f"  rejected {Path(frames_dir).name}: {reason}")

        description0, video0 = dataset[0]
        assert video0.shape == (num_frames, 3, image_size, image_size)
        print(f"loaded the one valid clip: {video0.shape} real frames, description={description0!r}")

        image_cfg = ImageTokenizerConfig(image_size=image_size, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=64)
        image_tokenizer = ImageTokenizer(image_cfg)
        collator = MedicalVideoCollator(tokenizer, image_tokenizer)
        input_ids, labels = collator([dataset[0]])
        assert input_ids.shape == labels.shape
        assert input_ids.shape[0] == 2, "both_directions=True should produce 2 sequences from 1 entry"
        print(f"MedicalVideoCollator OK: built a real padded batch {tuple(input_ids.shape)} (both directions) "
              f"from the one valid, provenance-checked clip.")

        model_cfg = NovaSmallConfig(vocab_size=42256, d_model=32, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=64, max_seq_len=1024)
        model = NovaSmall(model_cfg)
        logits, loss = model(input_ids, labels=labels)
        assert torch.isfinite(loss), f"loss is not finite: {loss}"
        print(f"end-to-end OK: real provenance-checked medical clip -> dataset -> collator -> "
              f"NovaSmall.forward() -> finite loss ({loss.item():.4f}).")

    print("\nAll medical education data pipeline checks passed — only entries with real declared source, "
          "license, and explicit consent ever reach a training batch; everything else is rejected with a "
          "real, logged reason.")
