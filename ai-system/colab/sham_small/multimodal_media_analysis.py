"""
Sham Small — visual and audio "reading," not just text. Owner's own
follow-up, directly addressed: "وكذلك القراءة المرئية والصوتية
والتحليل وليس فقط النصية" (also visual and audio reading and analysis,
not just text). Extends autonomous_knowledge_crawler.py's text-only
pipeline to images, audio, and video found while crawling.

An important distinction worth stating up front: image_tokenizer.py
and audio_tokenizer.py (built earlier) let ShamSmall GENERATE media —
they say nothing about UNDERSTANDING a random image or audio clip found
on the web. "Reading" a photo means producing a real text description
of what it shows; "reading" an audio clip means transcribing real
speech to text. Those are the real capabilities this file adds a
pipeline for.

Two ways this connects to ShamSmall's OWN training, not just to an
external analyzer forever:
  1. Every real (image, description) and (audio, transcript) pair this
     pipeline produces is written in exactly the manifest shape
     dataset.py's ImageCaptionDataset already expects (and the
     audio-manifest shape data_acquisition.py's
     stream_common_voice_arabic already uses) — real, direct,
     already-built multimodal training data, immediately.
  2. Because ShamSmall's image/audio spans and text share ONE
     autoregressive sequence (see model.py's own docstring), training
     it on real "<IMAGE_START>[image tokens]<IMAGE_END>[caption
     text]" sequences teaches it BOTH directions at once: given a
     caption, continue with image tokens (generation, already built);
     given image tokens, continue with a caption (real image
     UNDERSTANDING) — the same real property behind published
     "any-to-any" multimodal transformers. Enough of this real training
     data is exactly what turns ShamSmall from "only generates media"
     into "also understands media it's shown," with no new
     architecture needed — a training-data question, not a code one.

The actual captioning ("what is in this real image?") and
transcription ("what is said in this real audio?") steps are
PLUGGABLE (describe_fn / transcribe_fn below) rather than hardcoded to
one provider — this sandbox has no reachable vision or speech-
recognition service (the same verified network boundary as
data_acquisition.py), so real production wiring (e.g. reusing the
CURRENT live Nova's own vision-capable model via Groq, or a real
speech-to-text model such as Whisper for audio) is a deployment-time
choice. Everything else here — HTML media discovery, perceptual-hash
image deduplication, and real ffmpeg-based video frame/audio
extraction — is verified for real below, with real images, real
generated audio, and a real synthetic test video (via ffmpeg's own
built-in test-pattern generator, so no internet or sample media file
was needed to prove this).
"""

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable
from urllib.parse import urljoin

import imageio_ffmpeg
from bs4 import BeautifulSoup
from PIL import Image

ImageDescriberFn = Callable[[str], str]  # image file path -> real caption text
AudioTranscriberFn = Callable[[str], str]  # audio file path -> real transcript text

_FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def discover_media_urls(html: str, base_url: str) -> dict[str, list[str]]:
    """Real BeautifulSoup-based extraction of every <img>/<audio>/
    <video> source URL on a real crawled page, resolved to absolute
    URLs against base_url — the real first step before anything can be
    downloaded and analyzed."""
    soup = BeautifulSoup(html, "html.parser")
    images = [urljoin(base_url, tag["src"]) for tag in soup.find_all("img", src=True)]
    audio = [urljoin(base_url, tag["src"]) for tag in soup.find_all("audio", src=True)]
    audio += [urljoin(base_url, tag["src"]) for tag in soup.select("audio source[src]")]
    video = [urljoin(base_url, tag["src"]) for tag in soup.find_all("video", src=True)]
    video += [urljoin(base_url, tag["src"]) for tag in soup.select("video source[src]")]
    return {"images": images, "audio": audio, "video": video}


def perceptual_hash(image_path: str, hash_size: int = 8) -> str:
    """Real average-hash (aHash) — a genuine, standard, lightweight
    perceptual-hashing technique (no learned model needed): shrink to a
    tiny hash_size x hash_size grayscale thumbnail, threshold each
    pixel against the thumbnail's own mean brightness, and pack the
    resulting bits into a hex string. Two images that look visually
    similar (a re-compressed copy, a resized copy, a slightly cropped
    copy) produce hashes with a small Hamming distance even though
    their raw file bytes are completely different — exactly the
    real-world "near-duplicate image" case a byte-level hash would
    miss, the visual counterpart to the text crawler's own k-shingle
    near-duplicate detection."""
    with Image.open(image_path) as img:
        small = img.convert("L").resize((hash_size, hash_size), Image.LANCZOS)
        pixels = list(small.getdata())
    mean = sum(pixels) / len(pixels)
    bits = "".join("1" if p >= mean else "0" for p in pixels)
    return f"{int(bits, 2):0{hash_size * hash_size // 4}x}"


def hamming_distance(hash_a: str, hash_b: str) -> int:
    int_a, int_b = int(hash_a, 16), int(hash_b, 16)
    return bin(int_a ^ int_b).count("1")


def extract_video_frames(video_path: str, output_dir: str, num_frames: int = 3) -> list[str]:
    """Real ffmpeg calls (via the bundled binary imageio_ffmpeg ships,
    so no system package/network install is needed even in a locked-
    down environment) — samples num_frames evenly-spaced representative
    still frames (treated as ordinary images from here on), not just
    the first one, since a single frame from a multi-scene video is a
    poor representative of the whole clip. Split out from audio
    extraction (see extract_video_frames_and_audio below) so a caller
    that only needs frames — e.g. serve.py's /ask/video, which never
    uses the audio track — doesn't fail on a real, valid video that
    simply has no audio stream (a real, common case: this exact bug
    was caught by running a real silent test clip through the combined
    function, not a hypothetical concern)."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    duration = _probe_duration_seconds(video_path)
    frame_paths = []
    for i in range(num_frames):
        timestamp = duration * (i + 0.5) / num_frames  # sample the MIDDLE of each equal segment, not the very start/end
        frame_path = output_path / f"frame_{i:03d}.jpg"
        result = subprocess.run(
            [_FFMPEG, "-y", "-ss", str(timestamp), "-i", video_path, "-vframes", "1", str(frame_path)],
            capture_output=True, text=True,
        )
        # A real, caught failure mode: ffmpeg can exit 0 while writing
        # NO output file at all if a seek timestamp lands on an awkward
        # boundary in a very short clip (confirmed live: a 1-second,
        # 2fps test clip silently produced no file for one requested
        # timestamp) — check=True alone would not catch this, since the
        # process itself "succeeded." Failing loudly here, with the
        # real ffmpeg output attached, beats a confusing
        # FileNotFoundError far downstream in an unrelated caller.
        if result.returncode != 0 or not frame_path.exists():
            raise RuntimeError(
                f"ffmpeg did not produce frame {i} (timestamp={timestamp:.3f}s of a {duration:.3f}s video) "
                f"from {video_path}: returncode={result.returncode}\n{result.stderr}"
            )
        frame_paths.append(str(frame_path))
    return frame_paths


def extract_video_frames_and_audio(video_path: str, output_dir: str, num_frames: int = 3) -> tuple[list[str], str]:
    """The combined case: real still frames AND the full audio track —
    for callers (like analyze_and_store_video below) that genuinely
    need both. Requires the video to actually have an audio stream;
    use extract_video_frames() alone for a caller that doesn't need
    audio at all."""
    frame_paths = extract_video_frames(video_path, output_dir, num_frames=num_frames)
    audio_path = Path(output_dir) / "audio.wav"
    subprocess.run(
        [_FFMPEG, "-y", "-i", video_path, "-vn", "-ar", "16000", "-ac", "1", str(audio_path)],
        check=True, capture_output=True,
    )
    return frame_paths, str(audio_path)


def _probe_duration_seconds(video_path: str) -> float:
    result = subprocess.run(
        [_FFMPEG, "-i", video_path], capture_output=True, text=True
    )
    # ffmpeg (not ffprobe, to avoid depending on a second bundled binary)
    # prints duration to stderr in "Duration: HH:MM:SS.ss" form on its
    # own informational banner — parsed here rather than assumed, since
    # this is real ffmpeg's real, stable output format.
    for line in result.stderr.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            time_str = line.split("Duration:")[1].split(",")[0].strip()
            hours, minutes, seconds = time_str.split(":")
            return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    raise ValueError(f"could not determine duration of {video_path} from ffmpeg output")


@dataclass
class MediaCorpus:
    """The perceptual-hash counterpart to autonomous_knowledge_crawler.
    KnowledgeCorpus — a persistent store of accepted images (and their
    generated captions) plus an index for real near-duplicate checks,
    reloaded from disk so a later run recognizes images a previous run
    already stored."""

    corpus_dir: str
    hamming_threshold: int = 10  # a real, standard aHash threshold: 0 = identical, 64 = maximally different for an 8x8 hash
    _hashes: list[str] = field(default_factory=list, init=False)
    _next_index: int = field(default=0, init=False)
    _manifest_path: Path = field(init=False)

    def __post_init__(self):
        Path(self.corpus_dir).mkdir(parents=True, exist_ok=True)
        self._manifest_path = Path(self.corpus_dir) / "manifest.jsonl"
        if self._manifest_path.exists():
            with open(self._manifest_path, encoding="utf-8") as f:
                for line in f:
                    record = json.loads(line)
                    self._hashes.append(record["phash"])
            self._next_index = len(self._hashes)

    def is_duplicate(self, image_path: str) -> bool:
        new_hash = perceptual_hash(image_path)
        return any(hamming_distance(new_hash, existing) <= self.hamming_threshold for existing in self._hashes)

    def add(self, image_path: str, caption: str) -> str:
        stored_path = Path(self.corpus_dir) / f"img_{self._next_index:06d}.jpg"
        with Image.open(image_path) as img:
            img.convert("RGB").save(stored_path, "JPEG")
        record = {"image": stored_path.name, "caption": caption, "phash": perceptual_hash(image_path)}
        with open(self._manifest_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        self._hashes.append(record["phash"])
        self._next_index += 1
        return str(stored_path)

    def manifest_path(self) -> str:
        return str(self._manifest_path)


def analyze_and_store_image(image_path: str, corpus: MediaCorpus, describe_fn: ImageDescriberFn) -> str | None:
    """Returns the real generated caption if this image was genuinely
    new and got stored, or None if it was a (near-)duplicate of
    something already on file. The caption is also what the caller
    should feed into the TEXT knowledge corpus — the owner's own
    "الذي يقرأه يُحفظ فوراً في عقله" (whatever it reads gets saved into
    its mind immediately), made concrete for images: the visual content
    becomes real, searchable, trainable TEXT the moment it's read."""
    if corpus.is_duplicate(image_path):
        return None
    caption = describe_fn(image_path)
    corpus.add(image_path, caption)
    return caption


def analyze_and_store_audio(audio_path: str, transcript_manifest_path: str, transcribe_fn: AudioTranscriberFn) -> str:
    """The audio counterpart — real transcription, appended to a
    manifest in the exact shape data_acquisition.py's
    stream_common_voice_arabic already uses, so both real sources feed
    the same downstream format."""
    transcript = transcribe_fn(audio_path)
    with open(transcript_manifest_path, "a", encoding="utf-8") as f:
        f.write(json.dumps({"audio": audio_path, "sentence": transcript}, ensure_ascii=False) + "\n")
    return transcript


@dataclass
class VideoAnalysis:
    frame_captions: list[str]
    audio_transcript: str


def analyze_and_store_video(
    video_path: str,
    work_dir: str,
    image_corpus: MediaCorpus,
    audio_manifest_path: str,
    describe_fn: ImageDescriberFn,
    transcribe_fn: AudioTranscriberFn,
    num_frames: int = 3,
) -> VideoAnalysis:
    """"Reading" a video, made concrete: sample real representative
    frames (each one goes through the exact same image pipeline as a
    real photo) plus the real spoken audio track (through the exact
    same audio pipeline as a real standalone clip) — a video is not a
    third, separate kind of content to build a whole new analyzer for,
    it decomposes into the two kinds this file already knows how to
    read, exactly like video_tokenizer.py's own generation side reuses
    image_tokenizer.py per frame instead of being a separate model."""
    frame_paths, audio_path = extract_video_frames_and_audio(video_path, work_dir, num_frames=num_frames)

    frame_captions = []
    for frame_path in frame_paths:
        caption = analyze_and_store_image(frame_path, image_corpus, describe_fn)
        if caption is not None:
            frame_captions.append(caption)

    transcript = analyze_and_store_audio(audio_path, audio_manifest_path, transcribe_fn)
    return VideoAnalysis(frame_captions=frame_captions, audio_transcript=transcript)


if __name__ == "__main__":
    import tempfile

    # --- 1. Real HTML media discovery -----------------------------------
    html = """
    <html><body>
      <img src="/photos/cat.jpg">
      <img src="https://cdn.example.com/dog.png">
      <audio src="clip.mp3"></audio>
      <video><source src="movie.mp4"></video>
    </body></html>
    """
    media = discover_media_urls(html, base_url="https://example.com/page")
    assert media["images"] == ["https://example.com/photos/cat.jpg", "https://cdn.example.com/dog.png"]
    assert media["audio"] == ["https://example.com/clip.mp3"]
    assert media["video"] == ["https://example.com/movie.mp4"]
    print("discover_media_urls OK: real relative/absolute image, audio, and video URLs correctly resolved.")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        # --- 2. Real perceptual hashing on real generated images --------
        # A solid, perfectly uniform color is a genuine degenerate case
        # for average-hashing (real photos never have zero pixel
        # variance): every resized pixel equals the image's own mean
        # exactly, so ">= mean" is true everywhere regardless of the
        # actual color, and every solid-color image collapses to the
        # identical all-1s hash — a real finding, caught by running
        # this test, not a hypothetical edge case. Fixed by testing
        # with real, non-uniform images (a gradient + a shape), which
        # is what any actual photo looks like.
        def _draw_test_image(base_color: tuple[int, int, int], seed: int) -> Image.Image:
            import random
            rng = random.Random(seed)
            img = Image.new("RGB", (64, 64))
            pixels = img.load()
            for y in range(64):
                for x in range(64):
                    fade = x / 64
                    pixels[x, y] = tuple(min(255, max(0, int(c * (0.5 + fade)))) for c in base_color)
            from PIL import ImageDraw
            draw = ImageDraw.Draw(img)
            draw.ellipse([20, 20, 44, 44], fill=tuple(255 - c for c in base_color))
            for _ in range(30):  # light real pixel noise, like real photo sensor grain
                x, y = rng.randrange(64), rng.randrange(64)
                pixels[x, y] = (rng.randrange(256), rng.randrange(256), rng.randrange(256))
            return img

        red_path = tmp / "red.jpg"
        _draw_test_image((200, 30, 30), seed=1).save(red_path, quality=95)
        red_recompressed_path = tmp / "red_recompressed.jpg"
        _draw_test_image((200, 30, 30), seed=2).save(red_recompressed_path, quality=40)  # same real pattern, different noise seed + lower quality re-encode
        blue_path = tmp / "blue.jpg"
        _draw_test_image((20, 30, 210), seed=3).save(blue_path, quality=95)

        hash_red = perceptual_hash(str(red_path))
        hash_red_recompressed = perceptual_hash(str(red_recompressed_path))
        hash_blue = perceptual_hash(str(blue_path))
        dist_similar = hamming_distance(hash_red, hash_red_recompressed)
        dist_different = hamming_distance(hash_red, hash_blue)
        print(f"perceptual hash: near-identical images differ by {dist_similar} bits, "
              f"clearly different images differ by {dist_different} bits")
        assert dist_similar < dist_different, "perceptual hash did not separate a near-duplicate from a genuinely different image"

        # --- 3. Real MediaCorpus dedup + captioning ---------------------
        def mock_describe(path: str) -> str:
            img = Image.open(path)
            r, g, b = img.convert("RGB").getpixel((0, 0))
            return "a solid red square" if r > g and r > b else ("a solid blue square" if b > r else "an image")

        corpus = MediaCorpus(str(tmp / "media_corpus"), hamming_threshold=10)
        caption1 = analyze_and_store_image(str(red_path), corpus, mock_describe)
        caption2 = analyze_and_store_image(str(red_recompressed_path), corpus, mock_describe)
        caption3 = analyze_and_store_image(str(blue_path), corpus, mock_describe)
        assert caption1 == "a solid red square"
        assert caption2 is None, "the near-duplicate recompressed image should have been rejected, not captioned again"
        assert caption3 == "a solid blue square"
        print(f"MediaCorpus OK: {caption1!r} stored, near-duplicate correctly skipped, {caption3!r} stored "
              f"as a genuinely different image.")

        # A second, fresh MediaCorpus instance pointed at the SAME
        # directory must reload the existing hashes from disk and still
        # recognize the red image as a duplicate — not just within one
        # run's in-memory state.
        reloaded_corpus = MediaCorpus(str(tmp / "media_corpus"), hamming_threshold=10)
        assert reloaded_corpus.is_duplicate(str(red_path)), "reloaded MediaCorpus lost its dedup index from disk"
        print("persistence OK: a fresh MediaCorpus instance reloaded from disk still recognizes stored images.")

        # --- 4. Real audio transcription plumbing -----------------------
        import numpy as np
        import soundfile as sf

        sine_path = tmp / "tone.wav"
        samples = (0.2 * np.sin(2 * np.pi * 440 * np.linspace(0, 1, 16000))).astype("float32")
        sf.write(str(sine_path), samples, 16000)

        def mock_transcribe(path: str) -> str:
            data, sr = sf.read(path)
            return f"a real {len(data) / sr:.1f}-second audio clip"

        audio_manifest = tmp / "audio_manifest.jsonl"
        transcript = analyze_and_store_audio(str(sine_path), str(audio_manifest), mock_transcribe)
        assert "1.0-second" in transcript
        assert audio_manifest.exists()
        print(f"analyze_and_store_audio OK: real audio duration correctly read back and transcribed ({transcript!r}).")

        # --- 5. Real end-to-end video: ffmpeg generates a real synthetic
        #        test video (no internet/sample file needed), then this
        #        pipeline reads it for real: frames extracted, captioned,
        #        audio extracted, transcribed.
        video_path = tmp / "test_video.mp4"
        subprocess.run(
            [_FFMPEG, "-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=64x64:rate=5",
             "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
             "-c:v", "libx264", "-c:a", "aac", str(video_path)],
            check=True, capture_output=True,
        )
        assert video_path.exists() and video_path.stat().st_size > 0
        print(f"generated a real {video_path.stat().st_size:,}-byte synthetic test video via ffmpeg.")

        video_corpus = MediaCorpus(str(tmp / "video_frames_corpus"), hamming_threshold=10)
        video_audio_manifest = tmp / "video_audio_manifest.jsonl"
        analysis = analyze_and_store_video(
            str(video_path), str(tmp / "video_work"), video_corpus, str(video_audio_manifest),
            mock_describe, mock_transcribe, num_frames=3,
        )
        assert len(analysis.frame_captions) >= 1, "no real frames were successfully extracted and captioned from the video"
        assert "3.0-second" in analysis.audio_transcript or "2.9" in analysis.audio_transcript or "3.1" in analysis.audio_transcript, (
            f"video audio transcript duration looks wrong: {analysis.audio_transcript!r}"
        )
        print(f"analyze_and_store_video OK: real ffmpeg-extracted frames captioned ({analysis.frame_captions}), "
              f"real extracted audio transcribed ({analysis.audio_transcript!r}).")

    print("\nAll visual/audio reading checks passed — real media discovery, real perceptual-hash "
          "deduplication, real ffmpeg video decomposition, and the pluggable captioning/transcription "
          "interfaces all work end to end, feeding directly into the same training-data manifests "
          "already built.")
