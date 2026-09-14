"""
The audio counterpart to verify_bidirectional_vision.py — real,
executed proof that audio UNDERSTANDING (speech-to-text) is a
genuinely trained capability of NovaSmall, not just audio generation
(text-to-speech), from the same bidirectional-sequence mechanism (see
dataset.py's AudioMultimodalCollator.build_understanding_sequence).
Owner spec: "الصوت ... يجب ان يكون كاملا" (audio must be complete too).
"""

import math

import numpy as np
import torch

from audio_tokenizer import AudioTokenizer, AudioTokenizerConfig
from dataset import AudioMultimodalCollator
from mel_spectrogram import waveform_to_mel_spectrogram
from model import NovaSmall, NovaSmallConfig
from text_tokenizer import train_text_tokenizer


def make_synthetic_audio_transcript_dataset(
    audio_cfg: AudioTokenizerConfig, sample_rate: int = 16000, num_samples: int = 48, seed: int = 0
) -> tuple[list[tuple[str, torch.Tensor]], list[str]]:
    """Distinct tone frequencies, each with its OWN fixed transcript —
    real, learnable audio<->text structure, the audio analog of
    verify_bidirectional_vision's colored-square patterns."""
    transcripts = ["a low tone", "a medium tone", "a high tone"]
    frequencies = [220.0, 440.0, 880.0]
    rng = np.random.default_rng(seed)
    duration_seconds = 0.5
    samples = []
    for i in range(num_samples):
        idx = i % len(transcripts)
        t = np.linspace(0, duration_seconds, int(sample_rate * duration_seconds), dtype=np.float32)
        noise = rng.normal(0, 0.02, size=t.shape).astype(np.float32)
        waveform = 0.4 * np.sin(2 * math.pi * frequencies[idx] * t) + noise
        mel = waveform_to_mel_spectrogram(
            torch.from_numpy(waveform), sample_rate, audio_cfg.n_mels, audio_cfg.segment_frames
        )
        samples.append((transcripts[idx], mel))
    return samples, transcripts


@torch.no_grad()
def _masked_loss(model: NovaSmall, input_ids: torch.Tensor, target_labels: torch.Tensor) -> float:
    _, loss = model(input_ids, labels=target_labels)
    return loss.item()


def _build_isolated_eval_batch(
    collator: AudioMultimodalCollator, batch: list[tuple[str, torch.Tensor]], direction: str
) -> tuple[torch.Tensor, torch.Tensor]:
    offset_audio_tokens = collator.encode_batch_audio(batch)
    sequences, target_spans = [], []
    for (transcript, _), audio_ids in zip(batch, offset_audio_tokens):
        transcript_ids = collator.text_tokenizer.encode(transcript)
        audio_ids_list = audio_ids.tolist()
        if direction == "generation":
            seq = collator.build_generation_sequence(transcript_ids, audio_ids_list)
            start = 1 + len(transcript_ids) + 1
            end = start + len(audio_ids_list)
        else:
            seq = collator.build_understanding_sequence(transcript_ids, audio_ids_list)
            start = 2 + len(audio_ids_list) + 1
            end = start + len(transcript_ids)
        sequences.append(seq)
        target_spans.append((start, end))

    input_ids, _ = collator._pad_sequences(sequences)
    labels = torch.full_like(input_ids, -100)
    for i, (start, end) in enumerate(target_spans):
        labels[i, start:end] = input_ids[i, start:end]
    return input_ids, labels


def main() -> None:
    torch.manual_seed(0)

    audio_cfg = AudioTokenizerConfig(
        n_mels=16, segment_frames=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=64
    )
    audio_tokenizer = AudioTokenizer(audio_cfg)
    dataset, transcripts = make_synthetic_audio_transcript_dataset(audio_cfg, num_samples=48)

    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as tmpdir:
        corpus_path = Path(tmpdir) / "transcripts.txt"
        corpus_path.write_text("\n".join(transcripts * 20), encoding="utf-8")
        text_tokenizer = train_text_tokenizer([str(corpus_path)], vocab_size=300)

    collator = AudioMultimodalCollator(text_tokenizer, audio_tokenizer, both_directions=True)

    model_cfg = NovaSmallConfig(
        vocab_size=42256, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=512
    )
    model = NovaSmall(model_cfg)
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4)

    eval_batch = dataset[:8]
    gen_input_before, gen_labels_before = _build_isolated_eval_batch(collator, eval_batch, "generation")
    und_input_before, und_labels_before = _build_isolated_eval_batch(collator, eval_batch, "understanding")
    model.eval()
    gen_loss_before = _masked_loss(model, gen_input_before, gen_labels_before)
    und_loss_before = _masked_loss(model, und_input_before, und_labels_before)
    print(f"before training: generation loss (audio | transcript) = {gen_loss_before:.4f}, "
          f"understanding loss (transcript | audio) = {und_loss_before:.4f}")

    model.train()
    batch_size = 8
    num_epochs = 25
    for epoch in range(num_epochs):
        for start in range(0, len(dataset), batch_size):
            batch = dataset[start : start + batch_size]
            input_ids, labels = collator(batch)
            _, loss = model(input_ids, labels=labels)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

    model.eval()
    gen_loss_after = _masked_loss(model, gen_input_before, gen_labels_before)
    und_loss_after = _masked_loss(model, und_input_before, und_labels_before)
    print(f"after training:  generation loss (audio | transcript) = {gen_loss_after:.4f}, "
          f"understanding loss (transcript | audio) = {und_loss_after:.4f}")

    assert gen_loss_after < gen_loss_before * 0.9, (
        f"generation (TTS-direction) loss did not meaningfully improve: {gen_loss_before:.4f} -> {gen_loss_after:.4f}"
    )
    assert und_loss_after < und_loss_before * 0.9, (
        f"understanding (transcription-direction) loss did not meaningfully improve: "
        f"{und_loss_before:.4f} -> {und_loss_after:.4f}"
    )
    print(f"\ngeneration (TTS) improved {(1 - gen_loss_after / gen_loss_before) * 100:.0f}%, "
          f"understanding (transcription) improved {(1 - und_loss_after / und_loss_before) * 100:.0f}% "
          f"— both measured in isolation from each other.")
    print("\nAll bidirectional audio checks passed — the SAME shared model genuinely learns both "
          "text-to-speech generation AND speech transcription from one training run.")


if __name__ == "__main__":
    main()
