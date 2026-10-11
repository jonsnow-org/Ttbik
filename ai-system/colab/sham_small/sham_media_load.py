"""
Accept anything (owner, 2026-10-11): any image, any sound, any video file, whatever its format, size, channels or sample rate, becomes the
tensors the tokenizers expect — and a file that cannot be read is skipped, never fatal.

  load_image_any(src, size)            path | bytes -> (3, size, size) float in [-1, 1]   (RGBA/palette/gray/CMYK/16-bit/animated, EXIF turned,
                                       any aspect ratio: centre-cropped to a square, not squashed)
  load_audio_any(src, target_sr=16000) path | bytes -> mono float32 at 16 kHz            (wav/flac/ogg through soundfile, everything else —
                                       mp3/m4a/opus/webm/mp4 sound — through PyAV; stereo mixed down; any sample rate resampled)
  resample(wave, sr_from, sr_to)       box low-pass + linear interpolation (no torchaudio dependency)
  video_frames_any(path, n, size)      n frames spread evenly over the clip, (n, 3, size, size)

Why the resampling matters (found 2026-10-11): the mel hop is 160 samples = 10 ms ONLY at 16 kHz. A 48 kHz clip fed with its own rate gave 256
frames = 0.85 s instead of 2.56 s, so every clip not recorded at 16 kHz was cut in the wrong place and its time axis was wrong.
Offline self-test: python sham_media_load.py
"""
from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import torch

TARGET_SR = 16000


def _bytes(src) -> bytes:
    return bytes(src) if isinstance(src, (bytes, bytearray)) else Path(src).read_bytes()


def load_image_any(src, size: int) -> torch.Tensor:
    from PIL import Image, ImageOps
    im = Image.open(io.BytesIO(_bytes(src)))
    try:
        im.seek(0)                                    # animated formats: the first frame
    except Exception:
        pass
    im = ImageOps.exif_transpose(im)
    if im.mode in ("I;16", "I", "F"):                 # 16-bit / float grayscale: rescale to 8 bit instead of clipping
        arr = np.asarray(im, dtype="float32")
        lo, hi = float(arr.min()), float(arr.max())
        im = Image.fromarray(((arr - lo) / max(hi - lo, 1e-6) * 255).astype("uint8"))
    if im.mode in ("RGBA", "LA", "P"):                # transparency onto white, not black
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im)
    im = im.convert("RGB")
    w, h = im.size                                    # centre crop to a square (keeps proportions), then resize
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((size, size), Image.BICUBIC)
    arr = torch.from_numpy(np.asarray(im, dtype="uint8").copy()).float().permute(2, 0, 1)
    return arr / 127.5 - 1.0


def resample(wave: np.ndarray, sr_from: int, sr_to: int = TARGET_SR) -> np.ndarray:
    if sr_from == sr_to or wave.size == 0:
        return wave.astype("float32")
    wave = wave.astype("float32")
    if sr_from > sr_to:                               # low-pass (box of the decimation factor) first, so high frequencies do not fold back
        k = max(1, int(round(sr_from / sr_to)))
        if k > 1:
            kernel = np.ones(k, dtype="float32") / k
            wave = np.convolve(wave, kernel, mode="same")
    n = max(1, int(round(wave.size * sr_to / sr_from)))
    return np.interp(np.linspace(0, wave.size - 1, n), np.arange(wave.size), wave).astype("float32")


def load_audio_any(src, target_sr: int = TARGET_SR) -> np.ndarray | None:
    data = _bytes(src)
    wave, sr = None, None
    try:
        import soundfile as sf
        w, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
        wave = w.mean(axis=1) if w.ndim > 1 else w
    except Exception:
        wave = None
    if wave is None:                                  # mp3 / m4a / opus / webm / the sound of a video: PyAV decodes anything ffmpeg does
        try:
            import av
            with av.open(io.BytesIO(data)) as c:
                if not c.streams.audio:
                    return None
                res = av.AudioResampler(format="flt", layout="mono", rate=target_sr)
                parts = []
                for frame in c.decode(audio=0):
                    for f in res.resample(frame):
                        parts.append(f.to_ndarray().reshape(-1))
                for f in res.resample(None):
                    parts.append(f.to_ndarray().reshape(-1))
            if not parts:
                return None
            return np.concatenate(parts).astype("float32")
        except Exception:
            return None
    wave = np.nan_to_num(wave)
    return resample(wave, int(sr), target_sr)


def video_frames_any(path, n: int, size: int) -> torch.Tensor | None:
    try:
        import av
        with av.open(str(path)) as c:
            frames = [f.to_image() for f in c.decode(video=0)]
        if not frames:
            return None
        idx = [round(i * (len(frames) - 1) / max(n - 1, 1)) for i in range(n)]
        out = []
        for i in idx:
            buf = io.BytesIO()
            frames[i].save(buf, format="PNG")
            out.append(load_image_any(buf.getvalue(), size))
        return torch.stack(out)
    except Exception:
        return None


if __name__ == "__main__":
    import math
    import tempfile

    from PIL import Image

    # images: odd modes, odd shapes, a broken file
    with tempfile.TemporaryDirectory() as d:
        for name, im in (("rgba.png", Image.new("RGBA", (50, 30), (255, 0, 0, 0))), ("gray.png", Image.new("L", (40, 80), 128)),
                         ("pal.gif", Image.new("P", (20, 20))), ("big.jpg", Image.new("RGB", (900, 300), (10, 200, 30))),
                         ("cmyk.jpg", Image.new("CMYK", (30, 30), (0, 255, 255, 0)))):
            im.save(Path(d) / name)
        for name in ("rgba.png", "gray.png", "pal.gif", "big.jpg", "cmyk.jpg"):
            t = load_image_any(Path(d) / name, 32)
            assert t.shape == (3, 32, 32) and float(t.min()) >= -1 and float(t.max()) <= 1, name
        assert float(load_image_any(Path(d) / "rgba.png", 8).mean()) > 0.9, "transparent pixels must become white"
        Path(d, "broken.png").write_bytes(b"not an image")
        try:
            load_image_any(Path(d) / "broken.png", 32)
            raise SystemExit("a broken image must raise (callers skip it)")
        except SystemExit:
            raise
        except Exception:
            pass

    # audio: the same 3 s tone at 8 k / 16 k / 48 k and as stereo gives the same duration at 16 kHz; a broken file gives None
    import soundfile as sf
    with tempfile.TemporaryDirectory() as d:
        durations = {}
        for sr in (8000, 16000, 22050, 48000):
            t = np.arange(sr * 3) / sr
            tone = (0.3 * np.sin(2 * math.pi * 300 * t)).astype("float32")
            p = Path(d) / f"t{sr}.wav"
            sf.write(str(p), tone, sr)
            durations[sr] = load_audio_any(p).size / TARGET_SR
        assert all(abs(v - 3.0) < 0.01 for v in durations.values()), durations
        st = np.stack([tone, tone], axis=1)
        sf.write(str(Path(d) / "stereo.wav"), st, 48000)
        assert abs(load_audio_any(Path(d) / "stereo.wav").size / TARGET_SR - 3.0) < 0.01
        Path(d, "bad.mp3").write_bytes(b"\x00" * 100)
        assert load_audio_any(Path(d) / "bad.mp3") is None
        # a 48 kHz clip now yields the same mel segments as the same sound at 16 kHz
        from mel_spectrogram import waveform_to_mel_segments
        w48 = torch.from_numpy(load_audio_any(Path(d) / "t48000.wav"))
        w16 = torch.from_numpy(load_audio_any(Path(d) / "t16000.wav"))
        assert waveform_to_mel_segments(w48, 16000, 80, 256).shape == waveform_to_mel_segments(w16, 16000, 80, 256).shape
    print("sham_media_load self-test OK |", {k: round(v, 2) for k, v in durations.items()})
