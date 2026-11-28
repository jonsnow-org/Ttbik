"""Model configuration and the unified vocabulary layout (text, specials, image / audio / motion codes in ONE id space)."""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass

SPECIAL_COUNT = 64
SPECIAL_NAMES: tuple[str, ...] = (
    "PAD", "BOS", "EOS", "MASK", "SYSTEM", "USER", "ASSISTANT",
    "THINK_BEGIN", "THINK_END",
    "CMD_BEGIN", "CMD_END",           # one terminal command line (the T-LDM terminal loop)
    "TOOL_BEGIN", "TOOL_END",         # one allowlisted tool call
    "RESULT_BEGIN", "RESULT_END", "OK", "FAIL",
    "IMG_BEGIN", "IMG_END", "AUD_BEGIN", "AUD_END", "VID_BEGIN", "VID_END", "MOT_BEGIN", "MOT_END",
    "ROW_END", "FRAME_END", "SCALE_BEGIN", "SCALE_END",   # media geometry: a row, a video frame, one scale of a coarse-to-fine image
)
SPECIAL_NAMES = SPECIAL_NAMES + tuple(f"RESERVED_{i}" for i in range(SPECIAL_COUNT - len(SPECIAL_NAMES)))


@dataclass(frozen=True)
class ModelConfig:
    width: int = 768
    heads: int = 12
    kv_heads: int = 4
    unique_blocks: int = 4
    cycles: int = 3
    experts: int = 8
    top_k: int = 2
    expert_hidden: int = 1536
    shared_hidden: int = 768     # one always-on expert beside the routed ones (stability + shared knowledge); 0 turns it off
    text_vocab: int = 8192       # ids 0..255 ARE the raw bytes (byte fallback: any text, code, or file is representable); 256.. are learned merges
    image_codes: int = 4096
    audio_codes: int = 1024      # per residual codebook
    motion_codes: int = 512
    tool_codes: int = 256        # one token per tool: a call is [TOOL_BEGIN, <tool id>, arguments..., TOOL_END] (shorter and exact, no spelled names)
    max_seq: int = 131072        # positions the model can address (128K tokens): a capacity, reached by a TRAINING curriculum (4K -> 32K -> 128K, notebooks N04/N23), not by the architecture alone
    train_seq: int = 4096        # the length the base is trained at first; beyond it `rope_factor` > 1 stretches the sequence axis (NTK-aware) before the long-context fine-tune
    rope_theta: float = 500000.0
    rope_factor: float = 1.0     # sequence-axis stretch for context extension (1.0 = none); the media axes are never stretched
    latents: int = 16
    max_grid: int = 1024         # rows / columns addressable by the 2-D position axes (any image size up to max_grid x max_grid tokens)
    max_time: int = 16384        # time steps addressable by the time axis (video frames / audio frames per window)
    # --- codec contract: the media codecs (trained first, notebooks N10-N12) MUST produce exactly this; the language model learns codes, so these never change after training
    image_patch: int = 16        # pixels per code side (a 512x512 image = 32x32 codes)
    audio_sample_rate: int = 24000
    audio_frame_rate: int = 25   # code frames per second (960 samples per frame)
    audio_books: int = 4         # residual codebooks per frame (see media.delay_codes)
    video_stride: int = 4        # video frames summarised by one temporal step of motion codes

    def __post_init__(self) -> None:
        if self.width % self.heads or self.heads % self.kv_heads:
            raise ValueError("width must divide by heads, and heads by kv_heads")
        if (self.width // self.heads) % 2:
            raise ValueError("head dimension must be even (RoPE)")
        if not 1 <= self.top_k <= self.experts:
            raise ValueError("top_k must be between 1 and experts")
        if (self.width // self.heads) // 2 < 8:
            raise ValueError("head dimension must be at least 16 (four rotary axes)")
        if self.text_vocab < 256 + 16:
            raise ValueError("text_vocab must hold the 256 byte tokens plus merges")
        if self.shared_hidden < 0:
            raise ValueError("shared_hidden must be >= 0")
        if min(self.image_patch, self.audio_sample_rate, self.audio_frame_rate, self.audio_books, self.video_stride) < 1 or self.audio_sample_rate % self.audio_frame_rate:
            raise ValueError("codec contract values must be positive and the sample rate must divide by the frame rate")
        if self.rope_factor < 1.0 or not 1 <= self.train_seq <= self.max_seq:
            raise ValueError("rope_factor must be >= 1 and train_seq must be within max_seq")
        if min(self.unique_blocks, self.cycles, self.latents, self.max_seq, self.max_grid, self.max_time) < 1:
            raise ValueError("unique_blocks, cycles, latents and max_seq must be positive")

    # ---- unified vocabulary: [text | specials | image | audio | motion]
    @property
    def special_base(self) -> int:
        return self.text_vocab

    @property
    def image_base(self) -> int:
        return self.text_vocab + SPECIAL_COUNT

    @property
    def audio_base(self) -> int:
        return self.image_base + self.image_codes

    @property
    def motion_base(self) -> int:
        return self.audio_base + self.audio_codes

    @property
    def tool_base(self) -> int:
        return self.motion_base + self.motion_codes

    @property
    def vocab_size(self) -> int:
        return self.tool_base + self.tool_codes

    def special_id(self, name: str) -> int:
        return self.special_base + SPECIAL_NAMES.index(name)

    def modality_of(self, token_id: int) -> str:
        if token_id < 0 or token_id >= self.vocab_size:
            raise ValueError("token id outside the vocabulary")
        if token_id < self.text_vocab:
            return "text"
        if token_id < self.image_base:
            return "special"
        if token_id < self.audio_base:
            return "image"
        if token_id < self.motion_base:
            return "audio"
        if token_id < self.tool_base:
            return "motion"
        return "tool"

    def text_and_end_ids(self) -> list[int]:
        """Ids a text/command writer may produce: text tokens plus the closing specials (never MASK, never modality codes)."""
        return list(range(self.text_vocab)) + [self.special_id(n) for n in ("EOS", "CMD_END", "TOOL_END", "RESULT_END", "THINK_END")]

    def rope_split(self) -> tuple[int, int, int, int]:
        """Rotary pairs given to the four position axes: (sequence order, row, column, time). They add up to head_dim / 2."""
        pairs = (self.width // self.heads) // 2
        row = col = max(1, pairs // 6)
        time = max(1, pairs // 4)
        return pairs - row - col - time, row, col, time

    @property
    def audio_samples_per_frame(self) -> int:
        return self.audio_sample_rate // self.audio_frame_rate

    def to_dict(self) -> dict:
        return asdict(self)


def base_config() -> ModelConfig:
    return ModelConfig()


def small_config() -> ModelConfig:
    """The same architecture and the same codec contract at about a quarter of the size: the first thing every training notebook runs end to end
    (CPU-feasible), before the full `base` is trained as compute allows."""
    return ModelConfig(width=384, heads=6, kv_heads=2, unique_blocks=4, cycles=3, experts=8, top_k=2, expert_hidden=768, shared_hidden=384)


def tiny_config() -> ModelConfig:
    """Plumbing and tests only."""
    return ModelConfig(width=64, heads=4, kv_heads=2, unique_blocks=2, cycles=2, experts=4, top_k=2, expert_hidden=96, shared_hidden=48,
                       text_vocab=288, image_codes=16, audio_codes=16, motion_codes=16, tool_codes=192, max_seq=128, train_seq=128, latents=4, max_grid=64, max_time=64)


def config_hash(cfg: ModelConfig) -> str:
    """A short fingerprint of every architecture and codec-contract value. Every training notebook checks it against the frozen value, so a changed
    configuration cannot be trained by accident (and a checkpoint trained under another hash is not resumed)."""
    return hashlib.sha256(json.dumps(cfg.to_dict(), sort_keys=True).encode()).hexdigest()[:16]


# The architecture is FROZEN for training (2026-11-23). Changing a value changes the hash: update these constants only on purpose, and expect to retrain.
FROZEN_HASH = {"base": "54e320828a703cc5", "small": "69f1dcf2ddcbc45f"}   # re-frozen 2026-11-28: 128K positions + rope_factor (nothing had been trained yet, so no retraining cost)
