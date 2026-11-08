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
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import torch


def write_gguf(model, path: str | Path, dtype: str = "f16") -> None:
    """ShamSmall -> GGUF (llama architecture). dtype: f32 | f16."""
    import gguf
    cfg = model.cfg
    if cfg.qkv_bias or cfg.qk_norm or cfg.adapter_rank:
        raise ValueError("this exporter handles the plain Sham block (no qkv bias / qk-norm / adapters)")
    w = gguf.GGUFWriter(str(path), "llama")
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
    w.add_vocab_size(cfg.vocab_size)
    w.add_file_type(gguf.LlamaFileType.MOSTLY_F16 if dtype == "f16" else gguf.LlamaFileType.ALL_F32)
    # placeholder vocabulary (ids are fed directly; Sham's own tokenizer does the text)
    w.add_tokenizer_model("llama")
    w.add_token_list([f"<t{i}>".encode() for i in range(cfg.vocab_size)])
    w.add_token_scores([0.0] * cfg.vocab_size)
    w.add_token_types([gguf.TokenType.NORMAL] * cfg.vocab_size)
    np_t = np.float16 if dtype == "f16" else np.float32

    def put(name: str, t: torch.Tensor, keep32: bool = False):
        arr = t.detach().float().cpu().numpy()
        w.add_tensor(name, arr.astype(np.float32 if keep32 or arr.ndim == 1 else np_t))

    put("token_embd.weight", model.token_embedding.weight)
    put("output_norm.weight", model.final_norm.weight, keep32=True)
    if not cfg.tie_embeddings:
        put("output.weight", model.lm_head.weight)
    for i, b in enumerate(model.layers):
        put(f"blk.{i}.attn_norm.weight", b.input_norm.weight, keep32=True)
        put(f"blk.{i}.attn_q.weight", b.attention.q_proj.weight)
        put(f"blk.{i}.attn_k.weight", b.attention.k_proj.weight)
        put(f"blk.{i}.attn_v.weight", b.attention.v_proj.weight)
        put(f"blk.{i}.attn_output.weight", b.attention.o_proj.weight)
        put(f"blk.{i}.ffn_norm.weight", b.post_attention_norm.weight, keep32=True)
        put(f"blk.{i}.ffn_gate.weight", b.mlp.gate_proj.weight)
        put(f"blk.{i}.ffn_up.weight", b.mlp.up_proj.weight)
        put(f"blk.{i}.ffn_down.weight", b.mlp.down_proj.weight)
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
        self.llm = Llama(model_path=str(path), n_ctx=n_ctx, n_threads=threads or os.cpu_count() or 4, n_batch=512, logits_all=False, verbose=False)
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


def fast_model(model, kind: str | None = None):
    """A llama.cpp copy of `model` for DECODING (several times more tokens/s on a CPU), or None when it cannot / should not be used: not a plain ShamSmall, llama-cpp-python
    missing (one background install attempt), no disk, or the copy does not agree with the PyTorch model. Built once per model and cached. SHAM_GGUF=0 turns it off;
    SHAM_GGUF=f16|q8_0|q4_0|q4_k_m chooses the format (default q8_0: near-lossless, measured ~2.3x faster writing than PyTorch fp32 on the build machine)."""
    kind = (kind or os.environ.get("SHAM_GGUF", "q8_0")).strip().lower()
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
        if agree < (6 if kind in ("f16", "q8_0") else 3):
            print(f"sham_gguf: the {kind} copy agrees with PyTorch on {agree}/6 test prompts — not used", flush=True)
            return None
        _FAST[key] = cand
        print(f"sham_gguf: decoding with llama.cpp ({kind}), agrees with PyTorch on {agree}/6 test prompts", flush=True)
        return cand
    except Exception as exc:
        print(f"sham_gguf: not used ({type(exc).__name__}: {str(exc)[:120]})", flush=True)
        return None


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
