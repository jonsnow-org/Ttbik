"""
Sham — GGUF export + llama.cpp decoding: the fast path for the CPU ("شام سريع").

Why: on a CPU, generating one token reads every weight once, so speed = memory bandwidth / bytes of weights. PyTorch eager reads fp32 (4 bytes per weight) with
generic kernels: about 7 tokens/s for the 515M model on this class of machine. llama.cpp reads the same weights as 8-bit or 4-bit blocks with hand-tuned CPU kernels
(AVX2 / AVX-512 / AMX), so the same machine does several times more tokens/s, and its prompt reading (prefill) is faster too.

Sham's blocks are exactly llama.cpp's "llama" architecture: pre-norm RMSNorm, grouped-query attention, SwiGLU, tied embeddings, and RoPE over INTERLEAVED pairs
(x[0::2], x[1::2]) which is llama.cpp's native pairing — so the weights map one to one, with no permutation. This file writes them as a GGUF file, can quantize it
(Q8_0 / Q4_0 ...), and gives `LlamaCppModel` — a drop-in for the model's forward used by sham_stream.iter_tokens (same tokens in, same logits out).

The tokenizer stays Sham's own (Python `tokenizers`); the GGUF only carries a placeholder vocabulary so llama.cpp accepts the file, token ids are fed directly.

    python sham_gguf.py            # self-test: parity with the PyTorch model on a small random model
    python sham_gguf.py --bench    # speed of the 515M-shaped model: PyTorch fp32 vs GGUF F16 / Q8_0 / Q4_0 (random weights; speed does not depend on the values)
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import torch


def _eff(lin) -> torch.Tensor:
    """The weight a projection really applies: a plain Linear's weight, or an adapter projection's frozen weight plus its low-rank residual (merged, so llama.cpp needs no adapter support)."""
    if hasattr(lin, "adapter_down"):
        return lin.base.weight.detach().float() + lin.scale * (lin.adapter_up.detach().float() @ lin.adapter_down.detach().float())
    return lin.weight.detach().float()


def _unpermute(w: torch.Tensor, heads: int, hd: int) -> torch.Tensor:
    """Back from Sham's rotary layout (pairs 2i, 2i+1) to the donor's (pairs i, i + hd/2): the inverse of sham_transplant._permute_rows. Works for (heads*hd, in) weights and (hd,) per-head norm weights."""
    half = hd // 2
    perm = torch.tensor([(j // 2) if j % 2 == 0 else half + j // 2 for j in range(hd)])
    inv = torch.argsort(perm)
    if w.dim() == 1:                                   # a norm weight shared by every head: one permutation of its hd entries
        return w[inv].clone()
    return w.view(heads, hd, -1)[:, inv, :].reshape(heads * hd, -1).clone()


def _arch(cfg) -> str:
    """The llama.cpp architecture that computes exactly what this Sham computes. Plain Sham blocks = "llama" (rotates interleaved pairs, its native layout). A donor body with per-head q/k
    normalisation = "qwen3" (rotates i / i + hd/2, so q/k rows are un-permuted on export). A donor with NoPE layers and no q/k norm = "smollm3"."""
    if cfg.qkv_bias:
        raise ValueError("this exporter does not handle q/k/v biases (Qwen2-style donors)")
    if cfg.qk_norm:
        if tuple(cfg.nope_layers):
            raise ValueError("qk-norm together with NoPE layers has no llama.cpp architecture")
        return "qwen3"
    if tuple(cfg.nope_layers):
        step = 4
        if tuple(cfg.nope_layers) != tuple(i for i in range(cfg.n_layers) if (i + 1) % step == 0):
            raise ValueError("llama.cpp's smollm3 knows only 'every 4th layer has no rotary embedding'")
        return "smollm3"
    return "llama"


def write_gguf(model, path: str | Path, dtype: str = "f16") -> None:
    """ShamSmall -> GGUF. dtype: f32 | f16 | q8_0 (quantised while writing). Adapters are merged into the weights; the architecture follows _arch(cfg)."""
    import gguf
    cfg = model.cfg
    arch = _arch(cfg)
    unperm = arch == "qwen3"                           # llama.cpp's "llama" and "smollm3" rotate interleaved pairs like Sham; qwen3 rotates half-split pairs
    w = gguf.GGUFWriter(str(path), arch)
    w.add_name("sham")
    w.add_context_length(cfg.max_seq_len)
    w.add_embedding_length(cfg.d_model)
    w.add_block_count(cfg.n_layers)
    w.add_feed_forward_length(cfg.mlp_hidden)
    w.add_head_count(cfg.n_heads)
    w.add_head_count_kv(cfg.n_kv_heads)
    w.add_layer_norm_rms_eps(cfg.rms_norm_eps)
    w.add_rope_freq_base(cfg.rope_theta)
    w.add_rope_dimension_count(cfg.hd)
    w.add_key_length(cfg.hd)
    w.add_value_length(cfg.hd)
    w.add_vocab_size(cfg.vocab_size)
    w.add_file_type({"f16": gguf.LlamaFileType.MOSTLY_F16, "q8_0": gguf.LlamaFileType.MOSTLY_Q8_0}.get(dtype, gguf.LlamaFileType.ALL_F32))
    # placeholder vocabulary (ids are fed directly; Sham's own tokenizer does the text)
    w.add_tokenizer_model("llama")
    w.add_token_list([f"<t{i}>".encode() for i in range(cfg.vocab_size)])
    w.add_token_scores([0.0] * cfg.vocab_size)
    w.add_token_types([gguf.TokenType.NORMAL] * cfg.vocab_size)
    np_t = np.float16 if dtype == "f16" else np.float32

    def put(name: str, t: torch.Tensor, keep32: bool = False):
        arr = t.detach().float().cpu().numpy()
        if dtype == "q8_0" and not keep32 and arr.ndim == 2 and arr.shape[-1] % 32 == 0:
            # quantised while writing: a big model never needs the f16 file next to the quantised one (a free Studio has ~3 GB of disk)
            w.add_tensor(name, gguf.quants.quantize(arr, gguf.GGMLQuantizationType.Q8_0), raw_dtype=gguf.GGMLQuantizationType.Q8_0)
            return
        w.add_tensor(name, arr.astype(np.float32 if keep32 or arr.ndim == 1 else (np.float16 if dtype == "q8_0" else np_t)))

    put("token_embd.weight", model.token_embedding.weight)
    put("output_norm.weight", model.final_norm.weight, keep32=True)
    if not cfg.tie_embeddings:
        put("output.weight", model.lm_head.weight)
    for i, b in enumerate(model.layers):
        a = b.attention
        q, k = _eff(a.q_proj), _eff(a.k_proj)
        if unperm:
            q, k = _unpermute(q, cfg.n_heads, cfg.hd), _unpermute(k, cfg.n_kv_heads, cfg.hd)
        put(f"blk.{i}.attn_norm.weight", b.input_norm.weight, keep32=True)
        put(f"blk.{i}.attn_q.weight", q)
        put(f"blk.{i}.attn_k.weight", k)
        put(f"blk.{i}.attn_v.weight", _eff(a.v_proj))
        put(f"blk.{i}.attn_output.weight", _eff(a.o_proj))
        if cfg.qk_norm:
            put(f"blk.{i}.attn_q_norm.weight", _unpermute(a.q_norm.weight.detach().float(), 1, cfg.hd), keep32=True)
            put(f"blk.{i}.attn_k_norm.weight", _unpermute(a.k_norm.weight.detach().float(), 1, cfg.hd), keep32=True)
        put(f"blk.{i}.ffn_norm.weight", b.post_attention_norm.weight, keep32=True)
        put(f"blk.{i}.ffn_gate.weight", _eff(b.mlp.gate_proj))
        put(f"blk.{i}.ffn_up.weight", _eff(b.mlp.up_proj))
        put(f"blk.{i}.ffn_down.weight", _eff(b.mlp.down_proj))
    w.write_header_to_file()
    w.write_kv_data_to_file()
    w.write_tensors_to_file()
    w.close()


_FTYPE = {"q8_0": 7, "q4_0": 2, "q4_1": 3, "q5_0": 8, "q5_1": 9, "q4_k_m": 15, "q5_k_m": 17, "q6_k": 18}


def quantize_gguf(src: str | Path, dst: str | Path, kind: str = "q8_0") -> None:
    import llama_cpp
    params = llama_cpp.llama_model_quantize_default_params()
    params.ftype = _FTYPE[kind]
    params.nthread = os.cpu_count() or 4
    rc = llama_cpp.llama_model_quantize(str(src).encode(), str(dst).encode(), params)
    if rc != 0:
        raise RuntimeError(f"llama_model_quantize failed ({rc})")


class LlamaCppModel:
    """Forward-compatible with ShamSmall for decoding: model(tokens, past_key_values=state, use_cache=True) -> (logits, None, state).
    The KV cache lives inside llama.cpp; `state` is just the number of tokens already read. A caller that restarts (rolling window) passes past_key_values=None."""

    def __init__(self, path: str | Path, n_ctx: int = 2048, threads: int | None = None):
        from llama_cpp import Llama
        self.llm = Llama(model_path=str(path), n_ctx=n_ctx, n_threads=threads or os.cpu_count() or 4, n_batch=2048, n_ubatch=1024, flash_attn=True,
                         logits_all=False, verbose=False)
        self.n_ctx = n_ctx
        self.cfg = type("Cfg", (), {"max_seq_len": n_ctx})()

    def eval(self):
        return self

    def __call__(self, input_ids: torch.Tensor, past_key_values=None, use_cache: bool = True):
        toks = input_ids[0].tolist()
        if past_key_values is None:
            self.llm.reset()
        self.llm.eval(toks)
        n = self.llm.n_tokens
        # the last row of the context's output buffer (with logits_all=False this is the only row llama.cpp computes)
        row = np.ctypeslib.as_array(self.llm._ctx.get_logits(), shape=(self.llm.n_vocab(),))
        return torch.from_numpy(row.astype(np.float32, copy=True)).view(1, 1, -1), None, n


_FAST: dict = {}


def _mem_available() -> int:
    """Bytes of memory the machine can still hand out (Linux /proc/meminfo); a huge number where it cannot be read, so the guard never blocks on other systems."""
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) * 1024
    except Exception:
        pass
    return 1 << 62


def cached_fast(model):
    """The llama.cpp copy of `model` if one was ALREADY built (by the Studio's background thread), else None. Never builds anything: a reply must not wait for a 1-2 minute export."""
    for (mid, _kind), fm in list(_FAST.items()):
        if mid == id(model) and fm is not None:
            return fm
    return None


def fast_model(model, kind: str | None = None):
    """A llama.cpp copy of `model` for DECODING (several times more tokens/s on a CPU), or None when it cannot / should not be used: not a plain ShamSmall, llama-cpp-python
    missing (one background install attempt), no disk, or the copy does not agree with the PyTorch model. Built once per model and cached. SHAM_GGUF=0 turns it off;
    SHAM_GGUF=f16|q8_0|q6_k|q5_k_m|q4_k_m|q4_0 chooses the format. Default q4_k_m. Measured on a real model (SmolLM2-135M in Sham's own class, 2026-11-08, clean eval windows,
    loss change English / Arabic) and on the 515M shape (4 threads, writing tokens/s vs PyTorch fp32 14.2):
        q8_0   +0.24% / +0.29%   ~25-33 tok/s      q6_k   +1.05% / +1.49%   ~31 tok/s      q5_k_m +1.97% / +2.62%   ~31 tok/s
        q4_k_m +2.67% / +3.70%   ~45 tok/s (3.2x)  q4_0   +9.5%  / +12.1%   ~47 tok/s   <- the k-quant is 3x less lossy at the same size, so q4_0 is never chosen
    q4_k_m is the best speed/quality point: it makes a 4-bit-trained (QAT) model unnecessary, with no training at all."""
    kind = (kind or os.environ.get("SHAM_GGUF", "q4_k_m")).strip().lower()
    if kind in ("0", "off", "false", "no", ""):
        return None
    key = (id(model), kind)
    if key in _FAST:
        return _FAST[key]
    _FAST[key] = None
    try:
        try:
            import gguf  # noqa: F401
            import llama_cpp  # noqa: F401
        except ImportError:
            if os.environ.get("SHAM_GGUF_INSTALL", "1") == "1":
                import subprocess
                subprocess.run([sys.executable, "-m", "pip", "install", "-q", "--extra-index-url", "https://abetlen.github.io/llama-cpp-python/whl/cpu",
                                "llama-cpp-python", "gguf"], timeout=600, check=False, capture_output=True)
            import gguf  # noqa: F401,F811
            import llama_cpp  # noqa: F401,F811
        td = tempfile.mkdtemp(prefix="sham_gguf_")
        n_params = sum(p.numel() for p in model.parameters())
        free = shutil.disk_usage(td).free
        two_step = int(n_params * 2.0 + n_params * 0.7) + 200 * 2**20          # the f16 file and the quantised one side by side
        direct = int(n_params * 1.07) + 200 * 2**20                            # Q8_0 written straight
        if kind not in ("f16", "q8_0") and free < two_step and free >= direct:
            print(f"sham_gguf: disk too small for f16 + {kind} ({free >> 20} MiB free); writing Q8_0 directly", flush=True)
            kind = "q8_0"
        need = n_params * 2 if kind == "f16" else direct if kind == "q8_0" else two_step
        if free < need:
            shutil.rmtree(td, ignore_errors=True)
            print(f"sham_gguf: not used (only {free >> 20} MiB of disk free, {need >> 20} MiB needed)", flush=True)
            return None
        if _mem_available() < int(n_params * 1.1) + 1500 * 2**20:
            shutil.rmtree(td, ignore_errors=True)
            print("sham_gguf: not used (not enough free memory for a second copy of the weights)", flush=True)
            return None
        if kind == "q8_0":
            path = Path(td) / "sham-q8_0.gguf"
            write_gguf(model, path, "q8_0")
        else:
            f16 = Path(td) / "sham-f16.gguf"
            write_gguf(model, f16, "f16")
            path = f16
            if kind != "f16":
                path = Path(td) / f"sham-{kind}.gguf"
                quantize_gguf(f16, path, kind)
                f16.unlink()
        cand = LlamaCppModel(path, n_ctx=int(model.cfg.max_seq_len), threads=os.cpu_count() or 4)
        # it must agree with the PyTorch model on what it would write next (same top token on most test prompts)
        g = torch.Generator().manual_seed(0)
        agree = 0
        for _ in range(6):
            ids = torch.randint(4, max(5, min(int(model.cfg.vocab_size), 30000)), (1, 32), generator=g)
            with torch.no_grad():
                ref = model(ids)[0][0, -1].float()
            got = cand(ids)[0][0, -1]
            agree += int(got.argmax() == ref.argmax())
        if agree < (6 if kind in ("f16", "q8_0") else 5 if kind == "q6_k" else 4):
            print(f"sham_gguf: the {kind} copy agrees with PyTorch on {agree}/6 test prompts — not used", flush=True)
            return None
        _FAST[key] = cand
        print(f"sham_gguf: decoding with llama.cpp ({kind}), agrees with PyTorch on {agree}/6 test prompts", flush=True)
        return cand
    except Exception as exc:
        print(f"sham_gguf: not used ({type(exc).__name__}: {str(exc)[:120]})", flush=True)
        return None


def _randomise(model, seed: int) -> None:
    """Give every norm, q/k-norm and adapter residual a non-trivial value, so a layout or merge mistake cannot hide behind identity weights."""
    g = torch.Generator().manual_seed(seed)
    with torch.no_grad():
        for name, p in model.named_parameters():
            if name.endswith("adapter_up") or "norm" in name:
                p.copy_(torch.randn(p.shape, generator=g) * (0.2 if name.endswith("adapter_up") else 0.3) + (1.0 if "norm" in name else 0.0))


def _selftest_donor_bodies() -> None:
    """Sham v2's bodies: a Qwen3-style donor (q/k norm, head_dim wider than d_model / n_heads, rank-8 adapters, half-split rotary reached by permuted rows) and a SmolLM3-style
    donor (NoPE every 4th layer). llama.cpp must give the same logits as Sham's own PyTorch class, after the adapters are merged and the rows un-permuted."""
    from model import ShamSmall, ShamSmallConfig
    ids = torch.randint(5, 400, (1, 37))
    cases = {
        "qwen3 (qk-norm, head_dim 32 > 128/8, GQA, adapters)": dict(qk_norm=True, head_dim=32, adapter_rank=4),
        "qwen3 without adapters": dict(qk_norm=True, head_dim=32),
        "smollm3 (NoPE every 4th layer)": dict(nope_layers=(3,), adapter_rank=4),
    }
    for label, extra in cases.items():
        torch.manual_seed(1)
        cfg = ShamSmallConfig(vocab_size=500, d_model=128, n_layers=4, n_heads=8, n_kv_heads=4, mlp_hidden=256, max_seq_len=128, **extra)
        model = ShamSmall(cfg).eval()
        _randomise(model, 3)
        with torch.no_grad():
            ref = model(ids)[0][0, -1].float()
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "v2.gguf"
            write_gguf(model, p, "f32")
            m = LlamaCppModel(p, n_ctx=128, threads=2)
            got = m(ids)[0][0, -1]
            diff = (got - ref).abs().max().item()
            assert torch.equal(got.argmax(), ref.argmax()) and diff < 1e-2, f"{label}: llama.cpp differs from PyTorch by {diff}"
            m2 = LlamaCppModel(p, n_ctx=128, threads=2)
            _, _, st = m2(ids[:, :30])
            got2 = m2(ids[:, 30:], past_key_values=st)[0][0, -1]
            assert (got2 - ref).abs().max().item() < 1e-2, f"{label}: cached decoding differs"
            q8 = Path(td) / "v2-q8.gguf"
            write_gguf(model, q8, "q8_0")
            mq = LlamaCppModel(q8, n_ctx=128, threads=2)
            gq = mq(ids)[0][0, -1]
            assert torch.equal(gq.argmax(), ref.argmax()), f"{label}: Q8_0 written directly changed the top token"
            assert q8.stat().st_size < p.stat().st_size / 2.5, "direct Q8_0 file should be far smaller than f32"
        print(f"  donor body OK: {label} (max logit diff {diff:.1e}; Q8_0 written directly agrees)")


def _selftest() -> None:
    from model import ShamSmall, ShamSmallConfig
    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=500, d_model=128, n_layers=3, n_heads=8, n_kv_heads=4, mlp_hidden=256, max_seq_len=128)
    model = ShamSmall(cfg).eval()
    ids = torch.randint(5, 400, (1, 40))
    with torch.no_grad():
        ref = model(ids)[0][0, -1].float()
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "sham.gguf"
        write_gguf(model, p, "f32")
        m = LlamaCppModel(p, n_ctx=128, threads=2)
        got = m(ids)[0][0, -1]
        diff = (got - ref).abs().max().item()
        assert torch.equal(got.argmax(), ref.argmax()) and diff < 1e-2, f"logits differ from PyTorch by {diff}"
        # incremental decoding through the cache gives the same next-token logits as reading everything at once
        m2 = LlamaCppModel(p, n_ctx=128, threads=2)
        _, _, st = m2(ids[:, :30])
        got2 = m2(ids[:, 30:], past_key_values=st)[0][0, -1]
        assert (got2 - ref).abs().max().item() < 1e-2
        q = Path(td) / "sham-q8.gguf"
        quantize_gguf(p, q, "q8_0")
        mq = LlamaCppModel(q, n_ctx=128, threads=2)
        gq = mq(ids)[0][0, -1]
        assert torch.equal(gq.argmax(), ref.argmax()), "Q8_0 changed the top token on a random model"
    _selftest_donor_bodies()
    os.environ["SHAM_GGUF_INSTALL"] = "0"
    fm = fast_model(model, "q8_0")
    assert fm is not None and fast_model(model, "q8_0") is fm, "fast_model must build once and cache"
    assert fast_model(model, "0") is None
    print(f"sham_gguf self-test OK  (llama.cpp logits match PyTorch, max diff {diff:.1e}; cached decoding and Q8_0 agree; fast_model builds and caches)")


def _bench() -> None:
    from model import ShamSmall, ShamSmallConfig
    torch.set_num_threads(os.cpu_count() or 4)
    torch.manual_seed(0)
    cfg = ShamSmallConfig()                       # the real 515.5M shape
    model = ShamSmall(cfg).eval()
    prompt = torch.randint(5, 30000, (1, 256))
    print(f"515M-shaped Sham, {os.cpu_count()} threads | prompt 256 tokens, then 64 generated tokens (random weights: speed only)")
    print(f"{'engine':26s} {'read 256 tok':>13s} {'write tok/s':>12s}")
    with torch.no_grad():
        t0 = time.time()
        _, _, past = model(prompt, use_cache=True)
        read = time.time() - t0
        nxt = prompt[:, -1:]
        t0 = time.time()
        for _ in range(64):
            _, _, past = model(nxt, past_key_values=past, use_cache=True)
        wr = 64 / (time.time() - t0)
    print(f"{'PyTorch fp32 (today)':26s} {256 / read:10.0f}/s {wr:12.1f}", flush=True)
    del model
    model = ShamSmall(cfg).eval()
    with tempfile.TemporaryDirectory() as td:
        f16 = Path(td) / "sham-f16.gguf"
        write_gguf(model, f16, "f16")
        del model
        files = {"GGUF F16": f16}
        for kind in ("q8_0", "q4_0"):
            dst = Path(td) / f"sham-{kind}.gguf"
            quantize_gguf(f16, dst, kind)
            files[f"GGUF {kind.upper()} ({dst.stat().st_size / 1e6:.0f} MB)"] = dst
        for name, path in files.items():
            m = LlamaCppModel(path, n_ctx=1024)
            t0 = time.time()
            _, _, st = m(prompt[:, :256])
            read = time.time() - t0
            t0 = time.time()
            for _ in range(64):
                _, _, st = m(torch.tensor([[7]]), past_key_values=st)
            wr = 64 / (time.time() - t0)
            print(f"{name:26s} {256 / read:10.0f}/s {wr:12.1f}", flush=True)


if __name__ == "__main__":     # sham-ci: entrypoint (needs llama-cpp-python; the self-test runs where it is installed)
    if "--bench" in sys.argv:
        _bench()
    else:
        try:
            import llama_cpp  # noqa: F401
            import gguf  # noqa: F401
        except ImportError:
            print("sham_gguf: llama-cpp-python / gguf not installed — skipped")
            raise SystemExit(0)
        _selftest()
