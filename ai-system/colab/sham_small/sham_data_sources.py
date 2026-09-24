"""Sham's media data collection: verified sources, no duplicates, exact resume.

Why this exists (problems found in the real runs):
  * mozilla-foundation/common_voice_17_0 is now EMPTY on Hugging Face
    (Mozilla removed the files) — the audio track had nothing to read.
  * sayakpaul/ucf101-subset holds only 2 videos — the video track kept
    re-encoding the same two clips.
  * "skip" was the number of SAVED samples, but a stream also consumes
    examples it drops (empty caption, dead URL, bad file), so every resume
    restarted inside already-used data -> repeats. And one progress counter
    was reused across different sources.

What this module does instead:
  * SOURCES: several verified, openly licensed datasets per modality (checked
    against the Hugging Face dataset viewer, 2026-09). When one is exhausted
    or unavailable the next is used automatically — a failing source never
    stops the run.
  * A per-modality ledger ({kind}_ledger.json), saved next to the checkpoint:
      - cursors: the RAW stream position per source/split, so a resume
        continues exactly after the last example read;
      - content fingerprints of every sample ever kept: exact hash for all
        kinds, plus a perceptual hash for images/video frames (catches the
        same photo re-encoded/resized, and COCO's 5-rows-per-image layout).
    Ledgers found anywhere under /kaggle/input are merged (union of
    fingerprints, furthest cursor), so parallel/duplicate notebooks share
    one memory and never re-collect each other's data.
  * When every source is exhausted it says so plainly and collects nothing,
    rather than silently training on repeats.
"""

from __future__ import annotations

import hashlib
import io
import json
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

# ---------------------------------------------------------------- sources

SOURCES: dict[str, list[dict[str, Any]]] = {
    "audio": [
        # Community mirror of Common Voice 17 (CC0) — Arabic, many speakers.
        {"id": "cv17-ar", "dataset": "fixie-ai/common_voice_17_0", "config": "ar",
         "splits": ["train", "validation", "test"], "audio": "audio", "text": "sentence", "license": "CC0-1.0"},
        {"id": "fleurs-ar", "dataset": "google/fleurs", "config": "ar_eg",
         "splits": ["train", "validation", "test"], "audio": "audio", "text": "transcription", "license": "CC-BY-4.0"},
        # Classical Arabic audiobook speech; audio stored as a raw float list.
        {"id": "clartts", "dataset": "MBZUAI/ClArTTS", "config": None,
         "splits": ["train", "test"], "audio": "audio", "text": "text", "rate_field": "sampling_rate", "license": "CC-BY-4.0"},
        # Only the human-recorded part (the Synthetic config is TTS output).
        {"id": "arvoice-human", "dataset": "MBZUAI/ArVoice", "config": "Human_3",
         "splits": ["train", "test"], "audio": "original_wav", "text": "transcription", "license": "CC-BY-4.0"},
    ],
    "image": [
        {"id": "flickr30k", "dataset": "nlphuji/flickr30k", "config": None, "parquet_config": "TEST",
         "splits": ["test"], "image": "image", "text": "caption", "license": "research (Flickr terms)"},
        {"id": "coco-karpathy", "dataset": "yerevann/coco-karpathy", "config": None,
         "splits": ["train", "restval", "validation", "test"], "image_url": "url", "text": "sentences", "license": "CC-BY-4.0 (COCO)"},
        {"id": "cc3m", "dataset": "pixparse/cc3m-wds", "config": None,
         "splits": ["train", "validation"], "image": "jpg", "text": "txt", "license": "CC3M terms"},
    ],
    "video": [
        # Kinetics clips; only those flagged Creative-Commons are kept.
        {"id": "kinetics-cc", "dataset": "nateraw/kinetics", "config": None,
         "splits": ["train", "validation"], "video": "video", "text": "label", "require_true": "is_cc", "license": "CC-BY-4.0"},
    ],
}

# ---------------------------------------------------------------- hashing


def exact_hash(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()[:20]


def dhash(image, size: int = 8) -> int:
    """64-bit difference hash: robust to resizing, re-encoding, small colour
    changes. Two images with Hamming distance <= 5 are the same picture."""
    g = image.convert("L").resize((size + 1, size))
    px = list(g.getdata())
    bits = 0
    for r in range(size):
        row = px[r * (size + 1):(r + 1) * (size + 1)]
        for c in range(size):
            bits = (bits << 1) | (1 if row[c] > row[c + 1] else 0)
    return bits


NEAR_DUP_BITS = 5


@dataclass
class Ledger:
    kind: str
    name: str = ""  # file prefix; lets stage 2 keep its own cursors apart from the tokenizer tracks
    cursors: dict[str, int] = field(default_factory=dict)        # "source/split" -> raw position
    exhausted: set[str] = field(default_factory=set)             # "source/split"
    exact: set[str] = field(default_factory=set)
    phashes: list[int] = field(default_factory=list)
    _bands: dict[tuple[int, int], list[int]] = field(default_factory=dict, repr=False)

    # --- perceptual index: 8 bands of 8 bits. Two hashes differing in at most
    # 7 bits (> NEAR_DUP_BITS) leave at least one band identical (pigeonhole),
    # so looking up every band never misses a near-duplicate.
    def _index(self, h: int) -> None:
        for b in range(8):
            self._bands.setdefault((b, (h >> (8 * b)) & 0xFF), []).append(h)

    def near_duplicate(self, h: int) -> bool:
        seen: set[int] = set()
        for b in range(8):
            for other in self._bands.get((b, (h >> (8 * b)) & 0xFF), ()):
                if other in seen:
                    continue
                seen.add(other)
                if bin(other ^ h).count("1") <= NEAR_DUP_BITS:
                    return True
        return False

    def add_phash(self, h: int) -> None:
        self.phashes.append(h)
        self._index(h)

    # --- persistence
    def to_json(self) -> dict:
        return {"kind": self.kind, "version": 1, "cursors": self.cursors, "exhausted": sorted(self.exhausted),
                "exact": sorted(self.exact), "phashes": [format(h, "016x") for h in self.phashes]}

    def merge(self, data: dict) -> None:
        for k, v in (data.get("cursors") or {}).items():
            self.cursors[k] = max(self.cursors.get(k, 0), int(v))
        self.exhausted |= set(data.get("exhausted") or [])
        self.exact |= set(data.get("exact") or [])
        known = set(self.phashes)
        for s in data.get("phashes") or []:
            h = int(s, 16)
            if h not in known:
                known.add(h)
                self.add_phash(h)

    def save(self, directory: str | Path) -> Path:
        path = Path(directory) / f"{self.name or self.kind}_ledger.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_json()), encoding="utf-8")
        return path

    @classmethod
    def load(cls, kind: str, search_root: str | Path | None = None, name: str = "") -> "Ledger":
        ledger = cls(kind, name)
        pattern = f"{name or kind}_ledger.json"
        if search_root is None:  # /kaggle/input + datasets fetched by sham_inputs.fetch_dataset
            from sham_inputs import rglob_inputs
            found = sorted(rglob_inputs(pattern))
        else:
            root = Path(search_root)
            found = sorted(root.rglob(pattern)) if root.exists() else []
        for p in found:
            try:
                ledger.merge(json.loads(p.read_text(encoding="utf-8")))
            except Exception as exc:
                print(f"  ⚠ تعذّرت قراءة سجل {p}: {exc}")
        print(f"سجل البيانات ({name or kind}): {len(found)} ملف مدمج — {len(ledger.exact):,} عيّنة سبق جمعها، "
              f"مواضع الاستئناف: {ledger.cursors or 'لا شيء بعد'}")
        return ledger


# ---------------------------------------------------------------- collection


@dataclass
class CollectStats:
    written: int = 0
    duplicates: int = 0
    dropped: int = 0
    per_source: dict[str, int] = field(default_factory=dict)
    all_exhausted: bool = False
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        parts = ", ".join(f"{k}: {v:,}" for k, v in self.per_source.items()) or "—"
        s = f"جُمعت {self.written:,} عيّنة جديدة ({parts}) | مكرر مُستبعَد: {self.duplicates:,} | تالف/فارغ: {self.dropped:,}"
        if self.all_exhausted:
            s += " | ⚠ كل المصادر استُنفدت"
        return s


def _stream(src: dict, split: str, start: int) -> Iterator[dict]:
    from datasets import Audio, load_dataset

    kwargs = {"split": split, "streaming": True}
    try:
        ds = load_dataset(src["dataset"], src["config"], **kwargs) if src.get("config") else load_dataset(src["dataset"], **kwargs)
    except RuntimeError as exc:
        if "scripts are no longer supported" not in str(exc):
            raise
        # Script-based dataset on datasets>=4: read the parquet copy the Hub
        # auto-generates (same rows, same order).
        cfg = src.get("parquet_config") or src.get("config") or "default"
        files = f"hf://datasets/{src['dataset']}@refs%2Fconvert%2Fparquet/{cfg}/{split}/*.parquet"
        ds = load_dataset("parquet", data_files={split: files}, **kwargs)
    # Every Audio column -> raw bytes, decoded here with soundfile: works the
    # same on every datasets version (datasets>=4 would otherwise need
    # torchcodec). Columns that are plain float lists are left untouched.
    for col, feat in (getattr(ds, "features", None) or {}).items():
        if isinstance(feat, Audio):
            ds = ds.cast_column(col, Audio(decode=False))
    if start:
        ds = ds.skip(start)
    return iter(ds)


def _text_of(value) -> str:
    if isinstance(value, list):
        value = value[0] if value else ""
    return str(value if value is not None else "").strip()


def _audio_array(example: dict, src: dict):
    import numpy as np

    a = example.get(src["audio"])
    if a is None:
        return None, None
    if isinstance(a, dict) and "array" in a:
        return np.asarray(a["array"], dtype="float32"), int(a["sampling_rate"])
    if isinstance(a, dict) and (a.get("bytes") or a.get("path")):
        import soundfile as sf
        data = a.get("bytes") or Path(a["path"]).read_bytes()
        arr, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
        target = 16_000
        if sr != target and arr.size:  # one common rate for the tokenizer (mel frames assume it)
            import numpy as np
            if arr.ndim > 1:
                arr = arr.mean(axis=1)
            n = int(round(arr.size * target / sr))
            arr = np.interp(np.linspace(0, arr.size - 1, n), np.arange(arr.size), arr).astype("float32")
            sr = target
        return arr, int(sr)
    if isinstance(a, (list, tuple)) or hasattr(a, "shape"):
        return np.asarray(a, dtype="float32"), int(example.get(src.get("rate_field", ""), 16_000) or 16_000)
    if hasattr(a, "get_all_samples"):  # datasets>=4 torchcodec AudioDecoder
        s = a.get_all_samples()
        return s.data.numpy().mean(axis=0).astype("float32"), int(s.sample_rate)
    return None, None


def _image_of(example: dict, src: dict):
    from PIL import Image

    if src.get("image_url"):
        import requests
        resp = requests.get(example[src["image_url"]], timeout=10)
        resp.raise_for_status()
        return Image.open(io.BytesIO(resp.content))
    img = example.get(src["image"])
    if isinstance(img, dict) and img.get("bytes"):
        return Image.open(io.BytesIO(img["bytes"]))
    return img


def collect(kind: str, output_dir: str | Path, max_samples: int, ledger: Ledger, *,
            image_size: int = 64, num_frames: int = 8, sources: list[dict] | None = None,
            stream_fn=_stream) -> tuple[str, CollectStats]:
    """Collects up to max_samples NEW, non-duplicate samples of `kind` into
    output_dir/manifest.jsonl (same formats the notebooks already read:
    audio {"audio","sentence"}, image {"image","caption"},
    video {"frames":[...],"caption"}). Updates `ledger` in place — save it
    next to the checkpoint afterwards."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "manifest.jsonl"
    stats = CollectStats()
    sources = SOURCES[kind] if sources is None else sources

    with open(manifest_path, "w", encoding="utf-8") as manifest:
        for src in sources:
            for split in src["splits"]:
                if stats.written >= max_samples:
                    break
                key = f"{src['id']}/{split}"
                if key in ledger.exhausted:
                    continue
                pos = ledger.cursors.get(key, 0)
                try:
                    it = stream_fn(src, split, pos)
                except Exception as exc:
                    msg = f"{key}: غير متاح الآن ({exc.__class__.__name__}: {str(exc)[:100]}) — انتقال للمصدر التالي"
                    print("  ⚠ " + msg)
                    stats.errors.append(msg)
                    continue
                finished = True
                failures = 0
                while stats.written < max_samples:
                    try:
                        example = next(it)
                        failures = 0
                    except StopIteration:
                        break
                    except Exception as exc:
                        # A network/shard error kills the iterator. Never treat that
                        # as "finished": reopen at the same position; after repeated
                        # failures skip ONE row (a corrupt row), and give up on this
                        # split for this run only — it is retried next run.
                        failures += 1
                        stats.errors.append(f"{key}@{pos}: {exc.__class__.__name__}: {str(exc)[:80]}")
                        if failures >= 3:
                            pos += 1
                            ledger.cursors[key] = pos
                        if failures >= 6:
                            finished = False
                            print(f"  ⚠ {key}: أخطاء متكررة عند {pos:,} — سيُعاد المحاولة في التشغيل القادم")
                            break
                        try:
                            it = stream_fn(src, split, pos)
                        except Exception:
                            finished = False
                            break
                        continue
                    pos += 1
                    ledger.cursors[key] = pos  # raw position: advances for kept AND dropped examples
                    try:
                        verdict = _write_one(kind, example, src, out, stats.written, manifest, ledger,
                                             image_size=image_size, num_frames=num_frames)
                    except Exception:
                        verdict = "dropped"
                    if verdict == "ok":
                        stats.written += 1
                        stats.per_source[src["id"]] = stats.per_source.get(src["id"], 0) + 1
                    elif verdict == "dup":
                        stats.duplicates += 1
                    else:
                        stats.dropped += 1
                else:
                    finished = False  # stopped because we have enough, not because the split ended
                if finished:
                    ledger.exhausted.add(key)
                    print(f"  ✔ {key}: اكتمل المرور عليه بالكامل ({pos:,} مثال)")

    total_keys = {f"{s['id']}/{sp}" for s in sources for sp in s["splits"]}
    stats.all_exhausted = total_keys <= ledger.exhausted
    print(stats.summary())
    return str(manifest_path), stats


def _write_one(kind, example, src, out: Path, index: int, manifest, ledger: Ledger, *, image_size: int, num_frames: int) -> str:
    need = src.get("require_true")
    if need and not example.get(need):
        return "dropped"
    text = _text_of(example.get(src["text"]))

    if kind == "audio":
        import numpy as np
        import soundfile as sf

        arr, sr = _audio_array(example, src)
        if arr is None or arr.size < sr * 0.5 or not text:
            return "dropped"
        if arr.ndim > 1:
            arr = arr.mean(axis=1)
        pcm = (np.clip(arr, -1, 1) * 32767).astype("<i2").tobytes()
        h = exact_hash(pcm)
        if h in ledger.exact:
            return "dup"
        (out / "audio").mkdir(exist_ok=True)
        rel = f"audio/{index:06d}.wav"
        sf.write(str(out / rel), arr, sr)
        ledger.exact.add(h)
        manifest.write(json.dumps({"audio": rel, "sentence": text, "source": src["id"]}, ensure_ascii=False) + "\n")
        return "ok"

    if kind == "image":
        img = _image_of(example, src)
        if img is None or not text:
            return "dropped"
        img = img.convert("RGB")
        small = img.resize((image_size, image_size))
        h = exact_hash(small.tobytes())
        ph = dhash(img)
        if h in ledger.exact or ledger.near_duplicate(ph):
            return "dup"
        (out / "images").mkdir(exist_ok=True)
        rel = f"images/{index:06d}.jpg"
        small.save(out / rel, format="JPEG")
        ledger.exact.add(h)
        ledger.add_phash(ph)
        manifest.write(json.dumps({"image": rel, "caption": text, "source": src["id"]}, ensure_ascii=False) + "\n")
        return "ok"

    if kind == "video":
        from PIL import Image

        raw = example.get(src["video"])
        if isinstance(raw, dict):
            raw = raw.get("bytes")
        if isinstance(raw, str):
            raw = raw.encode("latin-1")
        if not raw:
            return "dropped"
        h = exact_hash(raw)
        if h in ledger.exact:
            return "dup"
        frame_dir = out / "frames" / f"{index:06d}"
        frame_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(suffix=".mp4") as tmp:
            tmp.write(raw)
            tmp.flush()
            from imageio_ffmpeg import get_ffmpeg_exe
            subprocess.run([get_ffmpeg_exe(), "-y", "-i", tmp.name, "-vf", f"fps=2,scale={image_size}:{image_size}",
                            "-vsync", "vfr", "-frames:v", str(num_frames), str(frame_dir / "f%02d.jpg")],
                           capture_output=True, timeout=60, check=True)
        frames = sorted(frame_dir.glob("f*.jpg"))
        if len(frames) < num_frames:
            return "dropped"
        ph = dhash(Image.open(frames[len(frames) // 2]))
        if ledger.near_duplicate(ph):  # same clip re-uploaded / re-encoded
            return "dup"
        ledger.exact.add(h)
        ledger.add_phash(ph)
        rel = [str(p.relative_to(out)) for p in frames[:num_frames]]
        manifest.write(json.dumps({"frames": rel, "caption": text or None, "source": src["id"]}, ensure_ascii=False) + "\n")
        return "ok"

    raise ValueError(kind)


# ---------------------------------------------------------------- self-test

if __name__ == "__main__":
    from PIL import Image, ImageDraw

    def pic(seed: int, shift: int = 0) -> Image.Image:
        im = Image.new("RGB", (96, 96), (seed * 37 % 255, 90, 160))
        d = ImageDraw.Draw(im)
        d.rectangle([10 + seed * 7 % 40, 20, 50 + seed * 5 % 40, 70], fill=(250, 250, 250))
        d.ellipse([60 - seed % 20, 5 + shift, 90, 40 + shift], fill=(10, 10, 10))
        return im

    rows = {
        # a: 6 rows, row 2 = exact copy of row 0, row 3 = resized copy of row 1, row 4 = no caption
        ("a", "train"): [{"image": pic(1), "caption": ["one"]}, {"image": pic(2), "caption": "two"},
                         {"image": pic(1), "caption": "dup-exact"}, {"image": pic(2).resize((150, 150)), "caption": "dup-resized"},
                         {"image": pic(3), "caption": ""}, {"image": pic(4), "caption": "four"}],
        ("b", "train"): [{"image": pic(5), "caption": "five"}, {"image": pic(6), "caption": "six"}],
    }
    srcs = [{"id": "a", "dataset": "a", "config": None, "splits": ["train"], "image": "image", "text": "caption"},
            {"id": "broken", "dataset": "x", "config": None, "splits": ["train"], "image": "image", "text": "caption"},
            {"id": "b", "dataset": "b", "config": None, "splits": ["train"], "image": "image", "text": "caption"}]

    def fake_stream(src, split, start):
        if src["id"] == "broken":
            raise FileNotFoundError("empty dataset")
        return iter(rows[(src["id"], split)][start:])

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        led = Ledger("image")
        m, st = collect("image", td / "run1", 2, led, sources=srcs, stream_fn=fake_stream)
        assert st.written == 2 and led.cursors["a/train"] == 2, (st, led.cursors)
        led.save(td / "ck1")
        # resume from the saved ledger: must skip the exact + resized duplicates and the empty caption
        led2 = Ledger.load("image", td)
        m, st = collect("image", td / "run2", 10, led2, sources=srcs, stream_fn=fake_stream)
        caps = [json.loads(l)["caption"] for l in open(m, encoding="utf-8")]
        assert caps == ["four", "five", "six"], caps
        assert st.duplicates == 2 and st.dropped == 1 and st.all_exhausted is False, st  # 'broken' never finished
        assert {"a/train", "b/train"} <= led2.exhausted
        # a third run collects nothing new
        m, st = collect("image", td / "run3", 10, led2, sources=srcs, stream_fn=fake_stream)
        assert st.written == 0
        led2.save(td / "ck2")
        # merge keeps the furthest cursor and the union of fingerprints
        other = Ledger("image"); other.cursors["a/train"] = 1; other.exact.add("zz")
        other.save(td / "ck_other")
        merged = Ledger.load("image", td)
        assert merged.cursors["a/train"] >= 6 and "zz" in merged.exact
    print("sham_data_sources self-test: OK")
