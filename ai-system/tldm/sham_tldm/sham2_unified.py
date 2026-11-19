"""
SHAM 2 — UNIFIED SINGLE PATH — FAIL-CLOSED REAL-DATA IMPLEMENTATION
===================================================================
One model path only:
  * a read-only copy of the real ShamSmall donor checkpoint,
  * a new LoRA adapter of rank 16,
  * the T-LDM Compressor / Thinker / Writer head.

No random donor features, random token batches, synthetic target labels, or
proxy losses are permitted.

ModelScope inputs:
  repository: novaai2026/sham-v2
  donor file: final_merged.pt (read-only, never overwritten)
  tokenizer:  sham_small_tokenizer.json
Both files are resolved via ModelScope snapshot_download; the 51-byte
configuration.json is deliberately ignored.

JSONL export:
  python ai-system/tldm/data/export_sham2_jsonl.py --out <data-dir>

Training line (one JSON object per line):
  {"prompt":"...", "target":"...", "stage":"identity"}
Held-out line:
  {"prompt":"...", "target":"...", "source_set":"terminal_tasks.HELDOUT"}

The exporter writes identity.jsonl, terminal_tasks.jsonl, terminal_heldout.jsonl,
heldout2.jsonl, train.jsonl, heldout.jsonl, identity_heldout_prompts.jsonl
and manifest.json.
It never uses random generators or remote datasets. The manifest marks
tools and general Arabic as missing until fixed, acceptable sources exist.
The trainer refuses --stage all when any required stage is missing.\nA deliberate partial run is selected only with --stage available or --stage identity,terminal;\nit is always labelled "partial, not full" and never represented as stage all.
The prior result file tldm_heldout_gate_2026-11-18.json is NOT a dataset and
is NOT a fresh gate.

The current implementation has no real image/audio dataset loader. Media is
therefore excluded from --stage all and is explicitly reported as not trained;
it is never simulated using random or text-only data.

--donor and --tokenizer are ModelScope repository IDs (default
novaai2026/sham-v2); --data-dir points to the exported JSONL directory.
--smoke validates the real donor, tokenizer and datasets and performs
zero optimizer steps.
--serve requires the donor checkpoint, donor tokenizer and a matching
sham2_heads.pt; otherwise it prints:
  missing donor or heads - refuse to serve fake

The donor checkpoint is only read. Outputs are written to a separate directory.
"""

from __future__ import annotations
import argparse, importlib.metadata, inspect, json, math, os, random, socket, sys, time, traceback, urllib.error
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

# Script execution and package imports both resolve this sibling module.
from writer import DiffusionWriter as MaskedByteDiffusionWriter

BYTE_VOCAB = 257
BYTE_EOS = 0

# ============================================================
# CONFIG — شام 2 الواحد، إعداد واحد فقط
# ============================================================
@dataclass
class Sham2UnifiedConfig:
    # الجسم المانح — مجمّد دائماً، لا يُدرَّب أبداً
    donor_id: str = ""                         # لا يوجد مانح افتراضي؛ يجب تمرير checkpoint محلي موثّق
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
    block: int = 192                              # UTF-8 byte block: fits the longest fixed identity answer (184 bytes + EOS)
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
    batch: int = 1
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

def encode_target_bytes(text: str, block: int, label: str = "target") -> Tuple[List[int], List[bool]]:
    """Encode a target as UTF-8 bytes plus one EOS (0), with an explicit loss mask.

    Padding bytes remain 0 but are excluded from the objective; this keeps
    long identity replies and short shell commands in the same fixed block.
    """
    raw = str(text).encode("utf-8")
    if not raw:
        raise ValueError(f"{label} target is empty")
    if len(raw) + 1 > int(block):
        raise ValueError(
            f"{label} target needs {len(raw) + 1} bytes including EOS, block limit is {block}; refusing truncation"
        )
    ids = list(raw) + [BYTE_EOS]
    valid = [True] * len(ids)
    pad = int(block) - len(ids)
    return ids + [BYTE_EOS] * pad, valid + [False] * pad


def decode_target_bytes(tokens) -> str:
    """Decode generated UTF-8 bytes up to the first EOS/padding byte."""
    raw = bytearray()
    for token in tokens:
        value = int(token)
        if value == BYTE_EOS or value > 255:
            break
        if value < 0:
            raise ValueError(f"generated byte token is negative: {value}")
        raw.append(value)
    return bytes(raw).decode("utf-8", errors="replace").strip()


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
        # x: (B, T, d). Selective state-space recurrence, O(T).
        xz = self.in_proj(x)
        x_part, z = xz.chunk(2, dim=-1)
        x_conv = self.conv(x_part.transpose(1, 2))[:, :, :x.shape[1]].transpose(1, 2)
        x_act = F.silu(x_conv)

        # The input-dependent B, C and delta terms control each state update.
        b_c_dt = self.x_proj(x_act)
        b_t, c_t, dt_seed = torch.split(
            b_c_dt, [self.A.shape[1], self.A.shape[1], 1], dim=-1
        )
        dt = F.softplus(self.dt_proj(dt_seed))
        a_rate = F.softplus(self.A).unsqueeze(0)  # (1, d_inner, d_state)

        state = torch.zeros(
            x.shape[0], self.d_inner, self.A.shape[1],
            device=x.device, dtype=x.dtype
        )
        outputs = []
        for t in range(x_act.shape[1]):
            dt_t = dt[:, t, :].unsqueeze(-1)       # (B, d_inner, 1)
            decay = torch.exp(-dt_t * a_rate)      # (B, d_inner, d_state)
            b_now = torch.tanh(b_t[:, t, :]).unsqueeze(1)
            c_now = torch.tanh(c_t[:, t, :]).unsqueeze(1)
            state = state * decay + (
                x_act[:, t, :].unsqueeze(-1) * dt_t
            ) * b_now
            y_t = (state * c_now).sum(dim=-1) + self.D * x_act[:, t, :]
            outputs.append(y_t)

        y = torch.stack(outputs, dim=1)
        y = y * F.silu(z)
        return self.out_proj(y) + x

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
        self.layers = nn.ModuleList([
            nn.TransformerEncoderLayer(
                d_model=cfg.head_d, nhead=cfg.heads,
                dim_feedforward=cfg.head_d * 4, batch_first=True,
                activation="gelu"
            )
            for _ in range(2)
        ])
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
# ============================================================
# Diffusion Writer — reuse the project's masked discrete byte-diffusion implementation
# ============================================================
# The canonical writer owns token embeddings, per-position embeddings, a learned
# mask token, and cross-attention to the complete latent sequence. Its objective
# predicts randomly hidden target bytes rather than decoding 151k donor tokens
# from independent continuous noise.
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
    # ShamSmall's attention owns q/k/v/o; the MLP owns gate/up/down.
    # Keep this exact module map aligned with check_modelscope_donor().
    projection_targets = {
        "attention": ("q_proj", "k_proj", "v_proj", "o_proj"),
        "mlp": ("gate_proj", "up_proj", "down_proj"),
    }
    count = 0
    for layer_index, layer in enumerate(layers):
        for parent_name, projection_names in projection_targets.items():
            parent = getattr(layer, parent_name, None)
            if parent is None:
                raise RuntimeError(f"donor layer {layer_index} is missing {parent_name}")
            for name in projection_names:
                if not hasattr(parent, name):
                    raise RuntimeError(f"donor projection missing: layer {layer_index} {parent_name}.{name}")
                old = getattr(parent, name)
                if isinstance(old, Sham2LoRA16):
                    raise RuntimeError(f"rank-16 LoRA is already attached at layer {layer_index} {parent_name}.{name}")
                setattr(parent, name, Sham2LoRA16(old, rank=16, alpha=32.0))
                count += 1
    if count == 0:
        raise RuntimeError("no rank-16 LoRA targets were installed")
    return count


def sham_small_root() -> Path:
    """Find ShamSmall source in either the full Git checkout or the staged ModelScope Studio layout."""
    here = Path(__file__).resolve()
    candidates = (
        here.parents[2] / "sham_small",  # ModelScope Studio root contains tldm/ and sham_small/
        here.parents[3] / "ai-system" / "colab" / "sham_small",  # full Git checkout
    )
    for candidate in candidates:
        if (candidate / "model.py").is_file() and (candidate / "checkpoint.py").is_file():
            return candidate.resolve()
    raise FileNotFoundError(
        "canonical ShamSmall source not found: expected model.py and checkpoint.py in "
        "the Studio root/sham_small or Git checkout ai-system/colab/sham_small"
    )


MODELSCOPE_DONOR_REPO = "novaai2026/sham-v2"
MODELSCOPE_DONOR_FILENAME = "final_merged.pt"
MODELSCOPE_TOKENIZER_FILENAME = "sham_small_tokenizer.json"
MODELSCOPE_CN_ENDPOINT = "https://modelscope.cn"


def _modelscope_auth() -> Tuple[str, str]:
    """Return the existing CN-site token and matching endpoint; never fall back to the international token."""
    token = (
        os.environ.get("T_CN")
        or os.environ.get("MODELSCOPE_TOKEN")
        or os.environ.get("MODELSCOPE_API_TOKEN")
        or ""
    ).strip()
    if not token:
        raise RuntimeError(
            "ModelScope CN credential is missing: supply the repository's existing MODELSCOPE_TOKEN secret as T_CN"
        )
    endpoint = (os.environ.get("MODELSCOPE_ENDPOINT") or "").strip().rstrip("/")
    if not endpoint:
        domain = (os.environ.get("MODELSCOPE_DOMAIN") or "modelscope.cn").strip()
        endpoint = domain if domain.startswith("http") else "https://" + domain
    if "modelscope.ai" in endpoint:
        raise RuntimeError(
            f"wrong ModelScope site for private CN donor {MODELSCOPE_DONOR_REPO}: endpoint={endpoint}"
        )
    return token, endpoint


def _modelscope_transient_error(exc: Exception) -> bool:
    """Only network/temporary HTTP failures are retryable; code and validation errors never are."""
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status is None:
        status = getattr(exc, "code", None)
    if isinstance(status, int):
        return status in {408, 425, 429} or 500 <= status <= 599
    if isinstance(exc, (TimeoutError, ConnectionError, socket.timeout, urllib.error.URLError)):
        return True
    try:
        import requests
        if isinstance(exc, (requests.exceptions.Timeout, requests.exceptions.ConnectionError)):
            return True
        if isinstance(exc, requests.exceptions.HTTPError):
            code = getattr(getattr(exc, "response", None), "status_code", None)
            return isinstance(code, int) and (code in {408, 425, 429} or 500 <= code <= 599)
    except Exception:
        pass
    return False


def _snapshot_download_compatible(snapshot_download, model_id: str, patterns: List[str],
                                  token: str, endpoint: str,
                                  diagnostics: Dict | None = None,
                                  max_attempts: int = 3, sleep_fn=time.sleep) -> str:
    """Call the installed ModelScope SDK using only parameters in its actual runtime signature.

    ModelScope 1.34/1.38 and later releases differ in whether endpoint= is accepted.
    MODELSCOPE_API_TOKEN / MODELSCOPE_ENDPOINT remain the canonical fallback for older SDKs.
    """
    signature = inspect.signature(snapshot_download)
    parameters = signature.parameters
    names = set(parameters)
    pattern_arg = "allow_file_pattern" if "allow_file_pattern" in names else (
        "allow_patterns" if "allow_patterns" in names else None
    )
    if pattern_arg is None:
        raise TypeError(
            "installed modelscope.hub.snapshot_download.snapshot_download signature "
            f"{signature} accepts neither allow_file_pattern nor allow_patterns"
        )

    kwargs = {pattern_arg: list(patterns)}
    if "max_workers" in names:
        kwargs["max_workers"] = 1
    if "token" in names:
        kwargs["token"] = token
        auth_mode = "token-parameter"
    elif "cookies" in names:
        # Older SDK releases use the same ModelScope session cookie that
        # HubApi.get_cookies() creates from an access token.
        from requests.cookies import RequestsCookieJar
        from urllib.parse import urlparse
        cookie_jar = RequestsCookieJar()
        cookie_jar.set("m_session_id", token, domain=urlparse(endpoint).hostname, path="/")
        kwargs["cookies"] = cookie_jar
        auth_mode = "m_session_id-cookie"
    else:
        raise TypeError(
            "installed ModelScope snapshot_download exposes neither token= nor cookies=; "
            "refusing an unauthenticated private-donor request"
        )
    if "endpoint" in names:
        kwargs["endpoint"] = endpoint

    if diagnostics is not None:
        diagnostics["snapshot_download_auth_mode"] = auth_mode
        try:
            diagnostics["modelscope_version"] = importlib.metadata.version("modelscope")
        except importlib.metadata.PackageNotFoundError:
            diagnostics["modelscope_version"] = "unknown"
        diagnostics["snapshot_download_signature"] = str(signature)
        diagnostics["snapshot_download_parameters"] = sorted(names)
        diagnostics["snapshot_download_kwargs_used"] = sorted(kwargs)
        diagnostics["snapshot_download_env_fallbacks"] = [
            name for name in ("endpoint",) if name not in kwargs
        ]

    for attempt in range(1, max(1, int(max_attempts)) + 1):
        if diagnostics is not None:
            diagnostics["download_attempts"] = attempt
        try:
            return snapshot_download(model_id, **kwargs)
        except (TypeError, ValueError):
            # These indicate an API/signature or validation bug, not a transient network issue.
            raise
        except Exception as exc:
            if attempt >= max_attempts or not _modelscope_transient_error(exc):
                raise
            print(
                f"[Sham2] transient ModelScope download failure "
                f"{attempt}/{max_attempts}: {type(exc).__name__}: {exc}",
                flush=True,
            )
            sleep_fn(min(2 ** attempt, 5))
    raise RuntimeError("unreachable ModelScope snapshot retry state")


def _snapshot_file(snapshot_root: str | Path, filename: str) -> Path:
    root = Path(snapshot_root).expanduser().resolve()
    direct = root / filename
    if direct.is_file() and direct.stat().st_size > 0:
        return direct
    matches = [p for p in root.rglob(filename) if p.is_file() and p.stat().st_size > 0]
    if len(matches) != 1:
        raise FileNotFoundError(
            f"expected exactly one non-empty {filename} under ModelScope snapshot {root}; found {len(matches)}"
        )
    return matches[0].resolve()


def resolve_modelscope_inputs(donor_model_id: str, tokenizer_model_id: str) -> Tuple[Path, Path]:
    """Download only the named donor checkpoint and tokenizer from the CN ModelScope Hub."""
    if not donor_model_id or not tokenizer_model_id:
        raise ValueError("both --donor and --tokenizer ModelScope repository IDs are required")
    token, endpoint = _modelscope_auth()
    # Set these before importing ModelScope: older SDKs read Hub endpoint and
    # credentials from environment/config rather than accepting endpoint= or token=.
    os.environ["MODELSCOPE_API_TOKEN"] = token
    os.environ["MODELSCOPE_ENDPOINT"] = endpoint
    os.environ["MODELSCOPE_DOMAIN"] = endpoint.split("://", 1)[-1].split("/", 1)[0]
    try:
        from modelscope.hub.snapshot_download import snapshot_download
    except Exception as exc:
        raise RuntimeError(
            "ModelScope SDK is unavailable; install the official modelscope package in the execution environment"
        ) from exc

    def download(model_id: str, patterns: List[str]) -> str:
        return _snapshot_download_compatible(
            snapshot_download, model_id, patterns, token, endpoint
        )

    if donor_model_id == tokenizer_model_id:
        snapshot_root = download(
            donor_model_id,
            [MODELSCOPE_DONOR_FILENAME, MODELSCOPE_TOKENIZER_FILENAME],
        )
        donor_path = _snapshot_file(snapshot_root, MODELSCOPE_DONOR_FILENAME)
        tokenizer_path = _snapshot_file(snapshot_root, MODELSCOPE_TOKENIZER_FILENAME)
    else:
        donor_root = download(donor_model_id, [MODELSCOPE_DONOR_FILENAME])
        tokenizer_root = download(tokenizer_model_id, [MODELSCOPE_TOKENIZER_FILENAME])
        donor_path = _snapshot_file(donor_root, MODELSCOPE_DONOR_FILENAME)
        tokenizer_path = _snapshot_file(tokenizer_root, MODELSCOPE_TOKENIZER_FILENAME)
    return donor_path, tokenizer_path


def load_sham_donor(donor_path: str) -> Tuple[nn.Module, int, Dict]:
    """Load a real, self-describing ShamSmall checkpoint through its canonical loader."""
    path = Path(donor_path).expanduser().resolve()
    if not path.is_file() or path.stat().st_size == 0:
        raise FileNotFoundError(f"donor checkpoint is missing or empty: {path}")
    sham_dir = sham_small_root()
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
    body.cfg.use_gradient_checkpointing = True
    body.eval()
    return body, int(step), extra or {}


def check_modelscope_donor(donor_model_id: str) -> Dict:
    """Download and inspect only final_merged.pt; no tokenizer, optimizer, or training is involved."""
    report = {
        "model_id": donor_model_id,
        "filename": MODELSCOPE_DONOR_FILENAME,
        "authentication": "explicit ModelScope CN site token (value never logged)",
        "status": "not_checked",
        "compatible": None,
        "reasons": [],
        "file_size_bytes": None,
        "checkpoint_sha256": None,
        "checkpoint_root_keys": [],
        "tensor_count": 0,
        "dtype_counts": {},
        "tensors": [],
        "missing_keys": [],
        "unexpected_keys": [],
        "shape_mismatches": [],
        "dtype_mismatches": [],
        "modelscope_version": None,
        "snapshot_download_signature": None,
        "snapshot_download_parameters": [],
        "snapshot_download_kwargs_used": [],
        "snapshot_download_env_fallbacks": [],
        "download_attempts": 0,
        "failure_kind": None,
        "traceback": None,
    }
    try:
        token, endpoint = _modelscope_auth()
        report["endpoint"] = endpoint
        # The dedicated CN Studio provides MODELSCOPE_TOKEN. Set the SDK's
        # standard environment configuration before importing it; pass named
        # arguments only when the installed function signature supports them.
        os.environ["MODELSCOPE_API_TOKEN"] = token
        os.environ["MODELSCOPE_ENDPOINT"] = endpoint
        os.environ["MODELSCOPE_DOMAIN"] = endpoint.split("://", 1)[-1].split("/", 1)[0]
        from modelscope.hub.snapshot_download import snapshot_download
        try:
            installed_version = importlib.metadata.version("modelscope")
        except importlib.metadata.PackageNotFoundError:
            installed_version = "unknown"
        print(
            "[Sham2] ModelScope donor preflight SDK: "
            + json.dumps({
                "version": installed_version,
                "snapshot_download_signature": str(inspect.signature(snapshot_download)),
            }, ensure_ascii=False),
            flush=True,
        )
        snapshot_root = _snapshot_download_compatible(
            snapshot_download,
            donor_model_id,
            [MODELSCOPE_DONOR_FILENAME],
            token,
            endpoint,
            diagnostics=report,
            max_attempts=3,
        )
        donor_path = _snapshot_file(snapshot_root, MODELSCOPE_DONOR_FILENAME)
        report["file_size_bytes"] = donor_path.stat().st_size
        if report["file_size_bytes"] > 0:
            report["checkpoint_sha256"] = file_sha256(donor_path)
        if report["file_size_bytes"] <= 0:
            report["status"] = "incompatible"
            report["compatible"] = False
            report["reasons"].append("final_merged.pt is empty")
            return report
    except (TypeError, ValueError) as exc:
        report["status"] = "error"
        report["compatible"] = None
        report["failure_kind"] = "code-error"
        report["reasons"].append(
            f"ModelScope API/signature validation failed: {type(exc).__name__}: {exc}"
        )
        trace = traceback.format_exc()
        token = os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN") or ""
        report["traceback"] = trace.replace(token, "***") if token else trace
        return report
    except Exception as exc:
        report["failure_kind"] = (
            "transient-network" if _modelscope_transient_error(exc) else "runtime-error"
        )
        report["reasons"].append(
            f"ModelScope donor download/resolve failed: {type(exc).__name__}: {exc}"
        )
        trace = traceback.format_exc()
        token = os.environ.get("MODELSCOPE_API_TOKEN") or os.environ.get("MODELSCOPE_TOKEN") or ""
        report["traceback"] = trace.replace(token, "***") if token else trace
        return report

    try:
        payload = torch.load(
            str(donor_path), map_location="cpu", weights_only=False, mmap=True
        )
    except Exception as exc:
        report["status"] = "incompatible"
        report["compatible"] = False
        report["reasons"].append(
            f"PyTorch mmap checkpoint read failed: {type(exc).__name__}: {exc}"
        )
        return report

    if not isinstance(payload, dict):
        report["status"] = "incompatible"
        report["compatible"] = False
        report["reasons"].append(
            f"checkpoint root must be a dict, got {type(payload).__name__}"
        )
        return report

    report["checkpoint_root_keys"] = sorted(str(k) for k in payload.keys())
    config_data = payload.get("config")
    state = payload.get("model_state_dict")
    if not isinstance(config_data, dict):
        report["status"] = "incompatible"
        report["compatible"] = False
        report["reasons"].append(
            "missing/invalid top-level 'config'; canonical checkpoint.load_checkpoint requires config"
        )
        return report
    if not isinstance(state, dict) or not state:
        report["status"] = "incompatible"
        report["compatible"] = False
        report["reasons"].append(
            "missing/empty top-level 'model_state_dict'; canonical checkpoint.load_checkpoint requires model_state_dict"
        )
        return report

    dtype_counts = {}
    non_tensor_keys = []
    for name, tensor in state.items():
        if not isinstance(tensor, torch.Tensor):
            non_tensor_keys.append(str(name))
            continue
        dtype_name = str(tensor.dtype)
        dtype_counts[dtype_name] = dtype_counts.get(dtype_name, 0) + 1
        report["tensors"].append({
            "name": str(name),
            "shape": list(tensor.shape),
            "dtype": dtype_name,
        })
    report["tensor_count"] = len(report["tensors"])
    report["dtype_counts"] = dtype_counts
    if non_tensor_keys:
        report["status"] = "incompatible"
        report["compatible"] = False
        report["reasons"].append(
            "model_state_dict contains non-tensor entries: " + ", ".join(non_tensor_keys[:20])
        )
        return report

    try:
        sham_dir = sham_small_root()
        if str(sham_dir) not in sys.path:
            sys.path.insert(0, str(sham_dir))
        from model import ShamSmall, ShamSmallConfig
        cfg_obj = ShamSmallConfig.from_dict(config_data)
        previous_dtype = torch.get_default_dtype()
        try:
            torch.set_default_dtype(torch.bfloat16)
            with torch.device("meta"):
                expected_model = ShamSmall(cfg_obj)
        finally:
            torch.set_default_dtype(previous_dtype)
        expected_state = expected_model.state_dict()
        expected_keys = set(expected_state)
        actual_keys = set(state)
        report["missing_keys"] = sorted(expected_keys - actual_keys)
        report["unexpected_keys"] = sorted(actual_keys - expected_keys)
        for name in sorted(expected_keys & actual_keys):
            expected_tensor = expected_state[name]
            actual_tensor = state[name]
            if tuple(expected_tensor.shape) != tuple(actual_tensor.shape):
                report["shape_mismatches"].append({
                    "name": name,
                    "expected": list(expected_tensor.shape),
                    "actual": list(actual_tensor.shape),
                })
            if expected_tensor.dtype != actual_tensor.dtype:
                report["dtype_mismatches"].append({
                    "name": name,
                    "expected": str(expected_tensor.dtype),
                    "actual": str(actual_tensor.dtype),
                })
        report["donor_config"] = {
            "d_model": int(cfg_obj.d_model),
            "vocab_size": int(cfg_obj.vocab_size),
            "n_layers": int(cfg_obj.n_layers),
            "max_seq_len": int(cfg_obj.max_seq_len),
        }
        del expected_state, expected_model
    except Exception as exc:
        report["status"] = "incompatible"
        report["compatible"] = False
        report["reasons"].append(
            f"ShamSmall config/model comparison failed: {type(exc).__name__}: {exc}"
        )
        return report

    structural_errors = []
    if report["missing_keys"]:
        structural_errors.append(f"{len(report['missing_keys'])} missing model_state_dict keys")
    if report["unexpected_keys"]:
        structural_errors.append(f"{len(report['unexpected_keys'])} unexpected model_state_dict keys")
    if report["shape_mismatches"]:
        structural_errors.append(f"{len(report['shape_mismatches'])} tensor shape mismatches")
    if report["dtype_mismatches"]:
        structural_errors.append(f"{len(report['dtype_mismatches'])} tensor dtype mismatches against the canonical BF16 ShamSmall layout")
    if structural_errors:
        report["status"] = "incompatible"
        report["compatible"] = False
        report["reasons"].extend(structural_errors)
        return report

    del payload, state
    try:
        body, step, extra = load_sham_donor(str(donor_path))
        required_projection_names = (
            "q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"
        )
        projection_errors = []
        for index, layer in enumerate(body.layers):
            for parent_name, names in (("attention", required_projection_names[:4]), ("mlp", required_projection_names[4:])):
                parent = getattr(layer, parent_name, None)
                if parent is None:
                    projection_errors.append(f"layer {index} missing {parent_name}")
                    continue
                for name in names:
                    module = getattr(parent, name, None)
                    leaf = module
                    while not isinstance(leaf, nn.Linear) and hasattr(leaf, "base"):
                        leaf = leaf.base
                    if not isinstance(leaf, nn.Linear):
                        projection_errors.append(f"layer {index} {parent_name}.{name} is not backed by nn.Linear")
        if projection_errors:
            report["status"] = "incompatible"
            report["compatible"] = False
            report["reasons"].extend(projection_errors[:40])
            del body
            return report
        report["status"] = "compatible"
        report["compatible"] = True
        report["loaded_by_canonical_checkpoint_loader"] = True
        report["donor_step"] = int(step)
        report["donor_parameter_dtype_counts"] = {}
        for parameter in body.parameters():
            key = str(parameter.dtype)
            report["donor_parameter_dtype_counts"][key] = (
                report["donor_parameter_dtype_counts"].get(key, 0) + 1
            )
        report["donor_extra_keys"] = sorted(str(k) for k in extra.keys()) if isinstance(extra, dict) else []
        del body
    except Exception as exc:
        report["status"] = "incompatible"
        report["compatible"] = False
        report["reasons"].append(
            f"canonical checkpoint.load_checkpoint validation failed: {type(exc).__name__}: {exc}"
        )
    return report


def run_check_donor(donor_model_id: str, report_path: str | None = None) -> int:
    """CLI wrapper with stable output, persisted full tensor inventory, and distinct exit statuses."""
    try:
        report = check_modelscope_donor(donor_model_id)
    except Exception as exc:
        report = {
            "model_id": donor_model_id,
            "filename": MODELSCOPE_DONOR_FILENAME,
            "status": "error" if isinstance(exc, (TypeError, ValueError)) else "not_checked",
            "compatible": None,
            "failure_kind": "code-error" if isinstance(exc, (TypeError, ValueError)) else "runtime-error",
            "reasons": [f"unexpected checker failure: {type(exc).__name__}: {exc}"],
            "traceback": traceback.format_exc(),
        }
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if report_path:
        target = Path(report_path).expanduser().resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".tmp")
        temporary.write_text(rendered + "\n", encoding="utf-8")
        os.replace(temporary, target)
    print(rendered, flush=True)
    if report.get("status") == "compatible":
        return 0
    if report.get("status") == "incompatible":
        return 2
    return 3


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
            for key in ("prompt", "target"):
                if not isinstance(item.get(key), str) or not item[key].strip():
                    raise ValueError(f"missing non-empty {key!r} at {p}:{line_no}")
            if require_stage:
                stage_name = str(item.get("stage", "")).strip().lower()
                if stage_name == "tldm_head":
                    stage_name = "terminal"  # read older exported files without relabelling them as tools
                if stage_name not in ("identity", "tools", "arabic", "terminal"):
                    raise ValueError(
                        f"invalid/missing stage at {p}:{line_no}; expected identity/tools/arabic/terminal"
                    )
                item["stage"] = stage_name
            rows.append(item)
    if not rows:
        raise ValueError(f"dataset contains no usable examples: {p}")
    return rows


FULL_TRAINING_STAGES = ("identity", "tools", "arabic", "terminal")
AVAILABLE_TRAINING_STAGES = ("identity", "terminal")


def parse_training_stages(stage: str) -> List[str]:
    """Resolve an explicit training scope. 'all' is never an alias for partial training."""
    raw = str(stage or "").strip().lower()
    if raw == "all":
        return list(FULL_TRAINING_STAGES)
    if raw == "available":
        return list(AVAILABLE_TRAINING_STAGES)
    requested = [part.strip() for part in raw.split(",") if part.strip()]
    if not requested:
        raise ValueError("stage must be all, available, or a comma-separated list such as identity,terminal")
    requested = ["terminal" if name == "tldm_head" else name for name in requested]
    invalid = sorted(set(requested) - set(FULL_TRAINING_STAGES))
    if invalid:
        raise ValueError(
            f"unsupported training stage(s): {', '.join(invalid)}; "
            "supported: identity,terminal,tools,arabic,available,all"
        )
    if len(requested) != len(set(requested)):
        raise ValueError("duplicate stages are not allowed")
    return requested


STAGE_ADMISSION_MINIMUMS = {
    "tools": {"train": 1000, "heldout": 100, "per_tool": 20},
    "arabic": {"train": 10000, "heldout": 1000, "arabic_fraction": 0.90},
}


def validate_stage_record_minimums(
    train_rows: List[Dict], heldout_rows: List[Dict], requested_stages: List[str]
) -> None:
    """Enforce published record floors and provenance fields before any donor download."""
    if "tools" in requested_stages:
        limits = STAGE_ADMISSION_MINIMUMS["tools"]
        tool_train = [row for row in train_rows if row.get("stage") == "tools"]
        tool_heldout = [row for row in heldout_rows if row.get("stage") == "tools"]
        if len(tool_train) < limits["train"]:
            raise ValueError(
                f"tools stage requires at least {limits['train']} real training records; found {len(tool_train)}"
            )
        if len(tool_heldout) < limits["heldout"]:
            raise ValueError(
                f"tools stage requires at least {limits['heldout']} held-out records with stage='tools'; found {len(tool_heldout)}"
            )
        per_tool: Dict[str, int] = {}
        for index, row in enumerate(tool_train, 1):
            tool_name = str(row.get("tool_name", "")).strip()
            if not tool_name:
                raise ValueError(f"tools training record {index} is missing tool_name")
            per_tool[tool_name] = per_tool.get(tool_name, 0) + 1
            if not isinstance(row.get("tool_arguments"), dict):
                raise ValueError(f"tools training record {index} is missing actual tool_arguments object")
            if not isinstance(row.get("tool_result"), dict):
                raise ValueError(f"tools training record {index} is missing observed tool_result object")
            if not str(row.get("trace_id", "")).strip():
                raise ValueError(f"tools training record {index} is missing trace_id")
            if not str(row.get("source", "")).strip() or not str(row.get("source_revision", "")).strip():
                raise ValueError(f"tools training record {index} is missing source provenance")
            if row.get("approval") not in ("approved", "denied", "not_required"):
                raise ValueError(f"tools training record {index} has invalid/missing approval state")
        sparse = [name for name, count in sorted(per_tool.items()) if count < limits["per_tool"]]
        if sparse:
            raise ValueError(
                f"tools stage requires at least {limits['per_tool']} training records per exposed tool; "
                + ", ".join(f"{name}={per_tool[name]}" for name in sparse)
            )

    if "arabic" in requested_stages:
        limits = STAGE_ADMISSION_MINIMUMS["arabic"]
        arabic_train = [row for row in train_rows if row.get("stage") == "arabic"]
        arabic_heldout = [row for row in heldout_rows if row.get("stage") == "arabic"]
        if len(arabic_train) < limits["train"]:
            raise ValueError(
                f"arabic stage requires at least {limits['train']} fixed training records; found {len(arabic_train)}"
            )
        if len(arabic_heldout) < limits["heldout"]:
            raise ValueError(
                f"arabic stage requires at least {limits['heldout']} held-out records with stage='arabic'; found {len(arabic_heldout)}"
            )
        for label, rows in (("training", arabic_train), ("held-out", arabic_heldout)):
            for index, row in enumerate(rows, 1):
                for key in ("source_dataset", "source_config", "source_revision", "source_record_id", "split"):
                    if not str(row.get(key, "")).strip():
                        raise ValueError(f"arabic {label} record {index} is missing {key}")
                expected_split = "train" if label == "training" else "heldout"
                if row.get("split") != expected_split:
                    raise ValueError(
                        f"arabic {label} record {index} must have split={expected_split!r}"
                    )
                if row.get("language") not in ("ar", "en", "mixed"):
                    raise ValueError(f"arabic {label} record {index} has invalid/missing language tag")
        arabic_fraction = sum(row.get("language") == "ar" for row in arabic_train) / len(arabic_train)
        if arabic_fraction < limits["arabic_fraction"]:
            raise ValueError(
                f"arabic stage requires at least {limits['arabic_fraction']:.0%} Arabic target records; "
                f"found {arabic_fraction:.1%}"
            )


def resolve_data_dir(data_dir: str | Path, stage: str) -> Tuple[Path, Path, Dict]:
    """Validate only the requested scope; 'all' still fails closed on missing tools/Arabic."""
    root = Path(data_dir).expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"JSONL data directory does not exist: {root}")
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file() or manifest_path.stat().st_size == 0:
        raise FileNotFoundError(
            f"JSONL manifest is missing: {manifest_path}; run export_sham2_jsonl.py first"
        )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    stages = parse_training_stages(stage)
    source_status = manifest.get("stages")
    if not isinstance(source_status, dict):
        raise ValueError("data manifest has no valid 'stages' map")
    missing = []
    for name in stages:
        item = source_status.get(name)
        if name == "terminal" and not isinstance(item, dict):
            item = source_status.get("tldm_head")  # compatibility with an older manifest only
        if not isinstance(item, dict) or item.get("status") != "available":
            reason = item.get("reason", "no fixed source declared") if isinstance(item, dict) else "no source declared"
            missing.append(f"{name}: {reason}")
    if missing:
        raise ValueError(
            "refusing to train; required fixed data stage(s) are missing:\n - "
            + "\n - ".join(missing)
        )
    train_path = root / "train.jsonl"
    heldout_path = root / "heldout.jsonl"
    for p in (train_path, heldout_path):
        if not p.is_file() or p.stat().st_size == 0:
            raise FileNotFoundError(f"required JSONL file is missing or empty: {p}")
    # Validate the actual JSONL rows as well as manifest claims before the
    # CLI downloads the 4.15-GB donor snapshot.
    train_rows = load_jsonl(str(train_path), require_stage=True)
    present = {row["stage"] for row in train_rows}
    missing_rows = [name for name in stages if name not in present]
    if missing_rows:
        raise ValueError(
            "refusing to train; train.jsonl has no rows for stage(s): "
            + ", ".join(missing_rows)
        )
    heldout_rows = load_jsonl(str(heldout_path), require_stage=False)
    validate_stage_record_minimums(train_rows, heldout_rows, stages)
    return train_path, heldout_path, manifest


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
        input_ids = tokenizer.encode(row["prompt"]).ids
        if not input_ids:
            raise ValueError(f"{label} row {i} tokenized to an empty input")
        if len(input_ids) > cfg.max_seq_len:
            raise ValueError(f"{label} row {i} input has {len(input_ids)} tokens, limit is {cfg.max_seq_len}")
        if min(input_ids) < 0 or max(input_ids) >= vocab_size:
            raise ValueError(f"{label} row {i} contains prompt token IDs outside donor vocabulary {vocab_size}")
        target_ids, valid_mask = encode_target_bytes(
            row["target"], cfg.block, f"{label} row {i}"
        )
        encoded.append({
            "input_ids": input_ids,
            "target_ids": target_ids,
            "valid_mask": valid_mask,
            "target_bytes": sum(valid_mask) - 1,
            "stage": row.get("stage"),
        })
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
        # The v3 target contract is UTF-8 byte diffusion (257 classes),
        # not donor-token vocabulary prediction. Keep the donor tokenizer
        # exclusively on the frozen reader/input side.
        self.writer = MaskedByteDiffusionWriter(
            d=cfg.head_d,
            block=cfg.block,
            vocab=BYTE_VOCAB,
            layers=cfg.writer_layers,
            heads=cfg.heads,
        )
        # SpeculativeDraft in this file is an unfinished prototype, not part
        # of the requested trainable contract, so it is not instantiated.
        self.draft = None

    def train(self, mode: bool = True):
        super().train(mode)
        self.donor_body.eval()
        # Enable ShamSmall's non-reentrant activation checkpoint path while
        # keeping all donor submodules in eval mode (no stochastic train layers).
        self.donor_body.training = bool(
            mode and getattr(self.donor_body.cfg, "use_gradient_checkpointing", False)
        )
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
        """Run the real donor blocks and return hidden features without a giant LM-logit tensor."""
        body = self.donor_body
        if not all(hasattr(body, name) for name in ("token_embedding", "layers", "final_norm", "rope_cos", "rope_sin")):
            raise RuntimeError("donor is missing the ShamSmall hidden-state execution interface")
        batch, seq_len = input_ids.shape
        if seq_len > body.cfg.max_seq_len:
            raise ValueError(
                f"input length {seq_len} exceeds donor max_seq_len {body.cfg.max_seq_len}"
            )
        hidden = body.token_embedding(input_ids)
        cos = body.rope_cos.to(hidden.device)
        sin = body.rope_sin.to(hidden.device)
        use_checkpointing = bool(
            body.cfg.use_gradient_checkpointing and body.training
        )
        if use_checkpointing:
            from torch.utils.checkpoint import checkpoint
        for layer in body.layers:
            if use_checkpointing:
                hidden, _cache = checkpoint(
                    layer, hidden, cos, sin, None, False, use_reentrant=False
                )
            else:
                hidden, _cache = layer(
                    hidden, cos, sin, past_kv=None, use_cache=False
                )
        features = body.final_norm(hidden)
        if features.ndim != 3 or features.shape[0] != batch or features.shape[-1] != self.cfg.d_model:
            raise RuntimeError(
                f"donor feature shape mismatch: expected (B,T,{self.cfg.d_model}), got {tuple(features.shape)}"
            )
        return features

    def encode_latents(self, input_ids: torch.Tensor,
                       attention_mask: torch.Tensor | None = None) -> torch.Tensor:
        """Encode a prompt through the real donor and T-LDM into writer context."""
        features = self.body_features(input_ids, attention_mask).float()
        compressed = self.compressor(features)
        return self.thinker(compressed)

    def forward(self, input_ids: torch.Tensor,
                attention_mask: torch.Tensor | None = None) -> torch.Tensor:
        # Training and the fresh gate consume latent context, then explicitly
        # call writer.loss/logits/generate. Never route byte targets through
        # the donor-token vocabulary or invoke an absent Writer.forward().
        return self.encode_latents(input_ids, attention_mask)

    @torch.no_grad()
    def generate_block(self, input_ids: torch.Tensor, steps: int | None = None) -> torch.Tensor:
        """Return generated UTF-8 byte IDs from the masked discrete writer."""
        self.eval()
        latents = self.encode_latents(input_ids)
        return self.writer.generate(
            latents,
            steps=int(steps or self.cfg.diffusion_steps),
            temperature=0.0,
        )

# ============================================================
# Codebook Init للوسائط — [إصلاح 3]
# ============================================================
def init_media_codebook(model: Sham2Unified, image_codebook: torch.Tensor | None = None,
                        audio_codebook: torch.Tensor | None = None, seed: int = 0):
    """Media codebook initialization is not implemented in this unified path."""
    raise NotImplementedError(
        "real image/audio codebook loading and alignment are not implemented; "
        "refusing to report a media initialization that did not happen"
    )

def apply_codebook_to_donor_embedding(donor_embedding: torch.Tensor, codebook: torch.Tensor,
                                      base: int, n: int, seed: int = 0) -> torch.Tensor:
    """Return a transformed copy; never mutate the supplied donor embedding."""
    if codebook.ndim != 2 or donor_embedding.ndim != 2:
        raise ValueError("donor embedding and codebook must both be rank-2 tensors")
    if base < 0 or n <= 0 or base + n > donor_embedding.shape[0]:
        raise ValueError("requested media-token range is outside the embedding table")
    if codebook.shape[0] < n:
        raise ValueError(f"codebook has {codebook.shape[0]} rows but {n} are required")
    g = torch.Generator(device="cpu").manual_seed(seed)
    C = codebook[:n].detach().float().cpu()
    C = (C - C.mean(0)) / (C.std() + 1e-8)
    d = donor_embedding.shape[1]
    if C.shape[1] > d:
        # (code_dim, model_dim)
        projection = torch.linalg.qr(
            torch.randn(C.shape[1], d, generator=g)
        ).Q
        X = C @ projection
    elif C.shape[1] < d:
        # QR on (model_dim, code_dim), then transpose to (code_dim, model_dim).
        projection = torch.linalg.qr(
            torch.randn(d, C.shape[1], generator=g)
        ).Q.T
        X = C @ projection
    else:
        X = C
    out = donor_embedding.detach().clone()
    source = donor_embedding[:min(151936, donor_embedding.shape[0])].detach().float()
    mean, std = source.mean(0), source.std().clamp_min(1e-8)
    out[base:base+n] = (mean + X.to(mean.device) * (0.1 * std)).to(out.dtype)
    return out

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
    elif not 0.0 <= float(h) <= 1.0:
        reasons.append("candidate heldout_same_effect must be within [0, 1]")
    elif h < heldout_min:
        reasons.append(f"heldout {h:.3f} < {heldout_min} — T-LDM head did not pass heldout")

    served_bpb = served.get("bpb_after") or served.get("bpb_before")
    candidate_bpb = candidate.get("bpb_after")
    if not isinstance(served_bpb, dict) or not isinstance(candidate_bpb, dict):
        reasons.append("missing served/candidate Arabic+English bits-per-byte measurements")
    else:
        for lang in ("ar", "en"):
            if (
                not isinstance(served_bpb.get(lang), (int, float))
                or not isinstance(candidate_bpb.get(lang), (int, float))
                or not math.isfinite(float(served_bpb.get(lang, float("nan"))))
                or not math.isfinite(float(candidate_bpb.get(lang, float("nan"))))
                or served_bpb.get(lang, 0) <= 0
                or candidate_bpb.get(lang, 0) <= 0
            ):
                reasons.append(f"missing/invalid finite positive {lang} bits-per-byte baseline or candidate metric")
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
            if (
                not isinstance(metrics.get("cases"), int)
                or not isinstance(metrics.get("right"), int)
                or metrics["cases"] < 100
                or metrics["right"] < 0
                or metrics["right"] > metrics["cases"]
            ):
                reasons.append(f"{label} tool evaluation must contain valid counts for at least 100 scored cases")
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
    elif not math.isfinite(float(identity["after_lora"])) or identity["after_lora"] < 1.0:
        reasons.append(f"identity after LoRA {identity['after_lora']} < 1.0 or is non-finite")

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
    if int(cfg.batch) != 1:
        raise ValueError("Sham 2 partial training requires batch_size=1")
    torch.manual_seed(seed)
    random.seed(seed)
    stages = parse_training_stages(stage)
    full_training = set(stages) == set(FULL_TRAINING_STAGES)
    source_manifest = json.loads((Path(train_data_path).expanduser().resolve().parent / "manifest.json").read_text(encoding="utf-8"))
    source_stages = source_manifest.get("stages", {})
    missing_full_stages = [
        name for name in FULL_TRAINING_STAGES
        if not isinstance(source_stages.get(name), dict)
        or source_stages[name].get("status") != "available"
    ]

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
    stages = parse_training_stages(stage)
    validate_stage_record_minimums(raw_train, raw_heldout, stages)
    stage_presence = {row["stage"] for row in raw_train}
    missing_stages = [s for s in stages if s not in stage_presence]
    if missing_stages:
        raise ValueError(f"training data is missing required stage(s): {', '.join(missing_stages)}")
    train_inputs = {row["prompt"].strip() for row in raw_train}
    overlap = [row["prompt"] for row in raw_heldout if row["prompt"].strip() in train_inputs]
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
    stage_steps = {"identity": 60, "tools": 400, "arabic": 200, "terminal": 600}
    lora_trainable = [
        p for name, p in model.named_parameters()
        if p.requires_grad and (".lora_A" in name or ".lora_B" in name)
    ]
    head_trainable = [
        p for name, p in model.named_parameters()
        if p.requires_grad and name.startswith(("compressor.", "thinker.", "writer."))
    ]
    if not lora_trainable or not head_trainable:
        raise RuntimeError("rank-16 LoRA and T-LDM head must both have trainable parameters")
    optimizer = torch.optim.AdamW(
        [
            {"params": head_trainable, "lr": cfg.lr},
            {"params": lora_trainable, "lr": cfg.lora_lr},
        ],
        betas=(0.9, 0.95), weight_decay=0.0,
    )
    report = {
        "format": "sham2-unified-real-data-report-v1",
        "batch_size": int(cfg.batch),
        "mode": "frozen-ShamSmall-donor+new-LoRA16+T-LDM-masked-byte-diffusion",
        "target_encoding": "UTF-8 bytes with EOS and explicit padding loss mask",
        "writer_vocab_size": BYTE_VOCAB,
        "writer_block_bytes": int(cfg.block),
        "training_scope": "full" if full_training else "partial, not full",
        "training_performed": True,
        "requested_stages": stages,
        "missing_full_stages": missing_full_stages,
        "full_training": full_training,
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
        "data_manifest_sha256": file_sha256(Path(train_file).parent / "manifest.json"),
        "data_sources": json.loads((Path(train_file).parent / "manifest.json").read_text(encoding="utf-8")).get("stages", {}),
        "train_examples_by_stage": {
            s: sum(1 for row in train_rows if row["stage"] == s) for s in stages
        },
        "train_examples_total": len(train_rows),
        "heldout_examples_by_source": {
            source: sum(1 for row in raw_heldout if row.get("source_set") == source)
            for source in ("terminal_tasks.HELDOUT", "rewordings.HELDOUT2")
        },
        "heldout_examples": len(heldout_rows),
        "lora_rank": 16,
        "lora_alpha": 32,
        "gradient_checkpointing": True,
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
        losses = []
        steps = stage_steps[stage_name]
        model.train()
        for step in range(steps):
            row = rows[step % len(rows)]
            input_ids = torch.tensor([row["input_ids"]], dtype=torch.long)
            target_ids = torch.tensor([row["target_ids"]], dtype=torch.long)
            valid_mask = torch.tensor([row["valid_mask"]], dtype=torch.bool)
            latents = model(input_ids)
            loss = model.writer.loss(latents, target_ids, valid_mask=valid_mask)
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
            "loss_initial": losses[0],
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
            target_ids = torch.tensor([row["target_ids"]], dtype=torch.long)
            valid_mask = torch.tensor([row["valid_mask"]], dtype=torch.bool)
            latents = model(input_ids)
            # Held-out CE mirrors generation: every output position, including
            # padding, is hidden. Do not reveal target bytes or the EOS/pad boundary.
            all_hidden = torch.ones_like(valid_mask, dtype=torch.bool)
            masked_logits = model.writer.logits(target_ids, all_hidden, latents)
            selected_logits = masked_logits[0][valid_mask[0]].float()
            selected_targets = target_ids[0][valid_mask[0]]
            heldout_losses.append(
                float(F.cross_entropy(selected_logits, selected_targets).cpu())
            )
            generated = model.writer.generate(
                latents, steps=cfg.diffusion_steps, temperature=0.0
            )[0].tolist()
            predicted_text = decode_target_bytes(generated)
            exact += int(predicted_text == str(row["target"]).strip())
    report["final_training_loss"] = report["stages"][-1]["loss_last"]
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
        "format": "sham2-unified-heads-v3",
        "training_scope": "full" if full_training else "partial, not full",
        "trained_stages": list(stages),
        "missing_full_stages": list(missing_full_stages),
        "train_data_sha256": report["train_data_sha256"],
        "heldout_data_sha256": report["heldout_data_sha256"],
        "data_manifest_sha256": report["data_manifest_sha256"],
        "target_encoding": report["target_encoding"],
        "writer_vocab_size": BYTE_VOCAB,
        "writer_block_bytes": int(cfg.block),
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
    report["artifact_format"] = payload["format"]
    report["artifact"] = str(save_path)
    report["artifact_size_bytes"] = save_path.stat().st_size
    report["artifact_sha256"] = file_sha256(save_path)
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
    artifact_format = payload.get("format")
    if artifact_format != "sham2-unified-heads-v3":
        raise RuntimeError(
            "heads file is not the current Sham 2 byte-diffusion artifact (v3); "
            "older continuous-vocabulary heads are intentionally rejected"
        )
    if artifact_format == "sham2-unified-heads-v3":
        if payload.get("training_scope") not in ("partial, not full", "full"):
            raise RuntimeError("v2 heads artifact is missing an honest training_scope label")
        if not isinstance(payload.get("trained_stages"), list) or not payload.get("trained_stages"):
            raise RuntimeError("v2 heads artifact is missing trained_stages provenance")
        if payload.get("target_encoding") != "UTF-8 bytes with EOS and explicit padding loss mask":
            raise RuntimeError("v3 heads artifact has an unsupported target encoding")
        if payload.get("writer_vocab_size") != BYTE_VOCAB:
            raise RuntimeError("v3 heads artifact writer vocabulary is not UTF-8 byte + EOS (257)")
        if payload.get("writer_block_bytes") != int(model.cfg.block):
            raise RuntimeError("v3 heads artifact writer block does not match the active model")
    if payload.get("donor_sha256") != donor_sha256:
        raise RuntimeError("heads were trained against a different donor checkpoint")
    if payload.get("tokenizer_sha256") != tokenizer_sha256:
        raise RuntimeError("heads were trained with a different tokenizer")
    if payload.get("donor_config") != _model_donor_config(model.donor_body):
        raise RuntimeError("heads donor architecture does not match the loaded donor")
    saved_cfg = payload.get("config")
    if not isinstance(saved_cfg, dict):
        raise RuntimeError("heads artifact is missing its model configuration")
    actual_cfg = dict(model.cfg.__dict__)
    # The local donor file may move between Studio workspaces; all architecture
    # and training-contract fields must still match exactly.
    saved_cfg = {k: v for k, v in saved_cfg.items() if k != "donor_id"}
    actual_cfg = {k: v for k, v in actual_cfg.items() if k != "donor_id"}
    if saved_cfg != actual_cfg:
        raise RuntimeError("heads T-LDM configuration does not match the current unified model")
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
    """No fake computer operation: this module requires a real model tool-call adapter and backend."""
    def __init__(self, model: Sham2Unified, backend=None, tool_call_adapter=None):
        self.model = model
        self.backend = backend
        self.tool_call_adapter = tool_call_adapter
        self.max_calls = model.cfg.max_tool_calls

    def run(self, task: str, max_steps: int = 6) -> Dict:
        if self.backend is None:
            raise RuntimeError("real terminal backend is missing; refusing dry-run execution")
        if not callable(self.tool_call_adapter):
            raise RuntimeError(
                "real Sham tool-call adapter is missing; refusing hardcoded command proposals"
            )
        history = [{"task": task}]
        for _step in range(min(max_steps, self.max_calls)):
            command = self.tool_call_adapter(self.model, task, history)
            if command is None:
                break
            result = self.backend.run(command)
            if hasattr(result, "out"):
                output = result.out if getattr(result, "ok", True) else getattr(result, "refused", "")
            else:
                output = str(result)
            history.append({"cmd": command, "result": str(output)[:500]})
            if "DONE" in str(output):
                break
        return {"history": history, "steps": len(history) - 1}

# ============================================================
# Self Evolution — تجربة -> درس -> LoRA -> بوابة — [تطبيق 8]
# ============================================================
class SelfEvolution:
    """Lesson collection scaffold. LoRA training and automatic merging are not implemented here."""
    def __init__(self, model: Sham2Unified):
        self.model = model
        self.lessons: List[Dict] = []

    def add_experience(self, task: str, success: bool, trace: List[Dict]):
        if not success:
            return
        lesson = {"task": task, "trace_len": len(trace), "created": time.time()}
        self.lessons.append(lesson)

    def propose_lora_update(self) -> Dict:
        return {
            "lessons": len(self.lessons),
            "ready": False,
            "status": "not_implemented",
            "note": "A real lesson dataset builder, optimizer run and fresh gate are required; no update was trained.",
        }


# ============================================================
# QAT + GGUF Export — [تطبيق 5]
# ============================================================
def export_gguf(heads_path: str, out_path: str, bits: int = 4) -> str:
    """GGUF conversion is not implemented here; do not create metadata and call it an export."""
    raise NotImplementedError(
        "real GGUF conversion requires a supported donor architecture converter and "
        "a verified merged checkpoint; no GGUF file was produced"
    )

# ============================================================
# CLI
# ============================================================
def main():
    ap = argparse.ArgumentParser(
        description="Sham 2 Unified — frozen ModelScope donor + LoRA-16 + T-LDM; fail closed."
    )
    ap.add_argument("--donor", default=MODELSCOPE_DONOR_REPO,
                    help="ModelScope model ID containing final_merged.pt")
    ap.add_argument("--tokenizer", default=MODELSCOPE_DONOR_REPO,
                    help="ModelScope model ID containing sham_small_tokenizer.json")
    ap.add_argument("--data-dir", default=None,
                    help="directory created by export_sham2_jsonl.py")
    ap.add_argument("--stage", default="all",
                    help="all (strict full run), available (identity+terminal only), or comma-separated stages such as identity,terminal")
    ap.add_argument("--out", default="./sham2_unified_out")
    ap.add_argument("--check-gate", action="store_true")
    ap.add_argument("--served", default=None)
    ap.add_argument("--candidate", default=None)
    ap.add_argument("--serve", action="store_true")
    ap.add_argument("--heads", default=None, help="matching sham2_heads.pt")
    ap.add_argument("--prompt", default=None, help="real text prompt for one-shot generation")
    ap.add_argument("--smoke", action="store_true",
                    help="validate real files only; zero optimizer steps")
    ap.add_argument("--check-donor", action="store_true",
                    help="download only final_merged.pt and verify its structure against the canonical ShamSmall checkpoint loader; no tokenizer or training")
    ap.add_argument("--check-donor-report", default=None,
                    help="optional path to persist the full tensor-level donor check report")
    ap.add_argument("--batch-size", type=int, choices=(1,), default=1,
                    help="Sham 2 CPU training uses micro-batch 1 only")
    ap.add_argument("--expected-donor-sha256", default=None,
                    help="require the same donor SHA-256 produced by the compatible preflight")
    ap.add_argument("--selftest-modelscope-api", action="store_true",
                    help="offline tests for old/new ModelScope snapshot_download signatures; performs no network request")
    ap.add_argument("--selftest-lora-layout", action="store_true",
                    help="offline test of the exact ShamSmall attention/MLP rank-16 LoRA target map; no donor or training")
    ap.add_argument("--selftest-byte-writer", action="store_true",
                    help="offline shape, masking, UTF-8, position, gradient and generation test for the canonical byte-diffusion writer")
    args = ap.parse_args()

    if getattr(args, "selftest_byte_writer", False):
        from writer import DiffusionWriter as _ByteWriter

        block = 32
        byte_writer = _ByteWriter(d=16, block=block, vocab=BYTE_VOCAB, layers=1, heads=4)
        latents = torch.randn(2, 4, 16)
        examples = ["ls", "grep ERROR app.log", "مرحبا"]
        encoded = [encode_target_bytes(item, block, "writer self-test") for item in examples]
        assert all(len(ids) == block and len(mask) == block for ids, mask in encoded)
        assert all(sum(mask) == len(item.encode("utf-8")) + 1 for item, (_ids, mask) in zip(examples, encoded))
        for item, (ids, mask) in zip(examples, encoded):
            decoded = bytes(ids[:sum(mask)-1]).decode("utf-8")
            assert decoded == item, (item, decoded)
        target = torch.tensor([encoded[0][0], encoded[1][0]], dtype=torch.long)
        valid = torch.tensor([encoded[0][1], encoded[1][1]], dtype=torch.bool)
        captured_masks = []
        original_logits = byte_writer.logits
        def capture_logits(tokens, masked, context):
            captured_masks.append(masked.detach().clone())
            return original_logits(tokens, masked, context)
        byte_writer.logits = capture_logits
        torch.manual_seed(17)
        loss = byte_writer.loss(latents, target, valid_mask=valid)
        byte_writer.logits = original_logits
        assert torch.isfinite(loss), loss
        assert captured_masks and torch.all(captured_masks[0][~valid]), "padding positions must be masked, never exposed as visible EOS context"
        loss.backward()
        assert byte_writer.pos.weight.grad is not None
        assert byte_writer.embed.weight.grad is not None
        logits = byte_writer.logits(target, valid, latents)
        assert tuple(logits.shape) == (2, block, BYTE_VOCAB), tuple(logits.shape)
        assert byte_writer.pos.num_embeddings == block
        assert byte_writer.head.out_features == BYTE_VOCAB
        torch.manual_seed(19)
        generated = byte_writer.generate(latents, steps=3, temperature=0.0)
        assert tuple(generated.shape) == (2, block), tuple(generated.shape)

        # Integration regression: the Sham2 model must instantiate the byte
        # writer, return latent context from forward(), and feed that context
        # into writer.loss/generation. A standalone writer test cannot catch
        # a stale donor-vocabulary Writer constructor or tuple/latent mismatch.
        from types import SimpleNamespace

        class _IdentityDonorLayer(nn.Module):
            def forward(self, hidden, _cos, _sin, past_kv=None, use_cache=False):
                return hidden, None

        class _TinyDonor(nn.Module):
            def __init__(self):
                super().__init__()
                self.cfg = SimpleNamespace(
                    d_model=16, max_seq_len=64, use_gradient_checkpointing=False
                )
                self.token_embedding = nn.Embedding(300, 16)
                self.layers = nn.ModuleList([_IdentityDonorLayer(), _IdentityDonorLayer()])
                self.final_norm = nn.LayerNorm(16)
                self.register_buffer("rope_cos", torch.zeros(64, 1, 1))
                self.register_buffer("rope_sin", torch.zeros(64, 1, 1))

        tiny_cfg = Sham2UnifiedConfig(
            d_model=16, vocab_size=300, n_layers=2, max_seq_len=64,
            latents=4, think_steps=2, block=block, writer_layers=1,
            heads=4, head_d=16, bitnet_head=False, batch=1,
        )
        tiny_model = Sham2Unified(tiny_cfg, _TinyDonor())
        assert isinstance(tiny_model.writer, MaskedByteDiffusionWriter), type(tiny_model.writer)
        prompt_latents = tiny_model(torch.tensor([[1, 2, 3]], dtype=torch.long))
        assert tuple(prompt_latents.shape) == (1, 4, 16), tuple(prompt_latents.shape)
        model_target, model_valid = encode_target_bytes("ls", block, "model integration")
        model_target_tensor = torch.tensor([model_target], dtype=torch.long)
        model_valid_tensor = torch.tensor([model_valid], dtype=torch.bool)
        model_loss = tiny_model.writer.loss(
            prompt_latents, model_target_tensor, valid_mask=model_valid_tensor
        )
        assert torch.isfinite(model_loss), model_loss
        model_loss.backward()
        assert any(
            p.grad is not None
            for name, p in tiny_model.named_parameters()
            if name.startswith(("compressor.", "thinker.", "writer."))
        ), "the integrated Sham2 latent/writer path must carry gradients"
        tiny_generated = tiny_model.generate_block(
            torch.tensor([[1, 2, 3]], dtype=torch.long), steps=2
        )
        assert tuple(tiny_generated.shape) == (1, block), tuple(tiny_generated.shape)

        try:
            encode_target_bytes("x" * (block), block, "overflow")
        except ValueError as exc:
            assert "refusing truncation" in str(exc)
        else:
            raise AssertionError("byte targets beyond the fixed block must be refused")
        print(json.dumps({
            "selftest": "passed",
            "writer": "masked discrete byte diffusion",
            "writer_vocab_size": BYTE_VOCAB,
            "block_bytes": block,
            "position_embeddings": True,
            "full_latent_cross_attention": True,
            "valid_byte_and_eos_mask": True,
            "utf8_round_trip": True,
            "gradient_flow": True,
            "generation_shape": list(generated.shape),
            "integrated_model_writer": "passed",
            "integrated_latent_shape": list(prompt_latents.shape),
            "integrated_generation_shape": list(tiny_generated.shape),
            "network_used": False,
            "optimizer_steps": 0,
        }, ensure_ascii=False, indent=2))
        return

    if args.selftest_lora_layout:
        class _FakeAttention(nn.Module):
            def __init__(self):
                super().__init__()
                for name in ("q_proj", "k_proj", "v_proj", "o_proj"):
                    setattr(self, name, nn.Linear(8, 8, bias=False))

        class _FakeMLP(nn.Module):
            def __init__(self):
                super().__init__()
                for name in ("gate_proj", "up_proj", "down_proj"):
                    setattr(self, name, nn.Linear(8, 8, bias=False))

        class _FakeLayer(nn.Module):
            def __init__(self):
                super().__init__()
                self.attention = _FakeAttention()
                self.mlp = _FakeMLP()

        class _FakeDonor(nn.Module):
            def __init__(self):
                super().__init__()
                self.layers = nn.ModuleList([_FakeLayer(), _FakeLayer()])

        fake = _FakeDonor()
        installed = install_rank16_lora(fake)
        assert installed == 14, installed
        for layer_index, layer in enumerate(fake.layers):
            for parent_name, names in (
                ("attention", ("q_proj", "k_proj", "v_proj", "o_proj")),
                ("mlp", ("gate_proj", "up_proj", "down_proj")),
            ):
                parent = getattr(layer, parent_name)
                for name in names:
                    module = getattr(parent, name)
                    assert isinstance(module, Sham2LoRA16), (layer_index, parent_name, name, type(module).__name__)
                    assert module.lora_A.requires_grad and module.lora_B.requires_grad
                    assert all(not p.requires_grad for p in module.base.parameters())
            assert not hasattr(layer.attention, "gate_proj")
            assert not hasattr(layer.mlp, "q_proj")
        try:
            install_rank16_lora(fake)
        except RuntimeError as exc:
            assert "already attached" in str(exc), str(exc)
        else:
            raise AssertionError("reinstalling rank-16 LoRA must be refused")
        print(json.dumps({
            "selftest": "passed",
            "lora_modules": installed,
            "layers": len(fake.layers),
            "attention_targets_per_layer": ["q_proj","k_proj","v_proj","o_proj"],
            "mlp_targets_per_layer": ["gate_proj","up_proj","down_proj"],
            "base_weights_frozen": True,
            "duplicate_install_refused": True,
            "network_used": False,
            "optimizer_steps": 0,
        }, ensure_ascii=False, indent=2))
        return

    if args.selftest_modelscope_api:
        calls = []
        def old_sdk(model_id, allow_file_pattern=None, max_workers=None, token=None):
            calls.append({"model_id": model_id, "pattern": allow_file_pattern, "workers": max_workers, "token": token})
            return "/tmp/modelscope-old-sdk"
        got = _snapshot_download_compatible(
            old_sdk, "owner/model", ["final_merged.pt"], "test-token",
            "https://www.modelscope.cn", diagnostics={}, max_attempts=3,
            sleep_fn=lambda _seconds: None,
        )
        assert got == "/tmp/modelscope-old-sdk" and calls[0]["pattern"] == ["final_merged.pt"]
        def new_sdk(model_id, allow_file_pattern=None, max_workers=None, token=None, endpoint=None):
            calls.append({"model_id": model_id, "pattern": allow_file_pattern, "workers": max_workers, "token": token, "endpoint": endpoint})
            return "/tmp/modelscope-new-sdk"
        got = _snapshot_download_compatible(
            new_sdk, "owner/model", ["final_merged.pt"], "test-token",
            "https://www.modelscope.cn", diagnostics={}, max_attempts=3,
            sleep_fn=lambda _seconds: None,
        )
        assert got == "/tmp/modelscope-new-sdk" and calls[-1]["endpoint"] == "https://www.modelscope.cn"
        deterministic_calls = []
        def deterministic_type_error(model_id, allow_file_pattern=None, max_workers=None, token=None):
            deterministic_calls.append(model_id)
            raise TypeError("unexpected keyword argument 'endpoint'")
        try:
            _snapshot_download_compatible(
                deterministic_type_error, "owner/model", ["final_merged.pt"], "test-token",
                "https://www.modelscope.cn", max_attempts=3, sleep_fn=lambda _seconds: None,
            )
        except TypeError:
            pass
        else:
            raise AssertionError("TypeError should fail fast")
        assert len(deterministic_calls) == 1, deterministic_calls
        transient_calls = []
        def transient_failure(model_id, allow_file_pattern=None, max_workers=None, token=None):
            transient_calls.append(model_id)
            raise ConnectionError("temporary connection failure")
        try:
            _snapshot_download_compatible(
                transient_failure, "owner/model", ["final_merged.pt"], "test-token",
                "https://www.modelscope.cn", max_attempts=3, sleep_fn=lambda _seconds: None,
            )
        except ConnectionError:
            pass
        else:
            raise AssertionError("three transient failures should stop")
        assert len(transient_calls) == 3, transient_calls
        print(json.dumps({
            "selftest": "passed",
            "old_signature": str(inspect.signature(old_sdk)),
            "new_signature": str(inspect.signature(new_sdk)),
            "type_error_attempts": len(deterministic_calls),
            "transient_attempts": len(transient_calls),
            "network_used": False,
            "training_steps": 0,
        }, ensure_ascii=False, indent=2))
        return

    if args.check_donor:
        sys.exit(run_check_donor(str(args.donor), args.check_donor_report))

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
        heads_ok = bool(
            args.heads
            and Path(args.heads).expanduser().name == "sham2_heads.pt"
            and Path(args.heads).expanduser().is_file()
        )
        if not args.donor or not args.tokenizer or not heads_ok:
            print("missing donor or heads - refuse to serve fake")
            sys.exit(2)
        try:
            donor_path, tokenizer_path = resolve_modelscope_inputs(
                args.donor, args.tokenizer
            )
            _tokenizer = load_sham_tokenizer(str(tokenizer_path))
            donor_body, _step, _extra = load_sham_donor(str(donor_path))
            donor_cfg = _model_donor_config(donor_body)
            cfg = Sham2UnifiedConfig(
                donor_id=str(args.donor),
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
                print(decode_target_bytes(generated))
            print("[Sham2] validated real donor, tokenizer, heads and LoRA-16 loaded; this CLI does not start an HTTP server.")
            return
        except Exception as exc:
            print("missing donor or heads - refuse to serve fake")
            print(f"[Sham2] refuse reason: {type(exc).__name__}: {exc}", file=sys.stderr)
            sys.exit(2)

    if not args.data_dir:
        ap.error("--data-dir is required; use export_sham2_jsonl.py to create it")
    try:
        train_file, heldout_file, manifest = resolve_data_dir(args.data_dir, args.stage)
    except Exception as exc:
        ap.error(str(exc))

    # Validate data sources before downloading the 4.15-GB donor snapshot.
    raw_train = load_jsonl(str(train_file), require_stage=True)
    raw_heldout = load_jsonl(str(heldout_file), require_stage=False)

    if args.smoke:
        donor_path, tokenizer_path = resolve_modelscope_inputs(
            args.donor, args.tokenizer
        )
        tokenizer = load_sham_tokenizer(str(tokenizer_path))
        donor_body, donor_step, _extra = load_sham_donor(str(donor_path))
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
        _encode_rows(raw_train, tokenizer, smoke_cfg, smoke_cfg.vocab_size, "training")
        _encode_rows(raw_heldout, tokenizer, smoke_cfg, smoke_cfg.vocab_size, "heldout")
        training_prompts = {row["prompt"].strip() for row in raw_train}
        if any(row["prompt"].strip() in training_prompts for row in raw_heldout):
            ap.error("held-out leakage: at least one prompt also occurs in training JSONL")
        print(json.dumps({
            "validated_only": True,
            "optimizer_steps": 0,
            "donor_repo": args.donor,
            "donor_file": donor_path.name,
            "tokenizer_file": tokenizer_path.name,
            "donor_step": donor_step,
            "donor_config": donor_cfg,
            "tokenizer_vocab": tokenizer.get_vocab_size(with_added_tokens=True),
            "training_examples": len(raw_train),
            "heldout_examples": len(raw_heldout),
            "missing_required_stages": manifest.get("missing_required_stages", []),
        }, ensure_ascii=False, indent=2))
        return

    donor_path, tokenizer_path = resolve_modelscope_inputs(
        args.donor, args.tokenizer
    )
    actual_donor_sha256 = file_sha256(donor_path)
    if args.expected_donor_sha256 and actual_donor_sha256.lower() != args.expected_donor_sha256.strip().lower():
        ap.error(
            "donor SHA-256 changed after the compatible preflight: "
            f"expected {args.expected_donor_sha256}, got {actual_donor_sha256}"
        )
    cfg = Sham2UnifiedConfig(donor_id=str(args.donor), batch=int(args.batch_size))
    result = train_sham2_unified(
        str(donor_path), str(tokenizer_path), args.out,
        str(train_file), str(heldout_file),
        cfg, stage=args.stage,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
