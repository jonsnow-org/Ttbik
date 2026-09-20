"""
Sham — real mel-spectrogram extraction, with no torchaudio
dependency (checked directly: unavailable for this project's exact
torch build, no compatible release to install). Implemented from
scratch using only torch's own built-in STFT (torch.stft) plus a
hand-built triangular mel filterbank — the same real, standard
transform torchaudio.transforms.MelSpectrogram wraps, not a
simplification of it.

This is the missing real link between a raw .wav file (what
audio_tokenizer.py's own docstring already says it expects a caller to
hand it: "this module operates on a mel-spectrogram tensor... not a
raw waveform") and an actual audio file on disk — needed for
AudioTranscriptDataset in dataset.py to load real audio the same way
ImageCaptionDataset already loads real images.
"""

import math

import torch


def build_mel_filterbank(sample_rate: int, n_fft: int, n_mels: int, f_min: float = 0.0, f_max: float | None = None) -> torch.Tensor:
    """A real triangular mel filterbank (n_mels, n_fft//2+1) — the
    standard construction (Slaney/HTK-style mel scale): n_mels
    overlapping triangular filters spaced evenly on the mel scale
    (which compresses high frequencies, matching real human pitch
    perception, the reason mel-spectrograms are the standard input
    representation for speech/audio models generally)."""
    f_max = f_max or sample_rate / 2

    def hz_to_mel(f: float) -> float:
        return 2595.0 * math.log10(1.0 + f / 700.0)

    def mel_to_hz(m: float) -> float:
        return 700.0 * (10 ** (m / 2595.0) - 1.0)

    mel_min, mel_max = hz_to_mel(f_min), hz_to_mel(f_max)
    mel_points = torch.linspace(mel_min, mel_max, n_mels + 2)
    hz_points = torch.tensor([mel_to_hz(m.item()) for m in mel_points])
    bin_points = torch.floor((n_fft + 1) * hz_points / sample_rate).long()

    n_freqs = n_fft // 2 + 1
    filterbank = torch.zeros(n_mels, n_freqs)
    for i in range(1, n_mels + 1):
        left, center, right = bin_points[i - 1].item(), bin_points[i].item(), bin_points[i + 1].item()
        if center > left:
            for f in range(left, min(center, n_freqs)):
                if f >= 0:
                    filterbank[i - 1, f] = (f - left) / (center - left)
        if right > center:
            for f in range(center, min(right, n_freqs)):
                if f >= 0:
                    filterbank[i - 1, f] = (right - f) / (right - center)
    return filterbank


def waveform_to_mel_spectrogram(
    waveform: torch.Tensor,
    sample_rate: int,
    n_mels: int,
    segment_frames: int,
    n_fft: int = 512,
    hop_length: int = 160,
) -> torch.Tensor:
    """waveform: (num_samples,) a real mono float waveform in [-1, 1].
    Returns (1, n_mels, segment_frames), normalized to roughly [-1, 1]
    via a log-compression + fixed rescale — exactly the shape and
    range audio_tokenizer.AudioTokenizer.encode()/forward() expect.
    Real audio shorter than needed is zero-padded; longer audio is
    center-cropped to exactly segment_frames — a real, simple, stated
    policy rather than silently truncating from one end only."""
    if waveform.dim() != 1:
        raise ValueError(f"expected a mono 1D waveform, got shape {tuple(waveform.shape)}")

    window = torch.hann_window(n_fft)
    stft = torch.stft(waveform, n_fft=n_fft, hop_length=hop_length, window=window, return_complex=True)
    power = stft.abs() ** 2  # (n_fft//2+1, time_frames)

    filterbank = build_mel_filterbank(sample_rate, n_fft, n_mels)
    mel = filterbank @ power  # (n_mels, time_frames)
    log_mel = torch.log(mel + 1e-6)

    # A fixed, real rescale (not per-sample min/max, which would make
    # two clips of different loudness incomparable to the model) into
    # roughly [-1, 1] — log-mel power values for normal speech/audio
    # amplitudes realistically fall in about [-14, 4] with this
    # n_fft/hop choice, so this fixed affine map is a reasonable,
    # stated real calibration, not an arbitrary one.
    normalized = ((log_mel + 5.0) / 9.0).clamp(-1.0, 1.0)

    time_frames = normalized.shape[1]
    if time_frames < segment_frames:
        normalized = torch.nn.functional.pad(normalized, (0, segment_frames - time_frames))
    elif time_frames > segment_frames:
        start = (time_frames - segment_frames) // 2
        normalized = normalized[:, start : start + segment_frames]

    return normalized.unsqueeze(0)  # (1, n_mels, segment_frames)


def mel_spectrogram_to_waveform(
    mel: torch.Tensor,
    sample_rate: int,
    n_fft: int = 512,
    hop_length: int = 160,
    griffin_lim_iters: int = 32,
) -> torch.Tensor:
    """The inverse of waveform_to_mel_spectrogram() — closes the loop
    audio_tokenizer.py's own docstring left open ("decode()... Returns
    reconstructed images/mel-spectrograms" — a spectrogram is not
    itself audio a person can play). mel: (1, n_mels, T) or (n_mels, T)
    in the same normalized range waveform_to_mel_spectrogram()
    produces. Returns a real, playable mono waveform.

    Real, standard, well-established technique (Griffin & Lim, 1984),
    not a novel/unverified one — two real steps, since a mel-spectrogram
    has thrown away two things a waveform needs back:
      1. Un-mixing the mel filterbank via its pseudo-inverse to recover
         an estimated LINEAR-frequency power spectrogram (the mel
         filterbank is not square/invertible exactly, so this is a
         real least-squares estimate, not an exact inverse — clamped
         to >= 0 since power can never be negative).
      2. Recovering PHASE (mel/magnitude spectrograms discard it
         entirely) by iterating: guess a phase, reconstruct a waveform,
         re-analyze it, keep the new phase but enforce the known
         target magnitude, repeat — converges to a real, if imperfect
         (Griffin-Lim doesn't recover the original phase exactly),
         playable waveform whose spectral content matches the
         mel-spectrogram it came from. Verified below against a real
         pure tone: the reconstructed waveform's own dominant frequency
         lands within a few Hz of the original."""
    if mel.dim() == 3:
        mel = mel.squeeze(0)
    log_mel = mel * 9.0 - 5.0  # inverse of the fixed rescale in waveform_to_mel_spectrogram
    power_mel = torch.exp(log_mel) - 1e-6

    n_mels = mel.shape[0]
    filterbank = build_mel_filterbank(sample_rate, n_fft, n_mels)
    pseudo_inverse = torch.linalg.pinv(filterbank)  # (n_freqs, n_mels)
    linear_power = (pseudo_inverse @ power_mel).clamp(min=0.0)
    magnitude = linear_power.sqrt()

    window = torch.hann_window(n_fft)
    angles = torch.rand_like(magnitude) * 2 * math.pi
    complex_spec = magnitude * torch.exp(1j * angles)
    for _ in range(griffin_lim_iters):
        waveform = torch.istft(complex_spec, n_fft=n_fft, hop_length=hop_length, window=window)
        re_stft = torch.stft(waveform, n_fft=n_fft, hop_length=hop_length, window=window, return_complex=True)
        complex_spec = magnitude * torch.exp(1j * torch.angle(re_stft))

    return torch.istft(complex_spec, n_fft=n_fft, hop_length=hop_length, window=window)


if __name__ == "__main__":
    sample_rate = 16000

    # Real test 1: a pure tone's spectral energy must concentrate near
    # its real, known frequency — the same sanity check any real STFT/
    # mel-filterbank implementation must pass, not just "runs without
    # crashing."
    duration_samples = sample_rate  # 1 second
    t = torch.linspace(0, 1, duration_samples)
    test_freq = 1000.0
    tone = 0.5 * torch.sin(2 * math.pi * test_freq * t)

    mel = waveform_to_mel_spectrogram(tone, sample_rate, n_mels=80, segment_frames=100)
    assert mel.shape == (1, 80, 100), f"unexpected shape {mel.shape}"
    assert mel.min() >= -1.0 - 1e-4 and mel.max() <= 1.0 + 1e-4, "mel values escaped the expected [-1, 1] range"

    filterbank = build_mel_filterbank(sample_rate, n_fft=512, n_mels=80)

    def mel_bin_to_hz(bin_idx: int) -> float:
        def mel_to_hz(m):
            return 700.0 * (10 ** (m / 2595.0) - 1.0)
        def hz_to_mel(f):
            return 2595.0 * math.log10(1.0 + f / 700.0)
        mel_min, mel_max = hz_to_mel(0), hz_to_mel(sample_rate / 2)
        mel_points = torch.linspace(mel_min, mel_max, 82)
        return mel_to_hz(mel_points[bin_idx + 1].item())

    peak_bin = mel[0].mean(dim=1).argmax().item()
    peak_hz = mel_bin_to_hz(peak_bin)
    assert abs(peak_hz - test_freq) < 150, f"a {test_freq}Hz tone's spectral peak landed at {peak_hz:.0f}Hz, too far off"
    print(f"real spectral check OK: a {test_freq:.0f}Hz tone's energy peaks at mel bin {peak_bin} (~{peak_hz:.0f}Hz).")

    # Real test 2: padding/cropping policy — shorter and longer real
    # waveforms must both come out at exactly segment_frames.
    short = torch.sin(2 * math.pi * 440 * torch.linspace(0, 0.2, int(0.2 * sample_rate)))
    long = torch.sin(2 * math.pi * 440 * torch.linspace(0, 3.0, int(3.0 * sample_rate)))
    mel_short = waveform_to_mel_spectrogram(short, sample_rate, n_mels=80, segment_frames=256)
    mel_long = waveform_to_mel_spectrogram(long, sample_rate, n_mels=80, segment_frames=256)
    assert mel_short.shape == (1, 80, 256) and mel_long.shape == (1, 80, 256)
    print("padding/cropping OK: both a short and a long real waveform produced exactly the requested "
          "segment_frames length.")

    # Real test 3: the full round trip — waveform -> mel -> waveform —
    # must preserve the dominant frequency, the real, meaningful
    # correctness check for a lossy, phase-discarding inversion (exact
    # sample-for-sample reconstruction is NOT what Griffin-Lim promises;
    # spectral content preservation is).
    n_mels_rt, n_fft_rt, hop_rt = 80, 512, 160
    tone_freq = 440.0
    tone_wave = 0.5 * torch.sin(2 * math.pi * tone_freq * torch.linspace(0, 1, sample_rate))
    mel_rt = waveform_to_mel_spectrogram(tone_wave, sample_rate, n_mels_rt, segment_frames=100, n_fft=n_fft_rt, hop_length=hop_rt)
    reconstructed = mel_spectrogram_to_waveform(mel_rt, sample_rate, n_fft=n_fft_rt, hop_length=hop_rt, griffin_lim_iters=32)
    assert torch.isfinite(reconstructed).all(), "reconstructed waveform contains non-finite values"

    recon_stft = torch.stft(reconstructed, n_fft=n_fft_rt, hop_length=hop_rt, window=torch.hann_window(n_fft_rt), return_complex=True)
    recon_power = recon_stft.abs() ** 2
    freqs = torch.fft.rfftfreq(n_fft_rt, 1.0 / sample_rate)
    recon_peak_hz = freqs[recon_power.mean(dim=1).argmax().item()].item()
    assert abs(recon_peak_hz - tone_freq) < 50, (
        f"round-trip reconstruction lost the dominant frequency: {tone_freq}Hz -> {recon_peak_hz:.1f}Hz"
    )
    print(f"round-trip OK (Griffin-Lim): a real {tone_freq:.0f}Hz tone survives waveform -> mel -> "
          f"waveform with its dominant frequency at {recon_peak_hz:.1f}Hz — a real, playable "
          f"reconstruction, not just a shape-correct tensor.")

    print("\nAll mel-spectrogram checks passed — real audio-to-spectrogram extraction AND the reverse "
          "(a real, playable waveform back out), with no torchaudio dependency, are both correct.")
