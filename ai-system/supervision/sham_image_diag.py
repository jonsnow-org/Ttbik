"""
Why are Sham's pictures noise? (owner 2026-11-09: "the picture v2 sent is as failed as the old Sham's, exactly the same way"; option B: fix the INTERNAL generator, no outside one.)

Read-only measurement that separates the three places a picture can go wrong, on REAL captioned pictures (flickr8k, a few dozen):

  1. THE TOKENIZER (pixels <-> tokens). Encode a real picture, decode its own tokens: how close is the result (PSNR dB, against the "paint the mean colour" baseline)? If this is bad, no
     model can ever draw well through it. Also how many of the 8192 codes are used (collapse).
  2. THE MODEL (caption -> tokens). The model's loss on the REAL picture tokens given the real caption, against two baselines: the loss of an unconditional frequency table of the codes
     (what a model that learned only "which codes are common" would get) and the uniform guess ln(8192). Below the frequency table = it really reads the caption. At the table = blobs.
  3. THE SAMPLING (tokens -> picture). What the generator writes for the same captions: how many distinct codes, how repetitive, and the picture decoded from them, next to the real picture's
     own re-decoded picture.

Output: numbers, plus a PNG grid (real | its own tokens decoded | generated) per checkpoint, saved in OUT. No secrets, nothing published.
    python sham_image_diag.py                  (needs Kaggle credentials: it fetches the checkpoint datasets)
    python sham_image_diag.py --selftest       (offline: the measures on random weights and synthetic pictures)
"""
from __future__ import annotations

import argparse
import math
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SHAM = HERE.parent / "colab" / "sham_small"
sys.path.insert(0, str(SHAM))
OUT = Path(os.environ.get("SHAM_DIAG_OUT", "/tmp/sham_image_diag"))
DATASETS = ("sham-merged-checkpoint", "sham-multimodal-checkpoint", "sham-chat-checkpoint")


def psnr(a, b) -> float:
    """a, b in [-1, 1]; PSNR over the [0, 1] range."""
    import torch
    mse = float(((a - b) / 2).pow(2).mean())
    return 99.0 if mse <= 1e-12 else float(10 * math.log10(1.0 / mse))


def baseline_psnr(imgs) -> float:
    """What 'paint every picture with its own mean colour' scores: a tokenizer below this keeps less than a flat fill."""
    return psnr(imgs, imgs.mean(dim=(2, 3), keepdim=True).expand_as(imgs))


def freq_table_loss(train_ids, test_ids, num_codes: int) -> float:
    """Nats per token of an unconditional code-frequency table fitted on train_ids (90% empirical + 10% uniform, so an unseen code is not impossible), scored on test_ids."""
    import torch
    counts = torch.bincount(train_ids.flatten(), minlength=num_codes).float()
    p = 0.9 * counts / counts.sum() + 0.1 / num_codes
    return float(-p[test_ids.flatten()].log().mean())


def real_pictures(n: int, size: int):
    """(images [-1,1] (n,3,size,size), captions) from flickr8k, a streamed few dozen."""
    import numpy as np
    import torch
    from datasets import load_dataset
    ds = load_dataset("jxie/flickr8k", split="train", streaming=True)
    imgs, caps = [], []
    for r in ds:
        im = r["image"].convert("RGB").resize((size, size))
        imgs.append(torch.from_numpy(np.asarray(im).copy()).permute(2, 0, 1).float() / 127.5 - 1)
        caps.append(str(r["caption_0"]))
        if len(imgs) >= n:
            break
    return torch.stack(imgs), caps


def synthetic_pictures(n: int, size: int):
    import torch
    g = torch.Generator().manual_seed(0)
    yy, xx = torch.meshgrid(torch.linspace(-1, 1, size), torch.linspace(-1, 1, size), indexing="ij")
    imgs = torch.stack([torch.stack([torch.sin((i % 5 + 1) * xx * 3 + c) * torch.cos((i % 3 + 1) * yy * 2) for c in range(3)]) for i in range(n)])
    return (imgs + 0.05 * torch.randn(imgs.shape, generator=g)).clamp(-1, 1), [f"picture {i}" for i in range(n)]


def measure(model, text_tok, image_tok, imgs, caps, label: str, out_dir: Path, gen: int = 6, seed: int = 0) -> dict:
    """Runs the three measurements; returns the numbers (also printed)."""
    import torch
    from model import IMAGE_VOCAB_BASE, IMAGE_VOCAB_SIZE, SpecialTokens
    from sham_decoding import media_prompts
    c = image_tok.cfg
    res: dict = {}
    # 1) tokenizer
    with torch.no_grad():
        ids = image_tok.encode(imgs)
        rec = image_tok.decode(ids)
    ids = ids.reshape(ids.shape[0], -1)
    res["tok_psnr"] = psnr(rec, imgs)
    res["flat_psnr"] = baseline_psnr(imgs)
    used = int(ids.unique().numel())
    probs = torch.bincount(ids.flatten(), minlength=c.num_codes).float()
    probs = probs / probs.sum()
    res["codes_used"] = used
    res["code_perplexity"] = float(torch.exp(-(probs[probs > 0] * probs[probs > 0].log()).sum()))
    print(f"  [{label}] مرمّز الصور: PSNR إعادة بناء الصور الحقيقية {res['tok_psnr']:.1f} dB (تعبئة اللون المتوسط وحده {res['flat_psnr']:.1f} dB) | رموز مستعملة {used}/{c.num_codes} (تنوّع {res['code_perplexity']:.0f})")
    # 2) the model's loss on the real picture tokens given the real caption
    n = ids.shape[0]
    half = max(1, n // 2)
    losses = []
    for i in range(n):
        cond, _ = media_prompts("image", text_tok.encode(caps[i])[:200], text_tok, chat=True)
        seq = torch.tensor([cond + [SpecialTokens.IMAGE_START] + [IMAGE_VOCAB_BASE + int(t) for t in ids[i].tolist()] + [SpecialTokens.IMAGE_END]])
        with torch.no_grad():
            logits = model(seq)[0][0]
        start = len(cond) + 1
        tgt = seq[0, start:start + c.tokens_per_image]
        lp = torch.log_softmax(logits[start - 1:start - 1 + c.tokens_per_image].float(), dim=-1)
        losses.append(float(-lp[torch.arange(len(tgt)), tgt].mean()))
    res["model_loss"] = sum(losses) / len(losses)
    res["freq_loss"] = freq_table_loss(ids[half:], ids[:half], c.num_codes) if n > 1 else float("nan")
    res["uniform"] = math.log(c.num_codes)
    verdict = "قرب جدول التكرار = لا يقرأ الوصف" if res["model_loss"] > res["freq_loss"] - 0.15 else "أقل من جدول التكرار = يقرأ الوصف جزئياً"
    print(f"  [{label}] النموذج: خسارة رموز الصورة الحقيقية بوصفها {res['model_loss']:.2f} | جدول تكرار بلا وصف {res['freq_loss']:.2f} | تخمين متساوٍ {res['uniform']:.2f} → {verdict}")
    # 3) what it writes
    from sham_studio_media import _write_span
    gen_ids = []
    torch.manual_seed(seed)
    for i in range(min(gen, n)):
        cond, uncond = media_prompts("image", text_tok.encode(caps[i])[:200], text_tok, chat=True)
        seq = _write_span(model, cond, uncond, "image", c.tokens_per_image, 3.0)
        from generate import extract_image_tokens
        gen_ids.append(torch.tensor(extract_image_tokens(seq, c.tokens_per_image)).view(-1))
    g = torch.stack(gen_ids)
    runs = float((g[:, 1:] == g[:, :-1]).float().mean())
    res["gen_distinct_per_image"] = float(sum(int(x.unique().numel()) for x in g) / len(g))
    res["gen_adjacent_repeat"] = runs
    real_runs = float((ids[:, 1:] == ids[:, :-1]).float().mean())
    real_distinct = float(sum(int(x.unique().numel()) for x in ids) / len(ids))
    per_image = c.tokens_per_image
    print(f"  [{label}] ما يكتبه: رموز مختلفة في الصورة {res['gen_distinct_per_image']:.0f} من {per_image} (الصور الحقيقية {real_distinct:.0f}) | تكرار الجار {runs:.2f} (الحقيقية {real_runs:.2f})")
    try:
        from PIL import Image
        with torch.no_grad():
            gen_pix = image_tok.decode(g.view(len(gen_ids), c.latent_grid_size, c.latent_grid_size))
        rows = []
        for i in range(len(gen_ids)):
            tiles = [imgs[i], rec[i], gen_pix[i]]
            rows.append(torch.cat([t.permute(1, 2, 0) for t in tiles], dim=1))
        grid = ((torch.cat(rows, dim=0).clamp(-1, 1) + 1) * 127.5).byte().numpy()
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"{label}.png"
        Image.fromarray(grid).save(path)
        print(f"  [{label}] الشبكة (حقيقية | رموزها المفكوكة | ما يكتبه): {path}")
    except Exception as exc:  # noqa: BLE001
        print(f"  [{label}] تعذّر حفظ الشبكة: {type(exc).__name__}: {str(exc)[:100]}")
    return res


def _selftest() -> None:
    import tempfile
    import torch
    from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
    from model import IMAGE_VOCAB_SIZE, TOTAL_VOCAB_SIZE, ShamSmall, ShamSmallConfig
    from text_tokenizer import ShamTextTokenizer, train_text_tokenizer
    assert abs(psnr(torch.zeros(1, 3, 4, 4), torch.zeros(1, 3, 4, 4)) - 99.0) < 1e-6
    x = torch.rand(2, 3, 8, 8) * 2 - 1
    assert baseline_psnr(x) < 30
    tr = torch.randint(0, 50, (20000,))
    te = torch.randint(0, 50, (2000,))
    assert 3.8 < freq_table_loss(tr, te, 8192) < 4.2           # ~ln(50) + ln(1/0.9) on a uniform-over-50 source
    cfg = ImageTokenizerConfig(image_size=32, base_channels=16, channel_multipliers=(1, 2, 2, 2), code_dim=32, num_codes=IMAGE_VOCAB_SIZE)
    tok = ImageTokenizer(cfg).eval()
    mcfg = ShamSmallConfig(vocab_size=TOTAL_VOCAB_SIZE, d_model=64, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=cfg.tokens_per_image + 400)
    model = ShamSmall(mcfg).eval()
    with tempfile.TemporaryDirectory() as td:
        corpus = Path(td) / "c.txt"
        corpus.write_text("picture a cat sitting on a mat. صورة قطة جالسة. " * 200, encoding="utf-8")
        text_tok = train_text_tokenizer([str(corpus)], vocab_size=600)
        imgs, caps = synthetic_pictures(4, cfg.image_size)
        res = measure(model, text_tok, tok, imgs, caps, "selftest", Path(td) / "out", gen=2)
        assert (Path(td) / "out" / "selftest.png").exists()
    assert set(res) >= {"tok_psnr", "flat_psnr", "model_loss", "freq_loss", "uniform", "gen_distinct_per_image"}
    assert abs(res["uniform"] - math.log(8192)) < 1e-6
    print("sham_image_diag self-test OK (tokenizer PSNR, model loss vs frequency table, generated codes, grid image)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--n", type=int, default=24)
    a = ap.parse_args()
    if a.selftest:
        _selftest()
        return 0
    import torch
    from checkpoint import load_checkpoint
    from sham_inputs import fetch_dataset
    from text_tokenizer import ShamTextTokenizer
    from train_image_tokenizer import load_tokenizer_checkpoint as load_image
    print("صور حقيقية من flickr8k …", flush=True)
    imgs256, caps = real_pictures(a.n, 256)
    for name in DATASETS:
        print(f"\n===== {name} =====", flush=True)
        try:
            root = fetch_dataset(name)
        except Exception as exc:  # noqa: BLE001
            print(f"تعذّر التنزيل: {type(exc).__name__}")
            continue
        if not root:
            print("غير موجودة / فارغة")
            continue
        pts = sorted(root.rglob("*.pt"), key=lambda p: p.stat().st_size, reverse=True)
        ckpt = next((p for p in pts if p.name.startswith("final") or "checkpoint" in p.name or "step" in p.name), None)
        itk = next(iter(sorted(root.rglob("image_tokenizer.pt"))), None)
        tokf = next(iter(sorted(root.rglob("sham_small_tokenizer.json"))), None) or SHAM / "sham_general_tokenizer.json"
        if ckpt is None or itk is None:
            print(f"ينقصها: نقطة حفظ={ckpt is not None} مرمّز صور={itk is not None}")
            continue
        try:
            model, step, _ = load_checkpoint(ckpt, map_location="cpu")
            model.eval()
            image_tok, istep = load_image(itk)
            image_tok.eval()
            text_tok = ShamTextTokenizer.load(tokf)
        except Exception as exc:  # noqa: BLE001
            print(f"تعذّر التحميل: {type(exc).__name__}: {str(exc)[:140]}")
            continue
        size = image_tok.cfg.image_size
        imgs = imgs256 if size == 256 else torch.nn.functional.interpolate(imgs256, size=(size, size), mode="area")
        per_image = image_tok.cfg.tokens_per_image
        print(f"نقطة الحفظ {ckpt.name} خطوة {step:,} | مرمّز الصور خطوة {istep:,} ({size}px، {per_image} رمزاً)")
        measure(model, text_tok, image_tok, imgs, caps, name, OUT)
        del model
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
