"""Model configuration and the unified vocabulary layout (text, specials, image / audio / motion codes in ONE id space)."""
from __future__ import annotations

from dataclasses import asdict, dataclass

SPECIAL_COUNT = 64
SPECIAL_NAMES: tuple[str, ...] = (
    "PAD", "BOS", "EOS", "MASK", "SYSTEM", "USER", "ASSISTANT",
    "THINK_BEGIN", "THINK_END",
    "CMD_BEGIN", "CMD_END",           # one terminal command line (the T-LDM terminal loop)
    "TOOL_BEGIN", "TOOL_END",         # one allowlisted tool call
    "RESULT_BEGIN", "RESULT_END", "OK", "FAIL",
    "IMG_BEGIN", "IMG_END", "AUD_BEGIN", "AUD_END", "VID_BEGIN", "VID_END", "MOT_BEGIN", "MOT_END",
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
    text_vocab: int = 8192
    image_codes: int = 1024
    audio_codes: int = 1024
    motion_codes: int = 512
    max_seq: int = 1024
    rope_theta: float = 10000.0
    latents: int = 16

    def __post_init__(self) -> None:
        if self.width % self.heads or self.heads % self.kv_heads:
            raise ValueError("width must divide by heads, and heads by kv_heads")
        if (self.width // self.heads) % 2:
            raise ValueError("head dimension must be even (RoPE)")
        if not 1 <= self.top_k <= self.experts:
            raise ValueError("top_k must be between 1 and experts")
        if min(self.unique_blocks, self.cycles, self.latents, self.max_seq) < 1:
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
    def vocab_size(self) -> int:
        return self.motion_base + self.motion_codes

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
        return "motion"

    def text_and_end_ids(self) -> list[int]:
        """Ids a text/command writer may produce: text tokens plus the closing specials (never MASK, never modality codes)."""
        return list(range(self.text_vocab)) + [self.special_id(n) for n in ("EOS", "CMD_END", "TOOL_END", "RESULT_END", "THINK_END")]

    def to_dict(self) -> dict:
        return asdict(self)


def base_config() -> ModelConfig:
    return ModelConfig()


def tiny_config() -> ModelConfig:
    """Plumbing and tests only."""
    return ModelConfig(width=64, heads=4, kv_heads=2, unique_blocks=2, cycles=2, experts=4, top_k=2, expert_hidden=96,
                       text_vocab=256, image_codes=16, audio_codes=16, motion_codes=16, max_seq=128, latents=4)
