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
