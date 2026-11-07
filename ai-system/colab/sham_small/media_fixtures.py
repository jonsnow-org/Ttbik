"""(copy: ai-system/app/media_fixtures.py) Small REAL media bytes for tests of the quality gate (a gradient picture, a sine tone, a structurally valid MP4 shell). numpy + Pillow only."""
from __future__ import annotations

import io
import struct
import wave


def png(kind: str = "gradient", size: int = 64) -> bytes:
    import numpy as np
    from PIL import Image
    if kind == "black":
        arr = np.zeros((size, size, 3), dtype="uint8")
    elif kind == "gray":
        arr = np.full((size, size, 3), 137, dtype="uint8")
    elif kind == "noise":
        arr = np.random.default_rng(0).integers(0, 255, (size, size, 3), dtype="uint8")
    else:  # smooth diagonal gradient with a bright square: has content, is spatially correlated
        y, x = np.mgrid[0:size, 0:size]
        g = ((x + y) * 255 / (2 * size - 2)).astype("uint8")
        arr = np.stack([g, 255 - g, g // 2 + 40], axis=-1)
        arr[size // 4:size // 2, size // 4:size // 2] = 255
    b = io.BytesIO()
    Image.fromarray(arr).save(b, "PNG")
    return b.getvalue()


def wav(kind: str = "tone", seconds: float = 0.6, rate: int = 16000) -> bytes:
    import numpy as np
    n = int(seconds * rate)
    t = np.arange(n) / rate
    x = np.sin(2 * np.pi * 440 * t) * 0.4 if kind == "tone" else np.zeros(n)
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((x * 32767).astype("<i2").tobytes())
    return b.getvalue()


def _box(name: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", 8 + len(payload)) + name + payload


def mp4_shell(payload_bytes: int = 4096) -> bytes:
    """Structurally complete MP4 (ftyp+moov+mdat) with filler. Passes the structure check; not decodable (the decode step is skipped when ffmpeg cannot read it)."""
    return _box(b"ftyp", b"isom\0\0\2\0isomiso2mp41") + _box(b"moov", b"\0" * 128) + _box(b"mdat", b"\x01" * payload_bytes)
