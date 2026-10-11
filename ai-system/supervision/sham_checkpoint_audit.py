"""
Why is Sham still so weak after two months of training? This audit measures it, read-only (nothing is published or changed).

For each checkpoint dataset it downloads the model, lists the tokenizer files it carries (sha256 + size + whether it IS the repo's general tokenizer),
and scores the SAME fixed text with the checkpoint under every tokenizer it could be paired with. Loss per token is not comparable across tokenizers,
so it also prints bits-per-character. A checkpoint paired with the tokenizer it was trained with is far lower than with any other.
It also shows one decoded sample per pairing, so a mismatch (Latin fragments inside Arabic) is visible to the eye.

The text: the same Arabic-heavy mix the merge gate uses (sham_text_mix), fixed seed, split into an Arabic-only part and the rest.
Output: plain lines, no secrets.
"""
from __future__ import annotations

import hashlib
import math
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SHAM = HERE.parent / "colab" / "sham_small"
sys.path.insert(0, str(SHAM))

DATASETS = ("sham-chat-checkpoint", "sham-multimodal-checkpoint", "sham-merged-checkpoint", "sham-crawl-checkpoint",
            "sham-checkpoint", "sham-crawl-gh", "nova-small-checkpoint")
WORK = Path("/tmp/sham_audit")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:12]


def arabic_ratio(s: str) -> float:
    letters = [c for c in s if c.isalpha()]
    return sum(1 for c in letters if "؀" <= c <= "ۿ") / max(len(letters), 1)


def media_check(root: Path, model_vocab: int | None = None) -> None:
    """Image / audio tokenizers (the video tokenizer IS the image tokenizer applied per frame): config, sha, codebook use, reconstruction
    against a trivial baseline on synthetic structured inputs, and the token budget — how many seconds fit the model's 2048-token context."""
    import torch
    from audio_tokenizer import AudioTokenizerConfig
    from image_tokenizer import ImageTokenizerConfig
    from train_audio_tokenizer import load_tokenizer_checkpoint as load_audio
    from train_image_tokenizer import load_tokenizer_checkpoint as load_image

    CONTEXT = 2048
    for p in sorted(root.rglob("image_tokenizer.pt")):
        try:
            tk, step = load_image(p)
            tk.eval()
            c = tk.cfg
            n = 16
            torch.manual_seed(0)
            yy, xx = torch.meshgrid(torch.linspace(-1, 1, c.image_size), torch.linspace(-1, 1, c.image_size), indexing="ij")
            imgs = torch.stack([torch.stack([torch.sin((i + 1) * xx * 3 + ch) * torch.cos((i % 4 + 1) * yy * 2) for ch in range(3)]) for i in range(n)])
            imgs = (imgs + 0.1 * torch.randn_like(imgs)).clamp(-1, 1)
            with torch.no_grad():
                ids = tk.encode(imgs)
                rec = tk.decode(ids)
            used = int(ids.unique().numel())
            probs = torch.bincount(ids.flatten(), minlength=c.num_codes).float()
            probs = probs / probs.sum()
            perplex = float(torch.exp(-(probs[probs > 0] * probs[probs > 0].log()).sum()))
            mse = float((rec - imgs).pow(2).mean())
            base = float((imgs - imgs.mean(dim=(2, 3), keepdim=True)).pow(2).mean())
            tpi = c.tokens_per_image
            frames_fit = CONTEXT // (tpi + 2)
            print(f"  [صورة] {p.parent.name}/{p.name}: sha {sha(p)} | خطوة {step:,} | {c.image_size}px | {tpi} رمزاً/صورة | مدونة {c.num_codes}"
                  f" | رموز مستعملة {used}/{c.num_codes} (تنوّع {perplex:.0f}) | خطأ إعادة البناء {mse:.3f} مقابل خط الأساس {base:.3f}"
                  f" | إطارات فيديو تتسع في {CONTEXT}: {frames_fit} (= {frames_fit / 2:.0f} ثانية بمعدل 2 إطار/ث)")
        except Exception as exc:
            print(f"  [صورة] {p}: فشل ({type(exc).__name__}: {str(exc)[:120]})")
    for p in sorted(root.rglob("audio_tokenizer.pt")):
        try:
            tk, step = load_audio(p)
            tk.eval()
            c = tk.cfg
            torch.manual_seed(0)
            t = torch.linspace(0, 1, c.segment_frames)
            f = torch.linspace(0, 1, c.n_mels)
            mels = torch.stack([torch.sin((i + 1) * 6 * t)[None, :] * torch.cos((i % 3 + 1) * 4 * f)[:, None] for i in range(16)])[:, None]
            mels = (mels + 0.1 * torch.randn_like(mels)).clamp(-1, 1)
            with torch.no_grad():
                ids = tk.encode(mels)
                rec = tk.decode(ids)
            used = int(ids.unique().numel())
            mse = float((rec - mels).pow(2).mean())
            base = float((mels - mels.mean(dim=(2, 3), keepdim=True)).pow(2).mean())
            tps = (c.n_mels // c.downsample_factor) * (c.segment_frames // c.downsample_factor)
            secs = c.segment_frames * 0.01
            print(f"  [صوت] {p.parent.name}/{p.name}: sha {sha(p)} | خطوة {step:,} | {c.n_mels} ميل × {c.segment_frames} إطاراً = {secs:.2f} ثانية/مقطع"
                  f" | {tps} رمزاً/مقطع ({tps / secs:.0f} رمزاً/ث) | مدونة {c.num_codes} | مستعمل {used}/{c.num_codes}"
                  f" | خطأ {mse:.3f} مقابل أساس {base:.3f} | مقاطع تتسع في {CONTEXT}: {CONTEXT // (tps + 2)} (= {CONTEXT // (tps + 2) * secs:.0f} ثانية)")
        except Exception as exc:
            print(f"  [صوت] {p}: فشل ({type(exc).__name__}: {str(exc)[:120]})")


def main() -> int:
    import torch
    from checkpoint import load_checkpoint
    from sham_inputs import fetch_dataset
    from text_tokenizer import ShamTextTokenizer
    import sham_text_mix

    WORK.mkdir(parents=True, exist_ok=True)
    files = sham_text_mix.stream_mix(str(WORK / "text"), max_documents=140, seed=4242, documents_per_file=70)
    docs = [d for f in files if f.endswith(".txt") for d in Path(f).read_text(encoding="utf-8").split("\n\n") if len(d) > 200]
    ar = "\n".join(d for d in docs if arabic_ratio(d) > 0.6)
    other = "\n".join(d for d in docs if arabic_ratio(d) <= 0.6)
    print(f"النص الثابت: {len(docs)} وثيقة | عربي {len(ar):,} حرفاً | غير عربي {len(other):,} حرفاً")

    general = SHAM / "sham_general_tokenizer.json"
    print(f"المُرمِّز العام في المستودع: sha {sha(general)} | مفردات {ShamTextTokenizer.load(general).vocab_size}")
    tokenizers = {"general": ShamTextTokenizer.load(general)}

    for name in DATASETS:
        print(f"\n===== {name} =====")
        try:
            root = fetch_dataset(name)
        except Exception as exc:
            print(f"تعذّر التنزيل: {type(exc).__name__}")
            continue
        if not root:
            print("غير موجودة / فارغة")
            continue
        pts = sorted(root.rglob("*.pt"), key=lambda p: p.stat().st_size, reverse=True)
        toks = sorted(root.rglob("*tokenizer*.json"))
        print("ملفات .pt: " + ", ".join(f"{p.name} ({p.stat().st_size // 2**20}MB)" for p in pts[:6]))
        own = {}
        for t in toks:
            try:
                tk = ShamTextTokenizer.load(t)
                own[t.name + "@" + sha(t)] = tk
                print(f"مُرمِّز {t.name}: sha {sha(t)} | مفردات {tk.vocab_size}" + (" | = العام" if sha(t) == sha(general) else " | ≠ العام"))
            except Exception as exc:
                print(f"مُرمِّز {t.name}: لم يُقرأ ({type(exc).__name__})")
        media_check(root)
        ckpt = next((p for p in pts if p.name.startswith("final") or "checkpoint" in p.name or "step" in p.name), pts[0] if pts else None)
        if ckpt is None:
            print("لا نقطة حفظ")
            continue
        try:
            model, step, _ = load_checkpoint(ckpt, map_location="cpu")
        except Exception as exc:
            print(f"تعذّر تحميل {ckpt.name}: {type(exc).__name__}: {str(exc)[:120]}")
            continue
        model.eval()
        print(f"نقطة الحفظ {ckpt.name}: خطوة {step:,} | معاملات {sum(p.numel() for p in model.parameters()) / 1e6:.0f}M | مفردات النموذج {model.cfg.vocab_size}")
        try:
            from model import AUDIO_VOCAB_SIZE, IMAGE_VOCAB_SIZE, TEXT_VOCAB_SIZE
            w = model.token_embedding.weight.detach()
            a0, a1 = TEXT_VOCAB_SIZE, TEXT_VOCAB_SIZE + IMAGE_VOCAB_SIZE
            parts = {"نص": w[:a0], "صورة": w[a0:a1], "صوت": w[a1:a1 + AUDIO_VOCAB_SIZE]}
            print("  متوسط نظم صفوف التضمين (صف لم يُدرَّب يبقى قرب قيمة البداية): "
                  + " | ".join(f"{k} {float(v.norm(dim=1).mean()):.3f} (أقل صف {float(v.norm(dim=1).min()):.3f})" for k, v in parts.items()))
        except Exception as exc:
            print(f"  تعذّر فحص التضمين: {type(exc).__name__}")
        pairings = dict(own)
        pairings["general(repo)"] = tokenizers["general"]
        for label, tk in pairings.items():
            if tk.vocab_size > model.cfg.vocab_size:
                continue
            row = []
            for part, text in (("عربي", ar), ("غيره", other)):
                if not text:
                    continue
                ids = tk.encode(text)
                L = min(256, model.cfg.max_seq_len)
                wins = [ids[i:i + L] for i in range(0, len(ids) - L + 1, L)][:12]
                if not wins:
                    continue
                tot = 0.0
                with torch.no_grad():
                    for w in wins:
                        x = torch.tensor([w])
                        tot += float(model(x, labels=x)[1])
                loss = tot / len(wins)
                bpc = loss * len(ids) / max(len(text), 1) / math.log(2)
                row.append(f"{part}: خسارة/رمز {loss:.2f}، بت/حرف {bpc:.2f}")
            from generate import generate_tokens
            from model import SpecialTokens
            q = tk.encode("اللغة العربية هي")
            torch.manual_seed(0)
            out = generate_tokens(model, torch.tensor([[SpecialTokens.BOS] + q]), 30, temperature=0.7, top_k=40, eos_id=SpecialTokens.EOS,
                                  allowed_ranges=[(0, tk.vocab_size)] * 30)
            sample = tk.decode([i for i in out[0, len(q) + 1:].tolist() if i != SpecialTokens.EOS])
            print(f"  مع {label}: " + " | ".join(row) + f"\n     عيّنة: {sample[:140]!r}")
        del model
    print("\nانتهى الفحص:", time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
