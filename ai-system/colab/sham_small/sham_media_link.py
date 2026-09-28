"""
Text <-> image / sound linking, measured and protected — used by stage 2 and
the chat stage so every later change lands here, not in notebook cells.

1. Honest data accounting: how many pairs were collected, how many were lost
   and why (duplicate, broken, unlicensed, filtered in the Dataset), with a
   loud warning when most of the data disappears.
2. Tokenizer identity: a fingerprint of each image/audio tokenizer, compared
   with the files saved next to the checkpoint — the model must keep speaking
   the exact "words" it was trained with (no silent re-initialisation).
3. A fixed yardstick for the link itself: the SAME held-out pairs every run
   (the first ones of the first source, excluded from training through the
   ledger), scored in both directions —
       caption -> image/sound  (generation: loss on the media tokens only)
       image/sound -> caption  (understanding: loss on the caption only)
   before and after each session, printed side by side.
4. Session mix: more text<->media batches per session (the link is what these
   stages exist to teach), with text rehearsal kept at a smaller share.
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path

import torch
import torch.nn.functional as F

from model import SpecialTokens

IGNORE = -100
FIXED_PAIRS = 32


# ---------------------------------------------------------------- 1) accounting

def data_report(kind: str, stats, dataset=None) -> str:
    """One clear block per modality. `stats` is sham_data_sources.CollectStats."""
    seen = stats.written + stats.duplicates + stats.dropped + getattr(stats, "unlicensed", 0)
    kept = len(dataset) if dataset is not None else stats.written
    skipped = getattr(dataset, "skipped_entries", 0) if dataset is not None else 0
    lines = [
        f"📦 بيانات {kind}: فُحص {seen:,} → جُمع {stats.written:,} → دخل التدريب {kept:,}",
        f"   مستبعد: مكرر {stats.duplicates:,} | تالف/فارغ {stats.dropped:,} | غير مرخّص {getattr(stats, 'unlicensed', 0):,}"
        f" | فلتر الـDataset {skipped:,}",
    ]
    lost = seen - kept
    if seen and lost / seen > 0.5:
        lines.append(f"   ⚠ ضاع أكثر من نصف ما فُحص ({lost:,} من {seen:,}) — راجعي السبب أعلاه.")
    if stats.written and skipped / max(stats.written, 1) > 0.2:
        lines.append(f"   ⚠ فلتر الـDataset حذف {skipped:,} من {stats.written:,} — أكثر من 20%.")
    text = "\n".join(lines)
    print(text)
    return text


# ---------------------------------------------------------------- 2) identity

def tokenizer_fingerprint(tok) -> str:
    h = hashlib.sha1()
    for name, t in sorted(tok.state_dict().items()):
        h.update(name.encode())
        h.update(t.detach().cpu().contiguous().numpy().tobytes())
    return h.hexdigest()[:12]


def confirm_saved_tokenizers(image_tok, audio_tok, checkpoint_dir) -> bool:
    """Prints, for each modality, whether the tokenizer in use is bit-for-bit
    the one saved next to the checkpoint. Returns True when both match."""
    from tokenizer_select import robust_load

    ok = True
    for kind, tok in (("image", image_tok), ("audio", audio_tok)):
        saved = sorted(Path(checkpoint_dir).rglob(f"{kind}_tokenizer.pt")) if checkpoint_dir else []
        mine = tokenizer_fingerprint(tok)
        if not saved:
            print(f"🔑 أداة {kind}: بصمة {mine} — لا توجد أداة محفوظة مع النقطة للمقارنة (أول تشغيل).")
            continue
        theirs = tokenizer_fingerprint(robust_load(saved[0], kind)[0])
        if mine == theirs:
            print(f"🔑 أداة {kind}: ✅ نفس الأداة المحفوظة مع النقطة (بصمة {mine}) — لا إعادة تهيئة.")
        else:
            ok = False
            print(f"🔑 أداة {kind}: ⚠ مختلفة عن المحفوظة مع النقطة ({mine} ≠ {theirs}). "
                  f"هذا متوقَّع فقط عند التبديل المُعلن من أداة منهارة إلى أداة مُحياة (⇄ أعلاه).")
    return ok


# ---------------------------------------------------------------- 3) fixed yardstick

def collect_fixed_pairs(kinds, ledgers: dict, workdir="/kaggle/working/fixed_pairs", image_size: int = 256):
    """Collects the SAME first FIXED_PAIRS pairs of each modality every run
    (a fresh, empty ledger always starts at the first source's beginning),
    then merges their fingerprints and positions into the training ledgers so
    training never uses them. Returns {kind: manifest_path}."""
    from sham_data_sources import Ledger, collect

    out = {}
    for kind in kinds:
        fixed_ledger = Ledger(kind, name=f"fixed_{kind}")
        try:
            manifest, stats = collect(kind, f"{workdir}/{kind}", FIXED_PAIRS, fixed_ledger, image_size=image_size)
        except Exception as exc:
            print(f"⚠ تعذّر تجهيز الأزواج الثابتة ({kind}): {exc}")
            continue
        if stats.written:
            ledgers[kind].merge(fixed_ledger.to_json())
            out[kind] = manifest
            print(f"📏 أزواج ثابتة ({kind}): {stats.written} — تُستبعد من التدريب وتُقاس قبل الجلسة وبعدها.")
    return out


def _pairs(kind, manifest, tokenizer, media_tok):
    from dataset import AudioMultimodalCollator, AudioTranscriptDataset, ImageCaptionDataset, MultimodalCollator

    if kind == "image":
        ds = ImageCaptionDataset(manifest, image_size=media_tok.cfg.image_size)
        encode = MultimodalCollator(tokenizer, media_tok).encode_batch_images
    else:
        ds = AudioTranscriptDataset(manifest, n_mels=media_tok.cfg.n_mels, segment_frames=media_tok.cfg.segment_frames)
        encode = AudioMultimodalCollator(tokenizer, media_tok).encode_batch_audio
    items = [ds[i] for i in range(len(ds))]
    with torch.no_grad():
        media = encode(items).tolist() if items else []
    return [(c, tokenizer.encode(c), m) for (c, _), m in zip(items, media)]


def _span(kind):
    return (SpecialTokens.IMAGE_START, SpecialTokens.IMAGE_END) if kind == "image" else (
        SpecialTokens.AUDIO_START, SpecialTokens.AUDIO_END)


def _examples(kind, pairs, chat: bool, tokenizer=None):
    """(ids, labels) per direction; labels only on the target part."""
    start, end = _span(kind)
    gen, und = [], []
    if chat:
        from sham_chat import build_media_chat_examples
        import random

        rng = random.Random(0)
        for text, _cap, media in pairs:
            u, c = build_media_chat_examples(tokenizer.encode, text, media, kind, rng)
            und.append(u)
            gen.append(c)
        return gen, und
    for _text, cap, media in pairs:
        span = [start] + media + [end]
        g = [SpecialTokens.BOS] + cap + span + [SpecialTokens.EOS]
        gen.append((g, [IGNORE] * (1 + len(cap)) + span + [SpecialTokens.EOS]))
        u = [SpecialTokens.BOS] + span + cap + [SpecialTokens.EOS]
        und.append((u, [IGNORE] * (1 + len(span)) + cap + [SpecialTokens.EOS]))
    return gen, und


@torch.no_grad()
def _loss(model, examples, device, batch_size: int = 8) -> float:
    from sham_chat import pad_batch

    model.eval()
    total, count = 0.0, 0
    for s in range(0, len(examples), batch_size):
        ids, labels = pad_batch(examples[s:s + batch_size])
        logits = model(ids.to(device))[0][:, :-1].float()
        target = labels[:, 1:].to(device)
        total += float(F.cross_entropy(logits.reshape(-1, logits.size(-1)), target.reshape(-1),
                                       ignore_index=IGNORE, reduction="sum"))
        count += int((target != IGNORE).sum())
    model.train()
    return total / max(count, 1)


def measure_link(model, tokenizer, media_tokenizers: dict, fixed: dict, device: str, chat: bool = False) -> dict:
    """{'image→وصف': loss, 'وصف→image': loss, ...} on the fixed pairs."""
    out = {}
    for kind, manifest in fixed.items():
        pairs = _pairs(kind, manifest, tokenizer, media_tokenizers[kind])
        if not pairs:
            continue
        gen, und = _examples(kind, pairs, chat, tokenizer)
        name = "صورة" if kind == "image" else "صوت"
        out[f"وصف→{name}"] = _loss(model, gen, device)
        out[f"{name}→وصف"] = _loss(model, und, device)
    return out


def link_report(before: dict, after: dict | None = None) -> str:
    lines = ["🔗 ربط النص بالوسائط على الأزواج الثابتة (خسارة، أقل = أفضل):"]
    for k, v in before.items():
        if after and k in after:
            d = after[k] - v
            lines.append(f"   {k}: {v:.3f} → {after[k]:.3f} ({'⬇' if d < 0 else '⬆'} {abs(d):.3f})")
        else:
            lines.append(f"   {k}: {v:.3f} (≈ احتمال {math.exp(-min(v, 30)):.2e} للرمز الصحيح)")
    text = "\n".join(lines)
    print(text)
    return text


# ---------------------------------------------------------------- 4) session mix

MEDIA_PASSES = 2          # every pair seen at most twice per session
TEXT_SHARE = 0.5          # one text-rehearsal batch per two media batches (was 1:1)


def session_batches(media_batches: list, tokenizer, seq_len: int, batch_size: int, budget: int,
                    seen_articles: int = 0, workdir: str = "/kaggle/working/replay_text") -> tuple[list, str]:
    """Media-heavy session list: media batches (×MEDIA_PASSES) interleaved with
    a smaller share of Arabic text rehearsal, cut to the session's budget."""
    from sham_chat import interleave, text_replay_batches

    media = media_batches * MEDIA_PASSES
    n_text = int(len(media) * TEXT_SHARE)
    text = text_replay_batches(tokenizer, seq_len, batch_size, n_text, workdir,
                               max_position=min(max(seen_articles, 5_000), 20_000)) if n_text else []
    batches = interleave([media, text], [1.0, TEXT_SHARE])[:budget]
    share = len(media) / max(len(media) + len(text), 1)
    note = (f"دفعات الجلسة: {len(batches):,} — وسائط {len(media):,} ({share:.0%}) + نص للتذكّر {len(text):,}"
            f"{' (قُصّت إلى وقت الجلسة)' if len(media) + len(text) > budget else ''}")
    print(note)
    return batches, note
