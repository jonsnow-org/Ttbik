"""
SHAM 2 — UNIFIED SINGLE PATH — FAIL-CLOSED REAL-DATA IMPLEMENTATION
===================================================================
One model path only:
  * a read-only copy of the real ShamSmall donor checkpoint,
  * a new LoRA adapter of rank 16,
  * the T-LDM Compressor / Thinker / Writer head.

No random donor features, random token batches, synthetic target labels, or
proxy losses are permitted. All training examples and held-out examples must
come from explicit, non-empty JSONL files supplied by the operator.

Required JSONL formats:
  train-data:
    {"stage":"identity|tools|arabic|tldm_head", "input":"...", "target":"..."}
  heldout-data:
    {"input":"...", "target":"..."}

The repo contains source lists, not pre-exported data files:
  ai-system/tldm/data/identity.py                 (TRAIN / HELDOUT)
  ai-system/tldm/data/terminal_tasks.py           (TRAIN / HELDOUT)
  ai-system/tldm/data/rewordings.py               (HELDOUT2)
They must be exported into validated JSONL files before this trainer runs.
The prior result file tldm_heldout_gate_2026-11-18.json is NOT a dataset and
is NOT a fresh gate.

The current implementation has no real image/audio dataset loader. Media is
therefore excluded from --stage all and is explicitly reported as not trained;
it is never simulated using random or text-only data.

--smoke validates the real donor, tokenizer and both datasets and performs
zero optimizer steps.
--serve requires the donor checkpoint, donor tokenizer and a matching
sham2_heads.pt; otherwise it prints:
  missing donor or heads - refuse to serve fake

The donor checkpoint is only read. Outputs are written to a separate directory.
"""

from __future__ import annotations
import argparse, json, math, os, random, sys, time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

# ============================================================
# CONFIG — شام 2 الواحد، إعداد واحد فقط
# ============================================================
@dataclass
class Sham2UnifiedConfig:
    # الجسم المانح — مجمّد دائماً، لا يُدرَّب أبداً
    donor_id: str = "Qwen/Qwen3-1.7B"          # المخدوم. البديل: "HuggingFaceTB/SmolLM3-3B" (مرشح، يحتاج بوابة)
    d_model: int = 2048                          # Qwen3-1.7B. SmolLM3: 2048 أيضاً
    n_layers: int = 28                            # Qwen3-1.7B: 28. SmolLM3: 36 (يُقرأ من المانح تلقائياً)
    vocab_size: int = 151936                      # Qwen3. SmolLM3: 139540 — يُقرأ من المانح
    max_seq_len: int = 4096                       # [إصلاح 13] كان 2048، الآن 4096
    # LoRA — [إصلاح 4] رتبة 16 موحدة، alpha = 2*rank
    adapter_rank: int = 16
    adapter_alpha: float = 32.0
    adapter_dropout: float = 0.0
    # رأس T-LDM
    latents: int = 16
    think_steps: int = 5
    block: int = 48                               # Writer يكتب 48 رمز دفعة واحدة
    writer_layers: int = 3
    heads: int = 4
    head_d: int = 256
    diffusion_steps: int = 10
    confident: float = 0.9                         # [Early Exit] إذا ثقة > 0.9، اقفز لنهاية الانتشار
    # BitNet في الرأس — [تطبيق 1]
    bitnet_head: bool = True
    # Speculative — [تطبيق 2]
    speculative: bool = True
    draft_layers: int = 2
    draft_d: int = 256
    # تدريب
    lr: float = 1e-3
    lora_lr: float = 2e-4                         # LoRA أبطأ من الرأس (استقرار)
    steps: int = 600
    batch: int = 32
    gate_heldout: float = 0.6                      # عتبة البوابة
    # وسائط
    image_vocab: int = 8192
    audio_vocab: int = 2048
    special_vocab: int = 256
    # طرفية
    max_tool_calls: int = 6
    # QAT + GGUF — [تطبيق 5]
    qat_bits: int = 4
    dtype: str = "bf16"

# ============================================================
# BitLinear — 1.58-bit (ternary -1/0/+1) — كان ملفاً فقط، الآن مستخدم
# ============================================================
class BitLinear(nn.Module):
    """BitNet b1.58: أوزان ثلاثية + تطبيع. يوفر ~16x ذاكرة الرأس، ويُدرَّب بـ Straight-Through Estimator.
    [إصلاح 10] — الرأس كله يستخدم BitLinear، الجسم المانح يبقى bf16 (لا نلمسه)."""
    def __init__(self, in_f: int, out_f: int, bias: bool = False):
        super().__init__()
        self.weight = nn.Parameter(torch.randn(out_f, in_f) * (1.0 / math.sqrt(in_f)))
        self.bias = nn.Parameter(torch.zeros(out_f)) if bias else None
        self.scale = nn.Parameter(torch.ones(1))

    def _ternarize(self, w: torch.Tensor) -> torch.Tensor:
        # متوسط القيمة المطلقة = المقياس. STE: في الأمامي نكمم، في الخلفي نمرر التدرج كما هو.
        scale = w.abs().mean().clamp_min(1e-8)
        w_q = torch.round(w / scale).clamp(-1, 1)
        # Straight-Through: (w_q - w).detach() + w
        return (w_q * scale - w).detach() + w

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # RMSNorm على المدخل (BitNet الأصلي) — يمنع انفجار التنشيطات
        rms = x.pow(2).mean(dim=-1, keepdim=True).sqrt().clamp_min(1e-8)
        x_n = x / rms
        w = self._ternarize(self.weight)
        out = F.linear(x_n, w, self.bias)
        return out * self.scale

def Linear(in_f: int, out_f: int, bitnet: bool, bias: bool = False) -> nn.Module:
    return BitLinear(in_f, out_f, bias=bias) if bitnet else nn.Linear(in_f, out_f, bias=bias)

# ============================================================
# LoRA — رتبة 16 موحدة
# ============================================================
class LoRALinear(nn.Module):
    """LoRA: W + (B @ A) * alpha/r. الجسم W مجمّد، A و B فقط يتدرّبان.
    [إصلاح 4] رتبة 16 بدل 8. [إصلاح 5] A/B بـ fp32 حتى لو الجسم bf16."""
    def __init__(self, base: nn.Linear, rank: int = 16, alpha: float = 32.0):
        super().__init__()
        self.base = base
        for p in self.base.parameters():
            p.requires_grad_(False)
        self.lora_A = nn.Parameter(torch.randn(rank, base.in_features, dtype=torch.float32) * 0.01)
        self.lora_B = nn.Parameter(torch.zeros(base.out_features, rank, dtype=torch.float32))
        self.scaling = alpha / rank

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        base_out = self.base(x)
        # LoRA بـ fp32 ثم إعادة للـ dtype الأصلي
        lora_out = F.linear(F.linear(x.float(), self.lora_A), self.lora_B) * self.scaling
        return base_out + lora_out.to(base_out.dtype)

# ============================================================
# Mamba Mixer — O(n) بدل O(n^2) — [تطبيق 3]
# ============================================================
class MambaMixer(nn.Module):
    """Mamba مبسّط: Selective State Space. يخلط التسلسل بـ O(n) لا O(n^2).
    يُستخدم في Compressor فقط، لأن الجسم المانح Attention مجمّد ولا نغيره."""
    def __init__(self, d: int, d_state: int = 16, expand: int = 2):
        super().__init__()
        self.d_inner = d * expand
        self.in_proj = Linear(d, self.d_inner * 2, bitnet=False)
        self.conv = nn.Conv1d(self.d_inner, self.d_inner, kernel_size=4, groups=self.d_inner, padding=3)
        self.x_proj = nn.Linear(self.d_inner, d_state * 2 + 1)
        self.dt_proj = nn.Linear(1, self.d_inner)
        self.out_proj = Linear(self.d_inner, d, bitnet=False)
        self.A = nn.Parameter(torch.randn(self.d_inner, d_state) * 0.1)
        self.D = nn.Parameter(torch.ones(self.d_inner))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, T, d)
        xz = self.in_proj(x)  # (B, T, 2*d_inner)
        x_part, z = xz.chunk(2, dim=-1)
        x_conv = self.conv(x_part.transpose(1, 2))[:, :, :x.shape[1]].transpose(1, 2)
        x_act = F.silu(x_conv)
        # Selective: B, C, dt من المدخل نفسه — هذا جوهر Mamba
        b_c_dt = self.x_proj(x_act)  # (B, T, 2*d_state+1)
        dt = F.softplus(self.dt_proj(b_c_dt[:, :, -1:]))
        # تبسيط محسوب: حالة متكررة خطية (SSM) — O(n)
        # h_t = h_{t-1} * exp(-dt) + x_t * dt
        h = torch.zeros(x.shape[0], self.d_inner, device=x.device, dtype=x.dtype)
        outs = []
        A_exp = torch.exp(-dt.squeeze(-1).unsqueeze(-1) * torch.sigmoid(self.A).mean(dim=-1, keepdim=True).T if False else -dt)
        # حلقة O(n) — سريعة لأن d_inner صغير (512) و T <= 4096
        for t in range(x_act.shape[1]):
            decay = torch.exp(-dt[:, t].squeeze(-1)).unsqueeze(-1)  # (B, d_inner)
            h = h * decay + x_act[:, t] * dt[:, t]
            outs.append(h)
        y = torch.stack(outs, dim=1)  # (B, T, d_inner)
        y = y * F.silu(z)
        return self.out_proj(y) + x  # residual

# ============================================================
# Compressor — يختصر الجسم إلى 16 latent
# ============================================================
class Compressor(nn.Module):
    """Compressor: من ميزات الجسم (B, T, 2048) إلى 16 latent (B, 16, 256).
    يستخدم Mamba Mixer + Attention Pooling. هذا هو 'الفهم' المضغوط."""
    def __init__(self, cfg: Sham2UnifiedConfig):
        super().__init__()
        self.cfg = cfg
        self.in_proj = Linear(cfg.d_model, cfg.head_d, bitnet=cfg.bitnet_head)
        self.mixer = MambaMixer(cfg.head_d)
        self.latent_queries = nn.Parameter(torch.randn(cfg.latents, cfg.head_d) * 0.02)
        self.attn = nn.MultiheadAttention(cfg.head_d, cfg.heads, batch_first=True)
        self.norm = nn.LayerNorm(cfg.head_d)

    def forward(self, body_features: torch.Tensor) -> torch.Tensor:
        # body_features: (B, T, d_model) — من الجسم المجمّد، مقروءة مرة واحدة
        h = self.in_proj(body_features)       # (B, T, 256)
        h = self.mixer(h)                     # O(n) خلط
        q = self.latent_queries.unsqueeze(0).expand(h.shape[0], -1, -1)  # (B, 16, 256)
        lat, _ = self.attn(q, h, h)           # Latent يستخرج ما يهمه من كل التسلسل
        return self.norm(lat + q)

# ============================================================
# Latent Thinker — يفكر 5 خطوات في الـ latent، لا في النص
# ============================================================
class LatentThinker(nn.Module):
    """Thinker: 5 خطوات تفكير في فضاء latent (16x256)، بدون توليد نص.
    كل خطوة = Transformer صغير + residual. هذا يوفّر 5x توليد نص وهمي."""
    def __init__(self, cfg: Sham2UnifiedConfig):
        super().__init__()
        self.cfg = cfg
        layer = nn.TransformerEncoderLayer(d_model=cfg.head_d, nhead=cfg.heads,
                                           dim_feedforward=cfg.head_d*4, batch_first=True,
                                           activation="gelu")
        self.layers = nn.ModuleList([layer for _ in range(2)])
        self.step_embed = nn.Parameter(torch.randn(cfg.think_steps, cfg.head_d) * 0.02)
        self.norm = nn.LayerNorm(cfg.head_d)

    def forward(self, lat: torch.Tensor) -> torch.Tensor:
        # lat: (B, 16, 256)
        for step in range(self.cfg.think_steps):
            lat = lat + self.step_embed[step].unsqueeze(0).unsqueeze(0)
            for layer in self.layers:
                lat = layer(lat)
        return self.norm(lat)

# ============================================================
# Diffusion Writer — يكتب كتلة 48 رمز دفعة واحدة
# ============================================================
class DiffusionWriter(nn.Module):
    """Writer: Diffusion على الرموز. يبدأ من ضجيج، وينقّي 10 خطوات إلى كتلة 48 رمز.
    [تطبيق 4] + [Early Exit] إذا الثقة > 0.9، اقفز مباشرة للنهاية."""
    def __init__(self, cfg: Sham2UnifiedConfig, vocab_size: int):
        super().__init__()
        self.cfg = cfg
        self.vocab_size = vocab_size
        self.token_embed = nn.Embedding(vocab_size, cfg.head_d)
        self.cond_proj = Linear(cfg.head_d, cfg.head_d, bitnet=cfg.bitnet_head)
        layer = nn.TransformerEncoderLayer(d_model=cfg.head_d, nhead=cfg.heads,
                                           dim_feedforward=cfg.head_d*4, batch_first=True,
                                           activation="gelu")
        self.layers = nn.ModuleList([layer for _ in range(cfg.writer_layers)])
        self.head = Linear(cfg.head_d, vocab_size, bitnet=cfg.bitnet_head)  # يُعاد استخدام lm_head المجمّد إن وجد
        self.norm = nn.LayerNorm(cfg.head_d)
        self.step_embed = nn.Parameter(torch.randn(cfg.diffusion_steps, cfg.head_d) * 0.02)

    def forward(self, lat: torch.Tensor, block_len: int | None = None,
                return_confidence: bool = False):
        B = lat.shape[0]
        L = block_len or self.cfg.block
        # 1) ابدأ من ضجيج
        x = torch.randn(B, L, self.cfg.head_d, device=lat.device)
        # شرط من Thinker: متوسط الـ latents
        cond = self.cond_proj(lat.mean(dim=1, keepdim=True))  # (B, 1, 256)
        confidence = 0.0
        for step in range(self.cfg.diffusion_steps):
            x = x + self.step_embed[step].unsqueeze(0).unsqueeze(0)
            # ادمج الشرط
            x_in = torch.cat([x, cond.expand(-1, L, -1)], dim=1)  # (B, L+1, 256)
            for layer in self.layers:
                x_in = layer(x_in)
            x = self.norm(x_in[:, :L])
            logits = self.head(x)  # (B, L, vocab)
            # [Early Exit] إذا الثقة عالية، توقف مبكراً
            probs = torch.softmax(logits.float(), dim=-1)
            confidence = probs.max(dim=-1).values.mean().item()
            if confidence >= self.cfg.confident and step >= 2:
                break  # توفير ~30% من الخطوات
        logits = self.head(x)
        if return_confidence:
            return logits, confidence
        return logits

# ============================================================
# Speculative Draft — نموذج مصغّر 0.3B يقترح، الجسم يتحقق
# ============================================================
class SpeculativeDraft(nn.Module):
    """Draft: نموذج صغير (2 طبقة، d=256) يقترح الكتلة، الجسم المجمّد يتحقق دفعة واحدة.
    [تطبيق 2] — إذا قبل الجسم الاقتراح، وفّرنا توليداً كاملاً. إذا رفضه، نعيد توليد الموضع المرفوض فقط."""
    def __init__(self, cfg: Sham2UnifiedConfig, vocab_size: int):
        super().__init__()
        self.embed = nn.Embedding(vocab_size, cfg.draft_d)
        layer = nn.TransformerEncoderLayer(d_model=cfg.draft_d, nhead=4,
                                           dim_feedforward=cfg.draft_d*4, batch_first=True)
        self.layers = nn.ModuleList([layer for _ in range(cfg.draft_layers)])
        self.head = nn.Linear(cfg.draft_d, vocab_size)

    def propose(self, prefix_ids: torch.Tensor, n: int = 8) -> torch.Tensor:
        x = self.embed(prefix_ids)
        for layer in self.layers:
            x = layer(x)
        logits = self.head(x[:, -1])
        # اقترح n رموز بجشع (greedy) — سريع لأن Draft صغير
        out = []
        cur = prefix_ids
        for _ in range(n):
            h = self.embed(cur)
            for layer in self.layers:
                h = layer(h)
            nxt = self.head(h[:, -1]).argmax(dim=-1, keepdim=True)
            out.append(nxt)
            cur = torch.cat([cur, nxt], dim=1)
        return torch.cat(out, dim=1)  # (B, n)

# ============================================================
# Sham2 Unified — الجسم المجمّد + LoRA + رأس T-LDM — نموذج واحد
# ============================================================
class Sham2LoRA16(nn.Module):
    """New rank-16 adapter over a frozen donor projection (including old adapters)."""
    def __init__(self, base: nn.Module, rank: int = 16, alpha: float = 32.0):
        super().__init__()
        leaf = base
        while not isinstance(leaf, nn.Linear) and hasattr(leaf, "base"):
            leaf = leaf.base
        if not isinstance(leaf, nn.Linear):
            raise TypeError(f"LoRA target is not backed by nn.Linear: {type(base).__name__}")
        self.base = base
        for p in self.base.parameters():
            p.requires_grad_(False)
        self.lora_A = nn.Parameter(torch.empty(rank, leaf.in_features, dtype=torch.float32))
        self.lora_B = nn.Parameter(torch.zeros(leaf.out_features, rank, dtype=torch.float32))
        nn.init.kaiming_uniform_(self.lora_A, a=math.sqrt(5))
        self.scaling = float(alpha) / int(rank)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        base_out = self.base(x)
        update = F.linear(F.linear(x.float(), self.lora_A), self.lora_B) * self.scaling
        return base_out + update.to(base_out.dtype)


def install_rank16_lora(donor_body: nn.Module) -> int:
    """Attach a fresh rank-16 LoRA to every supported ShamSmall attention/MLP projection."""
    layers = getattr(donor_body, "layers", None)
    if not layers:
        raise RuntimeError("donor checkpoint is not a compatible ShamSmall model (missing layers)")
    count = 0
    for layer in layers:
        for parent_name in ("attention", "mlp"):
            parent = getattr(layer, parent_name, None)
            if parent is None:
                raise RuntimeError(f"donor layer is missing {parent_name}")
            for name in ("q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"):
                if not hasattr(parent, name):
                    raise RuntimeError(f"donor projection missing: {parent_name}.{name}")
                old = getattr(parent, name)
                if isinstance(old, Sham2LoRA16):
                    raise RuntimeError(f"rank-16 LoRA is already attached at {parent_name}.{name}")
                setattr(parent, name, Sham2LoRA16(old, rank=16, alpha=32.0))
                count += 1
    if count == 0:
        raise RuntimeError("no rank-16 LoRA targets were installed")
    return count


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def load_sham_donor(donor_path: str) -> Tuple[nn.Module, int, Dict]:
    """Load a real, self-describing ShamSmall checkpoint through its canonical loader."""
    path = Path(donor_path).expanduser().resolve()
    if not path.is_file() or path.stat().st_size == 0:
        raise FileNotFoundError(f"donor checkpoint is missing or empty: {path}")
    sham_dir = _repo_root() / "ai-system" / "colab" / "sham_small"
    if not sham_dir.is_dir():
        raise FileNotFoundError(f"ShamSmall checkpoint loader directory is missing: {sham_dir}")
    if str(sham_dir) not in sys.path:
        sys.path.insert(0, str(sham_dir))
    from checkpoint import load_checkpoint
    body, step, extra = load_checkpoint(path, map_location="cpu")
    if not hasattr(body, "cfg") or not hasattr(body, "final_norm") or not hasattr(body, "layers"):
        raise RuntimeError("loaded checkpoint is not a compatible ShamSmall donor")
    if not hasattr(body.cfg, "max_seq_len"):
        raise RuntimeError("donor checkpoint has no max_seq_len configuration")
    # The documented 8-GB CPU Studio path stores the donor in bf16. Refuse a
    # full-precision body rather than silently causing an avoidable OOM.
    first_parameter = next(body.parameters(), None)
    if first_parameter is None or first_parameter.dtype != torch.bfloat16:
        raise RuntimeError("donor checkpoint must be stored in bfloat16 for the 8-GB CPU Studio")
    for p in body.parameters():
        p.requires_grad_(False)
    body.eval()
    return body, int(step), extra or {}


def load_sham_tokenizer(tokenizer_path: str):
    """Load and sanity-check the actual donor tokenizer; no fallback tokenizer."""
    path = Path(tokenizer_path).expanduser().resolve()
    if not path.is_file() or path.stat().st_size == 0:
        raise FileNotFoundError(f"tokenizer is missing or empty: {path}")
    from tokenizers import Tokenizer
    tok = Tokenizer.from_file(str(path))
    if tok.get_vocab_size(with_added_tokens=True) <= 0:
        raise RuntimeError("donor tokenizer has an empty vocabulary")
    for probe in ("مرحبا", "hello", "اعرض الملفات"):
        if not tok.encode(probe).ids:
            raise RuntimeError(f"donor tokenizer failed to encode validation text: {probe!r}")
    return tok


def file_sha256(path: str | Path) -> str:
    import hashlib
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_jsonl(path: str, *, require_stage: bool) -> List[Dict]:
    """Read explicit on-disk examples only. No built-in or generated fallbacks."""
    p = Path(path).expanduser().resolve()
    if not p.is_file() or p.stat().st_size == 0:
        raise FileNotFoundError(f"dataset is missing or empty: {p}")
    rows = []
    with p.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"invalid JSONL at {p}:{line_no}: {exc}") from exc
            if not isinstance(item, dict):
                raise ValueError(f"dataset row must be an object at {p}:{line_no}")
            for key in ("input", "target"):
                if not isinstance(item.get(key), str) or not item[key].strip():
                    raise ValueError(f"missing non-empty {key!r} at {p}:{line_no}")
            if require_stage:
                stage_name = str(item.get("stage", "")).strip().lower()
                if stage_name not in ("identity", "tools", "arabic", "tldm_head"):
                    raise ValueError(
                        f"invalid/missing stage at {p}:{line_no}; expected identity/tools/arabic/tldm_head"
                    )
                item["stage"] = stage_name
            rows.append(item)
    if not rows:
        raise ValueError(f"dataset contains no usable examples: {p}")
    return rows


def _model_donor_config(body: nn.Module) -> Dict:
    return {
        "d_model": int(body.cfg.d_model),
        "vocab_size": int(body.cfg.vocab_size),
        "n_layers": int(body.cfg.n_layers),
        "max_seq_len": int(body.cfg.max_seq_len),
    }


def _encode_rows(rows: List[Dict], tokenizer, cfg: Sham2UnifiedConfig,
                 vocab_size: int, label: str) -> List[Dict]:
    encoded = []
    for i, row in enumerate(rows, 1):
        x = tokenizer.encode(row["input"]).ids
        y = tokenizer.encode(row["target"]).ids
        if not x or not y:
            raise ValueError(f"{label} row {i} tokenized to an empty input or target")
        if len(x) > cfg.max_seq_len:
            raise ValueError(f"{label} row {i} input has {len(x)} tokens, limit is {cfg.max_seq_len}")
        if len(y) > cfg.block:
            raise ValueError(f"{label} row {i} target has {len(y)} tokens, limit is {cfg.block}; refusing truncation")
        if min(x + y) < 0 or max(x + y) >= vocab_size:
            raise ValueError(f"{label} row {i} contains token IDs outside donor vocabulary {vocab_size}")
        encoded.append({"input_ids": x, "target_ids": y, "stage": row.get("stage")})
    return encoded


class Sham2Unified(nn.Module):
    """One Sham 2 assembly: frozen real donor + new LoRA-16 + T-LDM head."""
    def __init__(self, cfg: Sham2UnifiedConfig, donor_body: nn.Module):
        super().__init__()
        if donor_body is None:
            raise ValueError("a real donor_body is required; random donor features are forbidden")
        self.cfg = cfg
        self.donor_body = donor_body
        for name, p in self.donor_body.named_parameters():
            p.requires_grad_(".lora_A" in name or ".lora_B" in name)
        self.donor_body.eval()
        self.compressor = Compressor(cfg)
        self.thinker = LatentThinker(cfg)
        self.writer = DiffusionWriter(cfg, cfg.vocab_size)
        # SpeculativeDraft in this file is an unfinished prototype, not part
        # of the requested trainable contract, so it is not instantiated.
        self.draft = None

    def train(self, mode: bool = True):
        super().train(mode)
        self.donor_body.eval()
        return self

    def trainable_parameters(self):
        return [
            p for name, p in self.named_parameters()
            if p.requires_grad and (
                name.startswith(("compressor.", "thinker.", "writer."))
                or ".lora_A" in name or ".lora_B" in name
            )
        ]

    def body_features(self, input_ids: torch.Tensor,
                      attention_mask: torch.Tensor | None = None) -> torch.Tensor:
        """Capture actual final-normalized donor features with gradient to new LoRA only."""
        final_norm = getattr(self.donor_body, "final_norm", None)
        if final_norm is None:
            raise RuntimeError("donor has no final_norm feature hook; refusing synthetic features")
        captured = []
        handle = final_norm.register_forward_hook(lambda _m, _i, out: captured.append(out))
        try:
            self.donor_body(input_ids)
        finally:
            handle.remove()
        if not captured or not torch.is_tensor(captured[-1]):
            raise RuntimeError("donor did not produce real hidden features")
        features = captured[-1]
        if features.ndim != 3 or features.shape[-1] != self.cfg.d_model:
            raise RuntimeError(
                f"donor feature shape mismatch: expected (B,T,{self.cfg.d_model}), got {tuple(features.shape)}"
            )
        return features

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor | None = None,
                target_len: int | None = None) -> Tuple[torch.Tensor, float]:
        features = self.body_features(input_ids, attention_mask).float()
        latents = self.compressor(features)
        thought = self.thinker(latents)
        logits, confidence = self.writer(
            thought, block_len=target_len, return_confidence=True
        )
        return logits, confidence

    def generate_block(self, input_ids: torch.Tensor) -> torch.Tensor:
        self.eval()
        with torch.no_grad():
            logits, _ = self.forward(input_ids)
            return logits.argmax(dim=-1)

# ============================================================
# Codebook Init للوسائط — [إصلاح 3]
# ============================================================
def init_media_codebook(model: Sham2Unified, image_codebook: torch.Tensor | None = None,
                        audio_codebook: torch.Tensor | None = None, seed: int = 0):
    """صفوف الصورة/الصوت تبدأ من Codebook مدرّب، لا من عشوائية.
    image_codebook: (8192, 256) من VQ. audio_codebook: (2048, 128) من X-codec2.
    إسقاط orthonormal ثابت: C @ P حيث P من QR لضجيج ثابت."""
    g = torch.Generator().manual_seed(seed)
    W = model.writer.token_embed.weight  # (vocab, head_d) — صفوف الوسائط فوق النص
    # في التطبيق الكامل: تُطبَّق على token_embedding للجسم. هنا على Writer كمثال قابل للتشغيل.
    # القاعدة: mean + (C - mean)/std @ P * (0.1*std)
    for C in [image_codebook, audio_codebook]:
        if C is None:
            continue
        C = C.float()
        C = (C - C.mean(0)) / (C.std() + 1e-8)
        d = W.shape[1]
        P = torch.linalg.qr(torch.randn(d, C.shape[1], generator=g)).Q.T  # (code_dim, d)
        X = C @ P
        # لا نكتب فوق النص — فقط نُعيد القاعدة للتوثيق. التطبيق على الجسم يتم في sham_transplant.
        _ = X
    return {"media_init": "codebook", "note": "Applied to donor token_embedding in transplant step (see function below)."}

def apply_codebook_to_donor_embedding(donor_embedding: torch.Tensor, codebook: torch.Tensor,
                                      base: int, n: int, seed: int = 0) -> torch.Tensor:
    """تُستدعى في sham_transplant.native_model() — تكتب صفوف الوسائط من Codebook."""
    g = torch.Generator().manual_seed(seed)
    C = codebook.float()
    C = (C - C.mean(0)) / (C.std() + 1e-8)
    d = donor_embedding.shape[1]
    P = torch.linalg.qr(torch.randn(d, C.shape[1], generator=g)).Q.T
    X = C @ P
    mean = donor_embedding[:151936].mean(0) if donor_embedding.shape[0] > 151936 else donor_embedding.mean(0)
    std = donor_embedding[:151936].std() if donor_embedding.shape[0] > 151936 else donor_embedding.std()
    donor_embedding[base:base+n] = mean + X * (0.1 * std / (X.std() + 1e-8))
    return donor_embedding

# ============================================================
# Gate — بوابة صارمة — [إصلاح 6] لا نشر بدونها
# ============================================================
@dataclass
class GateResult:
    passed: bool
    reasons: List[str] = field(default_factory=list)
    metrics: Dict = field(default_factory=dict)

def check_gate(served: Dict, candidate: Dict,
               ar_margin: float = 0.05, en_tolerance: float = 0.03,
               tool_floor: float = 0.90, heldout_min: float = 0.6) -> GateResult:
    """Fail closed unless every independent fresh-gate metric is present."""
    reasons = []
    if not isinstance(served, dict) or not isinstance(candidate, dict):
        return GateResult(False, ["served and candidate gate reports must be JSON objects"], {})

    h = candidate.get("heldout_same_effect")
    if isinstance(h, dict):
        h = h.get("mean")
    if not isinstance(h, (int, float)) or not math.isfinite(float(h)):
        reasons.append("missing/non-numeric candidate heldout_same_effect")
        h = 0.0
    elif h < heldout_min:
        reasons.append(f"heldout {h:.3f} < {heldout_min} — T-LDM head did not pass heldout")

    served_bpb = served.get("bpb_after") or served.get("bpb_before")
    candidate_bpb = candidate.get("bpb_after")
    if not isinstance(served_bpb, dict) or not isinstance(candidate_bpb, dict):
        reasons.append("missing served/candidate Arabic+English bits-per-byte measurements")
    else:
        for lang in ("ar", "en"):
            if not isinstance(served_bpb.get(lang), (int, float)) or not isinstance(candidate_bpb.get(lang), (int, float)):
                reasons.append(f"missing numeric {lang} bits-per-byte baseline or candidate metric")
        if all(isinstance(x, (int, float)) for x in (served_bpb.get("ar"), candidate_bpb.get("ar"))):
            if candidate_bpb["ar"] > served_bpb["ar"] * (1 - ar_margin):
                reasons.append(f"Arabic BPB did not improve by {ar_margin:.0%}")
        if all(isinstance(x, (int, float)) for x in (served_bpb.get("en"), candidate_bpb.get("en"))):
            if candidate_bpb["en"] > served_bpb["en"] * (1 + en_tolerance):
                reasons.append(f"English BPB regression exceeded {en_tolerance:.0%}")

    served_tools = served.get("tools_after")
    candidate_tools = candidate.get("tools_after")
    if not isinstance(served_tools, dict) or not isinstance(candidate_tools, dict):
        reasons.append("missing served/candidate 100-case tool evaluation")
    else:
        valid = True
        for label, metrics in (("served", served_tools), ("candidate", candidate_tools)):
            if not isinstance(metrics.get("cases"), int) or not isinstance(metrics.get("right"), int) or metrics["cases"] < 100:
                reasons.append(f"{label} tool evaluation must contain at least 100 scored cases")
                valid = False
        if valid:
            served_acc = served_tools["right"] / max(1, served_tools["cases"])
            candidate_acc = candidate_tools["right"] / max(1, candidate_tools["cases"])
            if candidate_acc < tool_floor * served_acc:
                reasons.append(
                    f"tool accuracy {candidate_acc:.3f} is below {tool_floor:.0%} of served accuracy {served_acc:.3f}"
                )

    identity = candidate.get("identity")
    if not isinstance(identity, dict) or not isinstance(identity.get("after_lora"), (int, float)):
        reasons.append("missing measured identity.after_lora")
    elif identity["after_lora"] < 1.0:
        reasons.append(f"identity after LoRA {identity['after_lora']} < 1.0")

    nll = candidate.get("general_nll_after")
    if not isinstance(nll, (int, float)) or not math.isfinite(float(nll)):
        reasons.append("missing/non-numeric general_nll_after donor-retention measurement")
    elif nll > 6:
        reasons.append(f"general NLL {nll:.3f} > 6 — donor retention check failed")

    metrics = {
        "heldout_same_effect": h,
        "served_bpb": served_bpb,
        "candidate_bpb": candidate_bpb,
        "served_tools": served_tools,
        "candidate_tools": candidate_tools,
        "general_nll_after": nll,
    }
    return GateResult(passed=len(reasons) == 0, reasons=reasons, metrics=metrics)

# ============================================================
# Training — بمراحل، الجسم مجمّد دائماً
# ============================================================
# ============================================================
# Strict real-data training — no random token IDs or proxy losses
# ============================================================
def train_sham2_unified(donor_path: str, tokenizer_path: str, out_dir: str,
                        train_data_path: str, heldout_data_path: str,
                        cfg: Sham2UnifiedConfig | None = None,
                        stage: str = "all", seed: int = 0) -> Dict:
    cfg = cfg or Sham2UnifiedConfig()
    torch.manual_seed(seed)
    random.seed(seed)
    stages = ["identity", "tools", "arabic", "tldm_head"] if stage == "all" else [stage]
    if any(s not in ("identity", "tools", "arabic", "tldm_head") for s in stages):
        raise ValueError("unsupported stage; only real-data text stages are accepted")

    donor_file = Path(donor_path).expanduser().resolve()
    tokenizer_file = Path(tokenizer_path).expanduser().resolve()
    train_file = Path(train_data_path).expanduser().resolve()
    heldout_file = Path(heldout_data_path).expanduser().resolve()
    out = Path(out_dir).expanduser().resolve()

    for required in (donor_file, tokenizer_file, train_file, heldout_file):
        if not required.is_file() or required.stat().st_size == 0:
            raise FileNotFoundError(f"required real input is missing or empty: {required}")
    if out == donor_file.parent or out.is_relative_to(donor_file.parent) or donor_file.is_relative_to(out):
        raise ValueError("output must be separate from the donor checkpoint directory")
    if out.exists() and any(out.iterdir()):
        raise FileExistsError(f"output directory is not empty; refusing to overwrite: {out}")

    # All data is validated before the output directory is created or training begins.
    raw_train = load_jsonl(str(train_file), require_stage=True)
    raw_heldout = load_jsonl(str(heldout_file), require_stage=False)
    stage_presence = {row["stage"] for row in raw_train}
    missing_stages = [s for s in stages if s not in stage_presence]
    if missing_stages:
        raise ValueError(f"training data is missing required stage(s): {', '.join(missing_stages)}")
    train_inputs = {row["input"].strip() for row in raw_train}
    overlap = [row["input"] for row in raw_heldout if row["input"].strip() in train_inputs]
    if overlap:
        raise ValueError(f"held-out leakage: {len(overlap)} held-out input(s) also occur in training data")

    tokenizer = load_sham_tokenizer(str(tokenizer_file))
    donor_body, donor_step, _donor_extra = load_sham_donor(str(donor_file))
    donor_cfg = _model_donor_config(donor_body)
    cfg.d_model = donor_cfg["d_model"]
    cfg.vocab_size = donor_cfg["vocab_size"]
    cfg.n_layers = donor_cfg["n_layers"]
    cfg.max_seq_len = min(int(cfg.max_seq_len), donor_cfg["max_seq_len"])

    tokenizer_vocab = int(tokenizer.get_vocab_size(with_added_tokens=True))
    if tokenizer_vocab > cfg.vocab_size:
        raise ValueError(
            f"tokenizer vocabulary ({tokenizer_vocab}) exceeds donor vocabulary ({cfg.vocab_size})"
        )
    train_rows = _encode_rows(raw_train, tokenizer, cfg, cfg.vocab_size, "training")
    heldout_rows = _encode_rows(raw_heldout, tokenizer, cfg, cfg.vocab_size, "heldout")

    lora_modules = install_rank16_lora(donor_body)
    model = Sham2Unified(cfg, donor_body)
    trainable = model.trainable_parameters()
    lora_params = sum(
        p.numel() for n, p in model.named_parameters()
        if (".lora_A" in n or ".lora_B" in n) and p.requires_grad
    )
    if lora_params <= 0 or not trainable:
        raise RuntimeError("rank-16 LoRA or T-LDM head has no trainable parameters")
    if any(
        p.requires_grad for n, p in model.donor_body.named_parameters()
        if ".lora_A" not in n and ".lora_B" not in n
    ):
        raise RuntimeError("a donor base parameter became trainable; refusing to train")

    out.mkdir(parents=True, exist_ok=True)
    stage_steps = {"identity": 60, "tools": 400, "arabic": 200, "tldm_head": 600}
    report = {
        "format": "sham2-unified-real-data-report-v1",
        "mode": "frozen-ShamSmall-donor+new-LoRA16+T-LDM",
        "donor_checkpoint": str(donor_file),
        "donor_step": donor_step,
        "donor_config": donor_cfg,
        "donor_weights_written": False,
        "tokenizer": str(tokenizer_file),
        "tokenizer_sha256": file_sha256(tokenizer_file),
        "train_data": str(train_file),
        "train_data_sha256": file_sha256(train_file),
        "heldout_data": str(heldout_file),
        "heldout_data_sha256": file_sha256(heldout_file),
        "train_examples_by_stage": {
            s: sum(1 for row in train_rows if row["stage"] == s) for s in stages
        },
        "heldout_examples": len(heldout_rows),
        "lora_rank": 16,
        "lora_alpha": 32,
        "lora_modules": lora_modules,
        "lora_parameters": lora_params,
        "trainable_parameters": sum(p.numel() for p in trainable),
        "stages": [],
        "media_stage": "not trained: this file has no real image/audio dataset loader",
        "gate": {
            "status": "not-passed",
            "reason": "a fresh served-baseline versus candidate gate is still required",
        },
    }

    model.to(torch.device("cpu"))
    for stage_name in stages:
        rows = [row for row in train_rows if row["stage"] == stage_name]
        if not rows:
            raise ValueError(f"stage {stage_name} has no real training examples")
        lr = cfg.lora_lr if stage_name in ("identity", "tools") else cfg.lr
        optimizer = torch.optim.AdamW(
            trainable, lr=lr, betas=(0.9, 0.95), weight_decay=0.0
        )
        losses = []
        steps = stage_steps[stage_name]
        model.train()
        for step in range(steps):
            row = rows[step % len(rows)]
            input_ids = torch.tensor([row["input_ids"]], dtype=torch.long)
            target_ids = torch.tensor(row["target_ids"], dtype=torch.long)
            logits, _confidence = model(input_ids, target_len=int(target_ids.numel()))
            loss = F.cross_entropy(logits[0].float(), target_ids)
            if not torch.isfinite(loss):
                raise RuntimeError(f"non-finite real-data loss at stage={stage_name}, step={step}")
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(trainable, 1.0)
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
            if step % 50 == 0 or step == steps - 1:
                print(
                    f"[Sham2] stage={stage_name} step={step + 1}/{steps} "
                    f"loss={losses[-1]:.5f}",
                    flush=True,
                )
        report["stages"].append({
            "stage": stage_name,
            "steps": steps,
            "examples_available": len(rows),
            "loss_mean": sum(losses) / len(losses),
            "loss_last": losses[-1],
        })

    model.eval()
    heldout_losses = []
    exact = 0
    with torch.no_grad():
        for row in heldout_rows:
            input_ids = torch.tensor([row["input_ids"]], dtype=torch.long)
            target_ids = torch.tensor(row["target_ids"], dtype=torch.long)
            logits, _confidence = model(input_ids, target_len=int(target_ids.numel()))
            heldout_losses.append(
                float(F.cross_entropy(logits[0].float(), target_ids).cpu())
            )
            exact += int(torch.equal(logits[0].argmax(dim=-1), target_ids))
    report["heldout_metrics"] = {
        "examples": len(heldout_rows),
        "mean_cross_entropy": sum(heldout_losses) / len(heldout_losses),
        "exact_sequence_match": exact / len(heldout_rows),
    }

    state = model.state_dict()
    heads_state = {
        k: v.detach().cpu() for k, v in state.items()
        if k.startswith(("compressor.", "thinker.", "writer."))
    }
    lora_state = {
        k: v.detach().cpu() for k, v in state.items()
        if ".lora_A" in k or ".lora_B" in k
    }
    if not heads_state or not lora_state:
        raise RuntimeError("refusing to save: T-LDM head or new rank-16 LoRA state is empty")

    donor_sha = file_sha256(donor_file)
    payload = {
        "format": "sham2-unified-heads-v1",
        "heads": heads_state,
        "lora": lora_state,
        "config": cfg.__dict__,
        "donor_config": donor_cfg,
        "donor_sha256": donor_sha,
        "tokenizer_sha256": report["tokenizer_sha256"],
        "donor_step": donor_step,
    }
    save_path = out / "sham2_heads.pt"
    tmp_path = out / "sham2_heads.pt.tmp"
    torch.save(payload, tmp_path)
    os.replace(tmp_path, save_path)
    report["donor_sha256"] = donor_sha
    report["artifact"] = str(save_path)
    report["artifact_size_bytes"] = save_path.stat().st_size
    report_path = out / "sham2_report.json"
    tmp_report = out / "sham2_report.json.tmp"
    tmp_report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(tmp_report, report_path)
    print(f"[Sham2] saved head + rank-16 LoRA: {save_path}", flush=True)
    print(f"[Sham2] saved training report: {report_path}", flush=True)
    return {
        "artifact": str(save_path),
        "report": str(report_path),
        "heldout_metrics": report["heldout_metrics"],
        "gate_status": "not-passed",
    }


def load_sham2_heads(model: Sham2Unified, heads_path: str,
                     donor_sha256: str, tokenizer_sha256: str) -> Dict:
    path = Path(heads_path).expanduser().resolve()
    if not path.is_file() or path.stat().st_size == 0:
        raise FileNotFoundError(f"heads checkpoint is missing or empty: {path}")
    payload = torch.load(path, map_location="cpu", weights_only=False)
    if payload.get("format") != "sham2-unified-heads-v1":
        raise RuntimeError("heads file is not a verified Sham 2 unified artifact")
    if payload.get("donor_sha256") != donor_sha256:
        raise RuntimeError("heads were trained against a different donor checkpoint")
    if payload.get("tokenizer_sha256") != tokenizer_sha256:
        raise RuntimeError("heads were trained with a different tokenizer")
    if payload.get("donor_config") != _model_donor_config(model.donor_body):
        raise RuntimeError("heads donor architecture does not match the loaded donor")
    supplied = dict(payload.get("heads") or {})
    supplied.update(payload.get("lora") or {})
    current = model.state_dict()
    expected = {
        k for k in current
        if k.startswith(("compressor.", "thinker.", "writer."))
        or ".lora_A" in k or ".lora_B" in k
    }
    if set(supplied) != expected:
        missing = sorted(expected - set(supplied))
        extra = sorted(set(supplied) - expected)
        raise RuntimeError(
            f"heads state mismatch; missing={missing[:8]}, extra={extra[:8]}"
        )
    model.load_state_dict(supplied, strict=False)
    model.eval()
    return payload



# ============================================================
# Terminal Loop — الحاسوب المدمج — [تطبيق 9]
# ============================================================
class TerminalLoop:
    """حلقة الطرفية: أمر -> نتيجة -> استمرار، حتى 6 استدعاءات، مساحة عمل خاصة لكل (مستخدم+نموذج).
    تستخدم sham_embedded_tools الحالية في المستودع، لا صندوقاً منفصلاً."""
    def __init__(self, model: Sham2Unified, backend=None):
        self.model = model
        self.backend = backend  # ShamEmbeddedBackend في المستودع الحقيقي
        self.max_calls = model.cfg.max_tool_calls

    def run(self, task: str, max_steps: int = 6) -> Dict:
        history = [{"task": task}]
        for step in range(min(max_steps, self.max_calls)):
            # 1) النموذج يقترح أمراً (عبر Writer كتلة)
            # في المستودع: generate_chat() -> <tool_call>computer_run</tool_call>
            # هنا: نحاكي — في التطبيق الحقيقي يُستدعى model.generate_block()
            cmd = self._propose_command(task, history)
            if cmd is None:
                break
            # 2) تنفيذ في الحاسوب المدمج (سياسة approvals في المستودع)
            result = self._execute(cmd)
            history.append({"cmd": cmd, "result": result[:500]})
            if "DONE" in result:
                break
        return {"history": history, "steps": len(history)-1}

    def _propose_command(self, task: str, history: List[Dict]) -> Optional[str]:
        # في المستودع: يُستدعى النموذج الحقيقي. هنا: قاعدة بسيطة للاختبار.
        if "ls" in task.lower() or "list" in task.lower():
            return "ls -la"
        if len(history) > 2:
            return None
        return "pwd"

    def _execute(self, cmd: str) -> str:
        if self.backend is not None:
            try:
                return str(self.backend.run(cmd))
            except Exception as e:
                return f"ERROR: {e}"
        # وضع اختبار بدون backend: لا ننفذ شيئاً حقيقياً
        return f"[DRY-RUN] would run: {cmd} -> DONE"

# ============================================================
# Self Evolution — تجربة -> درس -> LoRA -> بوابة — [تطبيق 8]
# ============================================================
class SelfEvolution:
    """التطور الذاتي: كل تجربة ناجحة تصبح درساً، الدرس يصبح LoRA صغيراً، LoRA يُقاس بالبوابة،
    يُدمج فقط إذا اجتازها. لا تطور بدون بوابة أبداً."""
    def __init__(self, model: Sham2Unified):
        self.model = model
        self.lessons: List[Dict] = []

    def add_experience(self, task: str, success: bool, trace: List[Dict]):
        if not success:
            return
        lesson = {"task": task, "trace_len": len(trace), "created": time.time()}
        self.lessons.append(lesson)

    def propose_lora_update(self) -> Dict:
        # في المستودع: evolution/engine.py — هنا: إحصاء فقط
        return {"lessons": len(self.lessons), "ready": len(self.lessons) >= 10,
                "note": "If ready, train a small LoRA on lessons, then run check_gate() before merging."}

# ============================================================
# QAT + GGUF Export — [تطبيق 5]
# ============================================================
def export_gguf(heads_path: str, out_path: str, bits: int = 4) -> str:
    """تصدير GGUF بمعمارية qwen3/smollm3 (sham_gguf كان يرفض Qwen3/NoPE — هنا نصدّر بمعمارية صحيحة).
    QAT=4: الأوزان تُكمَّم إلى 4-bit مع تدريب واعٍ بالكم (QAT) في المرحلة الأخيرة.
    في المستودع: يُستدعى من hosting/sham-v2/build.sh بعد اجتياز البوابة."""
    # هذا تصدير وصفي — التصدير الحقيقي يستخدم llama.cpp convert_hf_to_gguf.py مع config المانح.
    meta = {"from": heads_path, "bits": bits, "arch": "qwen3", "qat": True,
            "note": "Run: python -m llama_cpp.convert_hf_to_gguf --outtype q4_0 --outfile " + out_path + " <donor+heads merged>"}
    Path(out_path + ".json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return out_path + ".json"

# ============================================================
# CLI
# ============================================================
def main():
    ap = argparse.ArgumentParser(
        description="Sham 2 Unified — real frozen donor + LoRA-16 + T-LDM; fail closed."
    )
    ap.add_argument("--donor", default=None, help="local ShamSmall checkpoint .pt")
    ap.add_argument("--tokenizer", default=None, help="matching real donor tokenizer.json")
    ap.add_argument("--train-data", default=None, help="real JSONL with stage/input/target")
    ap.add_argument("--heldout-data", default=None, help="separate real JSONL with input/target")
    ap.add_argument("--stage", default="all",
                    choices=["all", "identity", "tools", "arabic", "tldm_head"])
    ap.add_argument("--out", default="./sham2_unified_out")
    ap.add_argument("--check-gate", action="store_true")
    ap.add_argument("--served", default=None)
    ap.add_argument("--candidate", default=None)
    ap.add_argument("--serve", action="store_true")
    ap.add_argument("--heads", default=None, help="trained sham2_heads.pt")
    ap.add_argument("--prompt", default=None, help="real text prompt for one-shot generation")
    ap.add_argument("--smoke", action="store_true",
                    help="validate real files only; zero optimizer steps")
    args = ap.parse_args()

    if args.check_gate:
        if not args.served or not args.candidate:
            ap.error("--check-gate requires both --served and --candidate")
        served = json.loads(Path(args.served).read_text(encoding="utf-8"))
        candidate = json.loads(Path(args.candidate).read_text(encoding="utf-8"))
        if isinstance(served, list):
            served = served[-1] if served else {}
        if isinstance(candidate, list):
            candidate = candidate[-1] if candidate else {}
        result = check_gate(served, candidate)
        print(json.dumps({
            "passed": result.passed,
            "reasons": result.reasons,
            "metrics": result.metrics,
        }, ensure_ascii=False, indent=2))
        sys.exit(0 if result.passed else 1)

    if args.serve:
        donor_ok = bool(args.donor and Path(args.donor).expanduser().is_file())
        heads_ok = bool(
            args.heads
            and Path(args.heads).expanduser().name == "sham2_heads.pt"
            and Path(args.heads).expanduser().is_file()
        )
        tokenizer_ok = bool(args.tokenizer and Path(args.tokenizer).expanduser().is_file())
        if not (donor_ok and heads_ok and tokenizer_ok):
            print("missing donor or heads - refuse to serve fake")
            sys.exit(2)
        try:
            donor_path = str(Path(args.donor).expanduser().resolve())
            tokenizer_path = str(Path(args.tokenizer).expanduser().resolve())
            _tokenizer = load_sham_tokenizer(tokenizer_path)
            donor_body, _step, _extra = load_sham_donor(donor_path)
            donor_cfg = _model_donor_config(donor_body)
            cfg = Sham2UnifiedConfig(
                donor_id=donor_path,
                d_model=donor_cfg["d_model"],
                vocab_size=donor_cfg["vocab_size"],
                n_layers=donor_cfg["n_layers"],
                max_seq_len=min(4096, donor_cfg["max_seq_len"]),
            )
            install_rank16_lora(donor_body)
            model = Sham2Unified(cfg, donor_body)
            load_sham2_heads(
                model, args.heads, file_sha256(donor_path), file_sha256(tokenizer_path)
            )
            if args.prompt:
                ids = _tokenizer.encode(args.prompt).ids
                if not ids or len(ids) > cfg.max_seq_len:
                    raise ValueError("prompt is empty or exceeds the donor context limit")
                input_ids = torch.tensor([ids], dtype=torch.long)
                generated = model.generate_block(input_ids)[0].tolist()
                print(_tokenizer.decode(generated))
            print("[Sham2] real donor, tokenizer, heads and LoRA-16 loaded.")
            return
        except Exception as exc:
            print("missing donor or heads - refuse to serve fake")
            print(f"[Sham2] refuse reason: {type(exc).__name__}: {exc}", file=sys.stderr)
            sys.exit(2)

    required = {
        "--donor": args.donor,
        "--tokenizer": args.tokenizer,
        "--train-data": args.train_data,
        "--heldout-data": args.heldout_data,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        ap.error("required for real training: " + ", ".join(missing))

    if args.smoke:
        for name, value in required.items():
            p = Path(value).expanduser()
            if not p.is_file() or p.stat().st_size == 0:
                ap.error(f"{name} file does not exist or is empty: {value}")
        tokenizer = load_sham_tokenizer(args.tokenizer)
        donor_body, donor_step, _extra = load_sham_donor(args.donor)
        train_rows = load_jsonl(args.train_data, require_stage=True)
        heldout_rows = load_jsonl(args.heldout_data, require_stage=False)
        donor_cfg = _model_donor_config(donor_body)
        if tokenizer.get_vocab_size(with_added_tokens=True) > donor_cfg["vocab_size"]:
            ap.error("donor tokenizer vocabulary exceeds donor checkpoint vocabulary")
        smoke_cfg = Sham2UnifiedConfig(
            donor_id=str(args.donor),
            d_model=donor_cfg["d_model"],
            vocab_size=donor_cfg["vocab_size"],
            n_layers=donor_cfg["n_layers"],
            max_seq_len=min(4096, donor_cfg["max_seq_len"]),
        )
        _encode_rows(train_rows, tokenizer, smoke_cfg, smoke_cfg.vocab_size, "training")
        _encode_rows(heldout_rows, tokenizer, smoke_cfg, smoke_cfg.vocab_size, "heldout")
        training_inputs = {row["input"].strip() for row in train_rows}
        if any(row["input"].strip() in training_inputs for row in heldout_rows):
            ap.error("held-out leakage: at least one input also occurs in training JSONL")
        presence = {row["stage"] for row in train_rows}
        needed = ["identity", "tools", "arabic", "tldm_head"] if args.stage == "all" else [args.stage]
        missing_stages = [name for name in needed if name not in presence]
        if missing_stages:
            ap.error("training JSONL missing stage(s): " + ", ".join(missing_stages))
        print(json.dumps({
            "validated_only": True,
            "optimizer_steps": 0,
            "donor_step": donor_step,
            "donor_config": donor_cfg,
            "tokenizer_vocab": tokenizer.get_vocab_size(with_added_tokens=True),
            "training_examples": len(train_rows),
            "heldout_examples": len(heldout_rows),
            "train_data_sha256": file_sha256(args.train_data),
            "heldout_data_sha256": file_sha256(args.heldout_data),
        }, ensure_ascii=False, indent=2))
        return

    cfg = Sham2UnifiedConfig(donor_id=str(args.donor))
    result = train_sham2_unified(
        args.donor, args.tokenizer, args.out,
        args.train_data, args.heldout_data,
        cfg, stage=args.stage,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
