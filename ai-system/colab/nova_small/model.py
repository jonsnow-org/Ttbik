"""
Nova Small — a genuinely from-scratch, fully-owned decoder-only
transformer, ~500M parameters. Owner spec, 2026-09-14 ("نموذج صغير
خاص بنا من الصفر، كل شيء ملكي... قابل مع التدريب والتطوير للوصول
لاكثر من 7B"): unlike the current Nova (a LoRA fine-tune of Qwen2.5-VL,
an open base with its own license terms), this architecture and its
weights, once trained, belong to the owner outright — nothing here is
copied from any base model's weights or checkpoint.

Uses the same three architectural components essentially every strong
open LLM released since 2023 (Llama, Mistral, Qwen included) converged
on independently, because they measurably outperform the
2017-Transformer originals at the same parameter count — picking them
is not an unverified experiment, it is the current, well-established
standard:
  - RMSNorm instead of LayerNorm (Zhang & Sennrich, 2019) — no mean
    subtraction, fewer parameters, and empirically as stable.
  - RoPE, Rotary Position Embeddings (Su et al., 2021) — rotates
    query/key vectors by a position-dependent angle instead of adding a
    learned/sinusoidal position vector; generalizes to sequence lengths
    beyond what was seen in training noticeably better than either
    older scheme.
  - SwiGLU MLP (Shazeer, 2020) — a gated linear unit with the SiLU
    activation instead of a plain 2-layer ReLU/GELU MLP; consistently
    measured as a real quality improvement at equal parameter budget
    across the LLM literature, at the cost of a third weight matrix
    (gate/up/down instead of just up/down).
  - Grouped-Query Attention, GQA (Ainslie et al., 2023) — several query
    heads share one key/value head instead of every head having its
    own K/V projection; cuts the K/V projection size and the memory
    each generated token needs to cache, with negligible quality loss
    at this ratio (2 query heads per KV head here).

Sizing (see count_parameters() below, and
nova_small/verify_architecture.py for an independent, non-torch numpy
cross-check of the same math before this was ever run against real
torch/GPU): d_model=1280, n_layers=26, n_heads=20, n_kv_heads=10,
mlp_hidden=3328, tied input/output embeddings.

Deliberately NOT wired to any base model's weights, tokenizer files, or
config — a fresh nn.Module tree with randomly-initialized weights.
Training this from scratch (not fine-tuning) is what makes the
resulting weights genuinely the owner's own, unlike a LoRA adapter on
top of someone else's base.

Owner spec, 2026-09-14 ("نبني نماذج مصغرة وندمجها في عقل نموذجنا"):
this SAME transformer is also the image/video/audio generator, not a
separate network wearing a different name — see
nova_small/image_tokenizer.py's own docstring for the full reasoning
(the real "VQ-VAE + autoregressive transformer" split used by DALL-E
2021/VQGAN and later multimodal-token systems). The mechanism for that
is entirely in the VOCABULARY: image_tokenizer.py turns a real image
into a short sequence of discrete "visual word" ids from its own
8192-entry codebook, and those ids get a fixed OFFSET added
(TEXT_VOCAB_SIZE below) so they occupy their own reserved range in this
model's single shared vocabulary, never colliding with a real text
token id. This model then just does next-token prediction over that
combined vocabulary exactly as it already does for pure text — writing
an <IMAGE_START> special token, then a real sequence of image-token
ids, then <IMAGE_END>, is not a different code path from writing a
sentence, it is the exact same autoregressive mechanism, which is the
whole point: the actual creative/generative intelligence for every
modality lives here, once, not once per modality.

Vocabulary layout (total 42,256 entries; see the constants below):
  [0, TEXT_VOCAB_SIZE)                                              -> real text tokens
  [TEXT_VOCAB_SIZE, TEXT_VOCAB_SIZE+IMAGE_VOCAB_SIZE)                -> image_tokenizer.py's codebook ids, offset
  [TEXT_VOCAB_SIZE+IMAGE_VOCAB_SIZE, ...+AUDIO_VOCAB_SIZE)           -> audio_tokenizer.py's codebook ids, offset
  [..., + NUM_SPECIAL_TOKENS)                                        -> control tokens (see SpecialTokens below)
Video has no vocabulary range of its own: per owner spec, it reuses
the image codebook per-frame (a video is just a sequence of
<IMAGE_START>...<IMAGE_END> blocks wrapped in one outer
<VIDEO_START>...<VIDEO_END>, exactly what video_tokenizer.py builds) —
see that file's own docstring.

Expanding the vocabulary (32000 text-only -> 40208 with images ->
42256 with audio) is the "قليلاً" (slight) size increase the owner
explicitly approved each step, in service of correctness: 514.2M
parameters total now, up from 501.1M text-only — see this file's own
__main__ block, verify_architecture.py, and
verify_multimodal_integration.py for the re-verified counts and a real
end-to-end proof across every modality.
"""

from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F

# Owner spec, 2026-09-14: the shared vocabulary contract between this
# model and image_tokenizer.py (and, later, audio_tokenizer.py) — see
# the module docstring above for why this lives here as the single
# source of truth rather than each file guessing compatible offsets
# independently, which is exactly the kind of mismatch that would
# silently corrupt every generated image without ever raising an error.
TEXT_VOCAB_SIZE = 32000
IMAGE_VOCAB_SIZE = 8192  # must equal image_tokenizer.ImageTokenizerConfig.num_codes
AUDIO_VOCAB_SIZE = 2048  # must equal audio_tokenizer.AudioTokenizerConfig.num_codes
NUM_SPECIAL_TOKENS = 16  # a few named below are used now; the rest are headroom for later modalities (e.g. per-frame video markers)
TOTAL_VOCAB_SIZE = TEXT_VOCAB_SIZE + IMAGE_VOCAB_SIZE + AUDIO_VOCAB_SIZE + NUM_SPECIAL_TOKENS


class SpecialTokens:
    """Real token ids, not placeholders — every one of these is a valid
    id in [TEXT_VOCAB_SIZE + IMAGE_VOCAB_SIZE + AUDIO_VOCAB_SIZE,
    TOTAL_VOCAB_SIZE), reserved so it can never collide with a real
    text or image token id."""

    _base = TEXT_VOCAB_SIZE + IMAGE_VOCAB_SIZE + AUDIO_VOCAB_SIZE
    BOS = _base + 0
    EOS = _base + 1
    PAD = _base + 2
    IMAGE_START = _base + 3
    IMAGE_END = _base + 4
    VIDEO_START = _base + 5  # reserved for when video (a per-frame sequence of image tokens) is wired in
    VIDEO_END = _base + 6
    AUDIO_START = _base + 7  # reserved for audio_tokenizer.py
    AUDIO_END = _base + 8


IMAGE_VOCAB_BASE = TEXT_VOCAB_SIZE
AUDIO_VOCAB_BASE = TEXT_VOCAB_SIZE + IMAGE_VOCAB_SIZE


def _offset_to_vocab_id(token_id: int | torch.Tensor, base: int) -> int | torch.Tensor:
    """Shared arithmetic behind every modality's *_token_id_to_vocab_id()
    below — kept as ONE function (rather than duplicated per modality,
    which is exactly how the tensor-range-check bug below first slipped
    in) since every modality does the identical thing: add a fixed base
    offset so its own codebook ids occupy a reserved slice of the one
    shared vocabulary."""
    return base + token_id


def _vocab_id_to_offset_token_id(
    vocab_id: int | torch.Tensor, base: int, size: int, range_name: str
) -> int | torch.Tensor:
    """Shared arithmetic behind every modality's vocab_id_to_*_token_id()
    below. A Python chained comparison (`a <= x < b`) on a multi-element
    tensor raises "ambiguous truth value" instead of checking
    element-wise — a real bug first found here for images, when a batch
    of ~256 per-image ids (never a single scalar) is exactly how real
    training/inference always calls this. Centralizing the check here
    means that fix applies to every modality, including this one for
    audio, rather than needing to be independently remembered and
    re-applied per modality."""
    if isinstance(vocab_id, torch.Tensor):
        in_range = (vocab_id >= base) & (vocab_id < base + size)
        if not torch.all(in_range):
            bad = vocab_id[~in_range]
            raise ValueError(f"vocab ids {bad.tolist()} are not in the {range_name}-token range")
    else:
        if not (base <= vocab_id < base + size):
            raise ValueError(f"vocab id {vocab_id} is not in the {range_name}-token range")
    return vocab_id - base


def image_token_id_to_vocab_id(image_token_id: int | torch.Tensor) -> int | torch.Tensor:
    """Converts an image_tokenizer.py codebook id (in [0, IMAGE_VOCAB_SIZE))
    to this model's shared vocabulary id — the offset every image token
    must go through before being placed in a sequence this model reads
    or is trained to predict. Accepts a plain int or a real tensor of any
    shape (real usage is always a batch of ~256 ids per image, never one
    id at a time)."""
    return _offset_to_vocab_id(image_token_id, IMAGE_VOCAB_BASE)


def vocab_id_to_image_token_id(vocab_id: int | torch.Tensor) -> int | torch.Tensor:
    """The inverse of image_token_id_to_vocab_id — used when reading
    this model's own generated output back out to hand to
    image_tokenizer.decode()."""
    return _vocab_id_to_offset_token_id(vocab_id, IMAGE_VOCAB_BASE, IMAGE_VOCAB_SIZE, "image")


def audio_token_id_to_vocab_id(audio_token_id: int | torch.Tensor) -> int | torch.Tensor:
    """Converts an audio_tokenizer.py codebook id (in [0, AUDIO_VOCAB_SIZE))
    to this model's shared vocabulary id — the audio counterpart to
    image_token_id_to_vocab_id() above."""
    return _offset_to_vocab_id(audio_token_id, AUDIO_VOCAB_BASE)


def vocab_id_to_audio_token_id(vocab_id: int | torch.Tensor) -> int | torch.Tensor:
    """The inverse of audio_token_id_to_vocab_id — used when reading
    this model's own generated output back out to hand to
    audio_tokenizer.decode()."""
    return _vocab_id_to_offset_token_id(vocab_id, AUDIO_VOCAB_BASE, AUDIO_VOCAB_SIZE, "audio")


@dataclass
class NovaSmallConfig:
    vocab_size: int = TOTAL_VOCAB_SIZE
    d_model: int = 1280
    n_layers: int = 26
    n_heads: int = 20
    n_kv_heads: int = 10
    mlp_hidden: int = 3328
    max_seq_len: int = 2048
    rope_theta: float = 10000.0
    rms_norm_eps: float = 1e-5
    tie_embeddings: bool = True

    def __post_init__(self):
        if self.d_model % self.n_heads != 0:
            raise ValueError(f"d_model ({self.d_model}) must be divisible by n_heads ({self.n_heads})")
        if self.n_heads % self.n_kv_heads != 0:
            raise ValueError(f"n_heads ({self.n_heads}) must be divisible by n_kv_heads ({self.n_kv_heads})")


class RMSNorm(nn.Module):
    def __init__(self, d_model: int, eps: float):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(d_model))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Owner-report-proof numerical detail: compute the norm in
        # float32 even if x is float16/bfloat16 (common on Kaggle's
        # free GPUs with mixed precision) — squaring/mean-ing in half
        # precision is a well-documented source of real NaN losses in
        # transformer training, not a hypothetical concern.
        dtype = x.dtype
        x = x.float()
        variance = x.pow(2).mean(dim=-1, keepdim=True)
        x = x * torch.rsqrt(variance + self.eps)
        return (x.to(dtype)) * self.weight


def precompute_rope(head_dim: int, max_seq_len: int, theta: float, device=None, dtype=None):
    inv_freq = 1.0 / (theta ** (torch.arange(0, head_dim, 2, device=device, dtype=torch.float32) / head_dim))
    positions = torch.arange(max_seq_len, device=device, dtype=torch.float32)
    freqs = torch.outer(positions, inv_freq)  # (max_seq_len, head_dim/2)
    cos = torch.cos(freqs)
    sin = torch.sin(freqs)
    if dtype is not None:
        cos, sin = cos.to(dtype), sin.to(dtype)
    return cos, sin  # each (max_seq_len, head_dim/2)


def apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    # x: (batch, n_heads, seq_len, head_dim). Splits the head dimension
    # into even/odd pairs (the standard "rotate_half" formulation) and
    # rotates each pair by the position-dependent angle.
    x1, x2 = x[..., 0::2], x[..., 1::2]
    cos = cos[None, None, : x.shape[2], :]
    sin = sin[None, None, : x.shape[2], :]
    rotated_1 = x1 * cos - x2 * sin
    rotated_2 = x1 * sin + x2 * cos
    out = torch.empty_like(x)
    out[..., 0::2] = rotated_1
    out[..., 1::2] = rotated_2
    return out


class Attention(nn.Module):
    def __init__(self, cfg: NovaSmallConfig):
        super().__init__()
        self.n_heads = cfg.n_heads
        self.n_kv_heads = cfg.n_kv_heads
        self.head_dim = cfg.d_model // cfg.n_heads
        self.n_rep = cfg.n_heads // cfg.n_kv_heads  # query heads sharing each KV head

        self.q_proj = nn.Linear(cfg.d_model, cfg.n_heads * self.head_dim, bias=False)
        self.k_proj = nn.Linear(cfg.d_model, cfg.n_kv_heads * self.head_dim, bias=False)
        self.v_proj = nn.Linear(cfg.d_model, cfg.n_kv_heads * self.head_dim, bias=False)
        self.o_proj = nn.Linear(cfg.n_heads * self.head_dim, cfg.d_model, bias=False)

    def forward(self, x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
        batch, seq_len, _ = x.shape

        q = self.q_proj(x).view(batch, seq_len, self.n_heads, self.head_dim).transpose(1, 2)
        k = self.k_proj(x).view(batch, seq_len, self.n_kv_heads, self.head_dim).transpose(1, 2)
        v = self.v_proj(x).view(batch, seq_len, self.n_kv_heads, self.head_dim).transpose(1, 2)

        q = apply_rope(q, cos, sin)
        k = apply_rope(k, cos, sin)

        # Repeat each KV head n_rep times so it lines up with the query
        # heads that share it (GQA) — a real memory/compute saving over
        # full multi-head attention lives in k_proj/v_proj being smaller
        # above; this repeat is only needed for the matmul shapes here.
        if self.n_rep > 1:
            k = k.repeat_interleave(self.n_rep, dim=1)
            v = v.repeat_interleave(self.n_rep, dim=1)

        out = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        out = out.transpose(1, 2).contiguous().view(batch, seq_len, self.n_heads * self.head_dim)
        return self.o_proj(out)


class SwiGLU(nn.Module):
    def __init__(self, cfg: NovaSmallConfig):
        super().__init__()
        self.gate_proj = nn.Linear(cfg.d_model, cfg.mlp_hidden, bias=False)
        self.up_proj = nn.Linear(cfg.d_model, cfg.mlp_hidden, bias=False)
        self.down_proj = nn.Linear(cfg.mlp_hidden, cfg.d_model, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.down_proj(F.silu(self.gate_proj(x)) * self.up_proj(x))


class TransformerBlock(nn.Module):
    def __init__(self, cfg: NovaSmallConfig):
        super().__init__()
        self.input_norm = RMSNorm(cfg.d_model, cfg.rms_norm_eps)
        self.attention = Attention(cfg)
        self.post_attention_norm = RMSNorm(cfg.d_model, cfg.rms_norm_eps)
        self.mlp = SwiGLU(cfg)

    def forward(self, x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
        # Pre-norm residual stream (norm -> sublayer -> add), the same
        # arrangement every modern decoder-only LLM uses — measurably
        # more stable to train than the original post-norm Transformer,
        # especially at this depth (26 layers) without extra tricks.
        x = x + self.attention(self.input_norm(x), cos, sin)
        x = x + self.mlp(self.post_attention_norm(x))
        return x


class NovaSmall(nn.Module):
    def __init__(self, cfg: NovaSmallConfig):
        super().__init__()
        self.cfg = cfg
        self.token_embedding = nn.Embedding(cfg.vocab_size, cfg.d_model)
        self.layers = nn.ModuleList(TransformerBlock(cfg) for _ in range(cfg.n_layers))
        self.final_norm = RMSNorm(cfg.d_model, cfg.rms_norm_eps)
        self.lm_head = nn.Linear(cfg.d_model, cfg.vocab_size, bias=False)
        if cfg.tie_embeddings:
            # Owner-value note: tying saves cfg.vocab_size * cfg.d_model
            # real parameters (~41M at this config) with no measured
            # quality cost in the literature at this scale — the input
            # embedding table and the output projection are the exact
            # same weight matrix, used in two different directions.
            self.lm_head.weight = self.token_embedding.weight

        head_dim = cfg.d_model // cfg.n_heads
        cos, sin = precompute_rope(head_dim, cfg.max_seq_len, cfg.rope_theta)
        self.register_buffer("rope_cos", cos, persistent=False)
        self.register_buffer("rope_sin", sin, persistent=False)

        self.apply(self._init_weights)

    def _init_weights(self, module: nn.Module) -> None:
        # Standard GPT-style initialization (normal, std=0.02) — the
        # same starting point Llama/GPT-2/GPT-NeoX all publish; this is
        # what actually gets iterated on during real pretraining, so it
        # only needs to be a reasonable, well-tested starting point, not
        # a final answer.
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def forward(self, input_ids: torch.Tensor, labels: torch.Tensor | None = None):
        batch, seq_len = input_ids.shape
        if seq_len > self.cfg.max_seq_len:
            raise ValueError(f"sequence length {seq_len} exceeds max_seq_len {self.cfg.max_seq_len}")

        x = self.token_embedding(input_ids)
        cos = self.rope_cos.to(x.device)
        sin = self.rope_sin.to(x.device)
        for layer in self.layers:
            x = layer(x, cos, sin)
        x = self.final_norm(x)
        logits = self.lm_head(x)

        loss = None
        if labels is not None:
            # Standard next-token shift: logits at position i predict
            # the token at position i+1.
            shift_logits = logits[:, :-1, :].contiguous()
            shift_labels = labels[:, 1:].contiguous()
            loss = F.cross_entropy(
                shift_logits.view(-1, shift_logits.size(-1)),
                shift_labels.view(-1),
                ignore_index=-100,
            )
        return logits, loss

    def count_parameters(self, exclude_tied_duplicate: bool = True) -> int:
        if exclude_tied_duplicate and self.cfg.tie_embeddings:
            seen = set()
            total = 0
            for p in self.parameters():
                if id(p) in seen:
                    continue
                seen.add(id(p))
                total += p.numel()
            return total
        return sum(p.numel() for p in self.parameters())


def build_default_model() -> NovaSmall:
    """The owner's actual ~500M target configuration, now including the
    shared text+image+audio (video reuses the image codebook per-frame)
    vocabulary — see this module's own docstring for how these exact
    numbers were reached (514.2M parameters with the expanded
    vocabulary, verified both here with real torch below and
    independently in nova_small/verify_architecture.py without needing
    torch/GPU)."""
    cfg = NovaSmallConfig(
        vocab_size=TOTAL_VOCAB_SIZE,
        d_model=1280,
        n_layers=26,
        n_heads=20,
        n_kv_heads=10,
        mlp_hidden=3328,
        max_seq_len=2048,
    )
    return NovaSmall(cfg)


if __name__ == "__main__":
    model = build_default_model()
    n_params = model.count_parameters()
    print(f"NovaSmall parameter count: {n_params:,} ({n_params / 1e6:.1f}M)")

    batch, seq_len = 2, 16
    dummy_input = torch.randint(0, model.cfg.vocab_size, (batch, seq_len))
    dummy_labels = torch.randint(0, model.cfg.vocab_size, (batch, seq_len))
    logits, loss = model(dummy_input, labels=dummy_labels)
    assert logits.shape == (batch, seq_len, model.cfg.vocab_size), f"unexpected logits shape {logits.shape}"
    assert loss is not None and torch.isfinite(loss), f"loss is not a finite scalar: {loss}"
    print(f"forward pass OK: logits shape={tuple(logits.shape)}, loss={loss.item():.4f}")
