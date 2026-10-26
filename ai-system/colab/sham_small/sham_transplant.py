"""
Sham — body transplant: start Sham from the trained body of a published small open model instead of from random numbers (owner, 2026-10-26).

What is taken and what stays Sham's:
  taken   the transformer body only (attention, MLP and norm weights of every layer + the final norm), as the starting point of OUR training
  ours    ShamSmall (the class), Sham's own tokenizer, the image / audio / special token ranges, the media tokenizers, the data and training pipelines,
          the merge gate that decides what replaces what. The embedding table is rebuilt for Sham's tokenizer (below), not copied from the donor.

How the body is made to fit (each step is checked against the donor's own logits in the self-test, not assumed):
  - head layout: published models rotate dimension i with i + head_dim/2; ShamSmall rotates the pairs (2i, 2i+1). Rows of q / k (and their bias and norm
    weights) are permuted once per head so both compute the same function.
  - shapes the donor needs that Sham did not have: head_dim wider than d_model / n_heads, a q/k/v bias, per-head q/k RMSNorm. All are optional config
    fields (model.py), off for every existing checkpoint.
  - embeddings: each Sham text token is turned back into its text and re-encoded with the donor's tokenizer; the donor's embedding rows of those pieces are
    averaged (a token the donor cannot spell, such as half of a multi-byte letter, gets the donor's mean row plus noise). The media and special rows start from
    the donor's embedding statistics and are then trained by Sham's own media stages.


  python sham_transplant.py <hf-donor-id> <out_dir> <sham_text_tokenizer.json>
Offline self-test (no network): python sham_transplant.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import torch

from model import TEXT_VOCAB_SIZE, TOTAL_VOCAB_SIZE, ShamSmall, ShamSmallConfig


def _bytes_to_unicode() -> dict[int, str]:
    bs = list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1)) + list(range(ord("®"), ord("ÿ") + 1))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return dict(zip(bs, [chr(c) for c in cs]))


_UNI2BYTE = {v: k for k, v in _bytes_to_unicode().items()}


def token_text(token: str) -> str | None:
    """The text a byte-level BPE token stands for, or None when its bytes are not valid UTF-8 on their own (half of a multi-byte letter)."""
    try:
        return bytes(_UNI2BYTE[c] for c in token).decode("utf-8")
    except (KeyError, UnicodeDecodeError):
        return None


def rope_perm(head_dim: int) -> torch.Tensor:
    """new[j] = old[perm[j]]: donor layout (i, i + hd/2 paired) -> Sham layout ((2i, 2i + 1) paired)."""
    half = head_dim // 2
    return torch.tensor([(j // 2) if j % 2 == 0 else half + j // 2 for j in range(head_dim)])


def _permute_rows(w: torch.Tensor, heads: int, hd: int) -> torch.Tensor:
    """w: (heads * hd, in) or a bias (heads * hd,)"""
    perm = rope_perm(hd)
    if w.dim() == 1:
        return w.view(heads, hd)[:, perm].reshape(-1).clone()
    return w.view(heads, hd, -1)[:, perm, :].reshape(heads * hd, -1).clone()


def config_from_hf(hf_cfg, vocab_size: int = TOTAL_VOCAB_SIZE, max_seq_len: int = 2048, has_bias: bool = False, has_qk_norm: bool = False) -> ShamSmallConfig:
    hd = getattr(hf_cfg, "head_dim", None) or hf_cfg.hidden_size // hf_cfg.num_attention_heads
    theta = getattr(hf_cfg, "rope_theta", None)
    if theta is None:                                                     # newer transformers keep it inside rope_parameters
        rp = getattr(hf_cfg, "rope_parameters", None) or getattr(hf_cfg, "rope_scaling", None) or {}
        theta = rp.get("rope_theta", 10000.0)
    return ShamSmallConfig(
        vocab_size=vocab_size, d_model=hf_cfg.hidden_size, n_layers=hf_cfg.num_hidden_layers, n_heads=hf_cfg.num_attention_heads,
        n_kv_heads=getattr(hf_cfg, "num_key_value_heads", None) or hf_cfg.num_attention_heads, mlp_hidden=hf_cfg.intermediate_size,
        max_seq_len=max_seq_len, rope_theta=float(theta), rms_norm_eps=float(hf_cfg.rms_norm_eps), tie_embeddings=True,
        head_dim=0 if hd * hf_cfg.num_attention_heads == hf_cfg.hidden_size else hd, qkv_bias=has_bias, qk_norm=has_qk_norm,
    )


def transplant_body(hf_model, vocab_size: int = TOTAL_VOCAB_SIZE, max_seq_len: int = 2048) -> ShamSmall:
    """A ShamSmall holding the donor's body. The embedding table is left at Sham's initialisation: fill it with fill_embeddings()."""
    sd = {k: v.detach().float() for k, v in hf_model.state_dict().items()}
    has_bias = "model.layers.0.self_attn.q_proj.bias" in sd
    has_qk = "model.layers.0.self_attn.q_norm.weight" in sd
    cfg = config_from_hf(hf_model.config, vocab_size, max_seq_len, has_bias, has_qk)
    m = ShamSmall(cfg)
    hd, nh, nkv = cfg.hd, cfg.n_heads, cfg.n_kv_heads
    with torch.no_grad():
        for i, layer in enumerate(m.layers):
            p = f"model.layers.{i}."
            layer.input_norm.weight.copy_(sd[p + "input_layernorm.weight"])
            layer.post_attention_norm.weight.copy_(sd[p + "post_attention_layernorm.weight"])
            a = layer.attention
            a.q_proj.weight.copy_(_permute_rows(sd[p + "self_attn.q_proj.weight"], nh, hd))
            a.k_proj.weight.copy_(_permute_rows(sd[p + "self_attn.k_proj.weight"], nkv, hd))
            a.v_proj.weight.copy_(sd[p + "self_attn.v_proj.weight"])
            a.o_proj.weight.copy_(sd[p + "self_attn.o_proj.weight"])
            if has_bias:
                a.q_proj.bias.copy_(_permute_rows(sd[p + "self_attn.q_proj.bias"], nh, hd))
                a.k_proj.bias.copy_(_permute_rows(sd[p + "self_attn.k_proj.bias"], nkv, hd))
                a.v_proj.bias.copy_(sd[p + "self_attn.v_proj.bias"])
            if has_qk:
                perm = rope_perm(hd)
                a.q_norm.weight.copy_(sd[p + "self_attn.q_norm.weight"][perm])
                a.k_norm.weight.copy_(sd[p + "self_attn.k_norm.weight"][perm])
            layer.mlp.gate_proj.weight.copy_(sd[p + "mlp.gate_proj.weight"])
            layer.mlp.up_proj.weight.copy_(sd[p + "mlp.up_proj.weight"])
            layer.mlp.down_proj.weight.copy_(sd[p + "mlp.down_proj.weight"])
        m.final_norm.weight.copy_(sd["model.norm.weight"])
    return m


def fill_embeddings(model: ShamSmall, donor_embed: torch.Tensor, donor_tok, sham_tok_json: str | Path, seed: int = 0) -> dict:
    """Sham's text-token rows from the donor's rows (see the module docstring). Returns counts for the log."""
    from tokenizers import Tokenizer

    tok = Tokenizer.from_file(str(sham_tok_json))
    vocab = tok.get_vocab()
    g = torch.Generator().manual_seed(seed)
    mean, std = donor_embed.mean(0), donor_embed.std(0).clamp_min(1e-6)
    W = model.token_embedding.weight
    stats = {"spelled": 0, "unspelled": 0, "other_rows": 0}
    with torch.no_grad():
        W.copy_(mean + std * 0.5 * torch.randn(W.shape, generator=g))                                   # media / special rows and the fallback
        stats["other_rows"] = W.shape[0] - TEXT_VOCAB_SIZE
        for token, idx in vocab.items():
            if idx >= TEXT_VOCAB_SIZE or idx >= W.shape[0]:
                continue
            text = token_text(token)
            ids = donor_tok(text, add_special_tokens=False)["input_ids"] if text else []
            if ids:
                W[idx] = donor_embed[torch.tensor(ids)].mean(0)
                stats["spelled"] += 1
            else:
                stats["unspelled"] += 1
    return stats



def run(donor_id: str, out_dir: str | Path, sham_tok_json: str | Path, max_seq_len: int = 2048) -> Path:
    from checkpoint import save_checkpoint
    from transformers import AutoModelForCausalLM, AutoTokenizer

    hf = AutoModelForCausalLM.from_pretrained(donor_id, dtype=torch.float32).eval()
    dtok = AutoTokenizer.from_pretrained(donor_id)
    m = transplant_body(hf, TOTAL_VOCAB_SIZE, max_seq_len)
    stats = fill_embeddings(m, hf.get_input_embeddings().weight.detach().float(), dtok, sham_tok_json)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    save_checkpoint(out / "step_000000.pt", m, 0, extra={"transplant": {"donor": donor_id, **stats}})
    (out / "transplant.json").write_text(json.dumps({"donor": donor_id, **stats}, ensure_ascii=False), encoding="utf-8")
    print(f"transplanted {donor_id}: {sum(p.numel() for p in m.parameters()) / 1e6:.0f}M parameters; embeddings {stats}")
    return out


def _self_test() -> None:
    from transformers import Qwen2Config, Qwen2ForCausalLM, Qwen3Config, Qwen3ForCausalLM

    torch.manual_seed(0)
    ids = torch.randint(0, 250, (2, 24))
    for name, make in {
        "qwen3 (wide heads, q/k norm)": lambda: Qwen3ForCausalLM(Qwen3Config(vocab_size=256, hidden_size=48, intermediate_size=96, num_hidden_layers=2, num_attention_heads=4, num_key_value_heads=2,
                                                                          head_dim=24, max_position_embeddings=64, rope_theta=1_000_000.0, tie_word_embeddings=True)),
        "qwen2 (q/k/v bias)": lambda: Qwen2ForCausalLM(Qwen2Config(vocab_size=256, hidden_size=48, intermediate_size=96, num_hidden_layers=2, num_attention_heads=4, num_key_value_heads=2,
                                                                  max_position_embeddings=64, rope_theta=1_000_000.0, tie_word_embeddings=True)),
    }.items():
        hf = make().eval()
        with torch.no_grad():
            for n, p in hf.named_parameters():                              # make every weight matter (norms and biases start at 1 / 0)
                if "norm" in n or n.endswith("bias"):
                    p.add_(0.3 * torch.randn_like(p))
        m = transplant_body(hf, vocab_size=256, max_seq_len=64).eval()
        with torch.no_grad():
            m.token_embedding.weight.copy_(hf.get_input_embeddings().weight)          # identity vocabulary: only the body is under test
            want = hf(ids).logits
            got = m(ids)[0]
        err = float((want - got).abs().max())
        assert err < 1e-4, f"{name}: the transplanted body differs from the donor (max |logit diff| {err})"
        print(f"  {name}: logits equal to the donor's (max diff {err:.2e})")
    assert token_text("Ù") is None and token_text("ĠÙĥ") == " ك" and token_text("Ġthe") == " the"
    print("sham_transplant OK: the body behaves exactly like the donor's in Sham's own class.")


if __name__ == "__main__":
    if len(sys.argv) >= 4:
        run(sys.argv[1], sys.argv[2], sys.argv[3])
    else:
        _self_test()
