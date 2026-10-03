"""
Sham's live trainer ("المدرّب الحي") — the engineer's idea (collect and train
at the same time, no waiting), rebuilt with Sham's real formats and fixed:

    spider network (sham_spider.py, many free sources, no repeats)
        ↓ Items                                    (threads, I/O)
    encoders: text → chunks; image/audio/video → Sham's OWN tokenizers,
              paired with their captions in BOTH directions (describe ↔ create)
        ↓ (ids, labels) examples                   (threads)
    trainer: token-budget batches, warm-up + time-based cosine LR, a share
             of dialogue rehearsal (so chat is not forgotten), the
             contrastive text↔media link loss, an EMA copy of the weights
        ↓
    refinery: held-out loss per modality for the raw AND the EMA weights;
              the better one is saved as final.pt
        ↓
    outputs: sham-crawl-checkpoint  (final.pt + the exact tokenizers +
             progress + fingerprints) — the chat stage repairs it and merges
             it through the guard; sham-crawl-corpus (text shards) — joins
             the chat stage's rehearsal automatically.

What changed versus the engineer's cell and why:
  • one audio file and one video file were fetched again and again (hence
    loss 0.006 = memorised); now every item is new (fingerprints kept
    across sessions)
  • images had no captions (nothing to link); now every picture/sound/video
    comes with its text, trained in both directions
  • batch of ONE sequence at lr 3e-4 constant → batches by token budget,
    lr 5e-5 with warm-up and cosine, gradient clipping, dialogue rehearsal
  • audio decoded as if it were 16 kHz → resampled to 16 kHz mono properly
  • published INTO stage 2's dataset → its own dataset, never over another stage
  • resumes from the main line of Sham (chat stage, else stage 2) with the
    tokenizers saved next to it, or from its own previous session when the
    tokenizers are still identical
"""

from __future__ import annotations

import io
import json
import math
import os
import queue
import random
import shutil
import threading
import time
from pathlib import Path

import torch

WORK = Path("/kaggle/working")
MODEL_DATASET = "sham-crawl-checkpoint"
CORPUS_DATASET = "sham-crawl-corpus"


def dataset_names(name: str | None) -> tuple[str, str]:
    """Each collection notebook has its own pair of datasets. No name → the
    original pair; name="news" → sham-crawl-news / sham-crawl-news-corpus.
    The chat stage finds every sham-crawl-* dataset automatically."""
    if not name:
        return MODEL_DATASET, CORPUS_DATASET
    slug = "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")
    return f"sham-crawl-{slug}", f"sham-crawl-{slug}-corpus"
TARGETS = {"text": 0.45, "image": 0.30, "audio": 0.15, "video": 0.10}
HOLDOUT_PER_KIND = 12
REHEARSAL_SHARE = 0.15
LR, MIN_LR_RATIO, WARMUP = 5e-5, 0.1, 200
EMA_DECAY = 0.999
SAVE_EVERY_GPU, SAVE_EVERY_CPU = 20 * 60, 60 * 60   # a check = two held-out evaluations: rarer on a slow CPU
VIDEO_KEYFRAMES = 2
SAMPLE_RATE = 16000


# ---------------------------------------------------------------- start point

def _load_tokenizers(root: Path):
    from text_tokenizer import ShamTextTokenizer
    from tokenizer_select import select_pretrained_tokenizer

    text = ShamTextTokenizer.load(str(sorted(root.rglob("sham_small_tokenizer.json"))[0]))
    img = select_pretrained_tokenizer("image", root)
    aud = select_pretrained_tokenizer("audio", root)
    if not img or not aud:
        raise FileNotFoundError(f"أداتا الصورة/الصوت غير موجودتين بجانب نقطة الحفظ في {root}")
    return text, img, aud


def _same_tokenizers(a: Path, b: Path) -> bool:
    from sham_media_link import tokenizer_fingerprint

    try:
        ta, ia, aa = _load_tokenizers(a)
        tb, ib, ab = _load_tokenizers(b)
    except Exception:
        return False
    return (ta._tokenizer.get_vocab() == tb._tokenizer.get_vocab()
            and tokenizer_fingerprint(ia[0]) == tokenizer_fingerprint(ib[0])
            and tokenizer_fingerprint(aa[0]) == tokenizer_fingerprint(ab[0]))


def resolve_start(model_dataset: str = MODEL_DATASET):
    """(checkpoint path, its folder, progress dict, origin label)."""
    from sham_inputs import fetch_dataset

    main = None
    for name, pattern in (("sham-chat-checkpoint", "final_chat.pt"), ("sham-multimodal-checkpoint", "final_multimodal.pt")):
        root = fetch_dataset(name)
        hits = sorted(root.rglob(pattern)) if root else []
        if hits:
            main = (hits[0], hits[0].parent, name)
            break
    own = fetch_dataset(model_dataset)
    progress = {}
    if own:
        for p in own.rglob("crawl_progress.json"):
            try:
                progress = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                pass
    own_ckpt = sorted(own.rglob("final.pt")) if own else []
    if own_ckpt and progress.get("by") == "sham_live" and (main is None or _same_tokenizers(own_ckpt[0].parent, main[1])):
        return own_ckpt[0], own_ckpt[0].parent, progress, f"{model_dataset} (جلسة سابقة لهذا المدرّب)"
    if main is None:
        raise FileNotFoundError("لا توجد نقطة حفظ للمحادثة ولا للمرحلة الثانية — شغّلي إحداهما أولاً.")
    base = {"by": "sham_live", "base": main[2]}
    if progress.get("by") == "sham_live":
        base.update({k: progress[k] for k in ("sessions", "seen_total") if k in progress})
    return main[0], main[1], base, f"{main[2]} (الخط الرئيسي لشام)"


# ---------------------------------------------------------------- encoders

def _image_tensor(data: bytes, size: int) -> torch.Tensor:
    from PIL import Image
    import numpy as np

    img = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = img.size
    s = min(w, h)
    img = img.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((size, size))
    return torch.from_numpy(np.asarray(img, dtype="float32")).permute(2, 0, 1) / 127.5 - 1.0


def decode_audio(data: bytes, seconds: float = 4.0) -> torch.Tensor | None:
    """Any container/codec → 16 kHz mono float in [-1, 1]."""
    import av
    import numpy as np

    with av.open(io.BytesIO(data)) as c:
        if not c.streams.audio:
            return None
        res = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
        chunks, n = [], 0
        for frame in c.decode(audio=0):
            for f in res.resample(frame):
                arr = f.to_ndarray().reshape(-1)
                chunks.append(arr)
                n += arr.size
            if n >= SAMPLE_RATE * seconds:
                break
        for f in res.resample(None):
            chunks.append(f.to_ndarray().reshape(-1))
    if not chunks:
        return None
    wave = torch.from_numpy(np.concatenate(chunks).astype("float32"))
    peak = float(wave.abs().max())
    return wave / peak if peak > 1e-4 else None


def video_frames(data: bytes, k: int):
    """k frames spread over the clip (PIL images) + the clip's sound (or None)."""
    import av

    with av.open(io.BytesIO(data)) as c:
        vs = c.streams.video[0]
        dur = float(vs.duration * vs.time_base) if vs.duration else (c.duration / 1e6 if c.duration else 0)
        frames = []
        targets = [dur * (i + 1) / (k + 1) for i in range(k)] if dur > 0 else []
        for t in targets:
            try:
                c.seek(int(t / vs.time_base), stream=vs)
                frames.append(next(c.decode(video=0)).to_image())
            except Exception:
                break
        if len(frames) < k:
            c.seek(0)
            frames = [f.to_image() for _, f in zip(range(k), c.decode(video=0))]
    try:
        sound = decode_audio(data, seconds=3.0)
    except Exception:
        sound = None
    return frames, sound


class Encoder:
    """Item → list of (ids, labels) in the exact layouts the other stages use."""

    def __init__(self, tokenizer, image_tok, audio_tok, max_len: int, device: str):
        self.tok, self.img, self.aud = tokenizer, image_tok, audio_tok
        self.max_len, self.device = max_len, device
        self.lock = threading.Lock()  # tokenizers run on one device; keep their calls serial

    def _img_ids(self, tensors: torch.Tensor):
        from model import image_token_id_to_vocab_id
        with self.lock, torch.no_grad():
            codes = self.img.encode(tensors.to(self.device)).cpu()
        return [image_token_id_to_vocab_id(c.view(-1)).tolist() for c in codes]

    def _aud_ids(self, wave: torch.Tensor):
        from mel_spectrogram import waveform_to_mel_spectrogram
        from model import audio_token_id_to_vocab_id
        mel = waveform_to_mel_spectrogram(wave, SAMPLE_RATE, self.aud.cfg.n_mels, self.aud.cfg.segment_frames)
        with self.lock, torch.no_grad():
            codes = self.aud.encode(mel.unsqueeze(0).to(self.device)).cpu()
        return audio_token_id_to_vocab_id(codes.view(1, -1))[0].tolist()

    def text_examples(self, text: str):
        from model import SpecialTokens
        ids = self.tok.encode(text)
        room = self.max_len - 2
        out = []
        for s in range(0, len(ids), room):
            chunk = ids[s:s + room]
            if len(chunk) >= 8:
                seq = [SpecialTokens.BOS] + chunk + [SpecialTokens.EOS]
                out.append((seq, list(seq)))
        return out

    def __call__(self, item, rng) -> list:
        from sham_chat import build_media_chat_examples, build_video_chat_examples
        caption = item.text[:300]
        if item.kind == "text":
            return self.text_examples(item.text)
        if item.kind == "image":
            ids = self._img_ids(_image_tensor(item.data, self.img.cfg.image_size).unsqueeze(0))[0]
            return build_media_chat_examples(self.tok.encode, caption, ids, "image", rng)
        if item.kind == "audio":
            wave = decode_audio(item.data)
            if wave is None:
                return []
            return build_media_chat_examples(self.tok.encode, caption, self._aud_ids(wave), "audio", rng)
        if item.kind == "video":
            if item.source.startswith("mirror_"):
                rec = json.loads(item.data)
                from PIL import Image
                frames = [Image.open(io.BytesIO(bytes.fromhex(f))) for f in rec["frames"]]
                idx = [round(i * (len(frames) - 1) / max(VIDEO_KEYFRAMES - 1, 1)) for i in range(VIDEO_KEYFRAMES)]
                frames = [frames[i] for i in idx]
                sound = decode_audio(bytes.fromhex(rec["wav"]), 3.0) if rec.get("wav") else None
            else:
                frames, sound = video_frames(item.data, VIDEO_KEYFRAMES)
            if len(frames) < VIDEO_KEYFRAMES:
                return []
            size = self.img.cfg.image_size
            buf = []
            for fr in frames:
                b = io.BytesIO()
                fr.convert("RGB").save(b, format="PNG")
                buf.append(_image_tensor(b.getvalue(), size))
            frame_ids = self._img_ids(torch.stack(buf))
            audio_ids = self._aud_ids(sound) if sound is not None else None
            return [ex for ex in build_video_chat_examples(self.tok.encode, caption, frame_ids, audio_ids, rng)
                    if len(ex[0]) <= self.max_len]
        return []


# ---------------------------------------------------------------- training helpers

def lr_at(step: int, elapsed: float, budget: float) -> float:
    warm = min(1.0, (step + 1) / WARMUP)
    frac = min(1.0, elapsed / max(budget, 1.0))
    cos = MIN_LR_RATIO + (1 - MIN_LR_RATIO) * 0.5 * (1 + math.cos(math.pi * frac))
    return LR * warm * cos


class EMA:
    def __init__(self, model, decay: float):
        self.decay = decay
        self.shadow = {n: p.detach().clone() for n, p in model.named_parameters()}

    @torch.no_grad()
    def update(self, model):
        for n, p in model.named_parameters():
            self.shadow[n].mul_(self.decay).add_(p.detach(), alpha=1 - self.decay)

    @torch.no_grad()
    def swap(self, model):
        for n, p in model.named_parameters():
            tmp = p.detach().clone()
            p.copy_(self.shadow[n])
            self.shadow[n].copy_(tmp)


@torch.no_grad()
def holdout_loss(model, holdout: dict, device: str, kinds=None) -> dict:
    """Loss per skill on its held-out set — only on a set that is already FULL, so the very same
    examples are used by every later measurement and the numbers can be compared."""
    from sham_media_link import _loss
    out = {k: _loss(model, v, device) for k, v in holdout.items()
           if len(v) >= HOLDOUT_PER_KIND and (kinds is None or k in kinds)}
    model.train()
    return out


def make_batches(examples: list, token_budget: int):
    """Similar lengths together; each batch ≤ token_budget padded tokens."""
    from sham_chat import pad_batch
    examples = sorted(examples, key=lambda e: len(e[0]))
    batch, out = [], []
    for ex in examples:
        longest = max([len(e[0]) for e in batch] + [len(ex[0])])
        if batch and longest * (len(batch) + 1) > token_budget:
            out.append(pad_batch(batch))
            batch = []
        batch.append(ex)
    if batch:
        out.append(pad_batch(batch))
    return out


# ---------------------------------------------------------------- run

def run(hours: float | None = None, workers: int | None = None, publish_every_hours: float = 3.0,
        mirrors: bool = True, video: bool = True, dry_run_steps: int | None = None, name: str | None = None) -> dict:
    """The whole live session. dry_run_steps: stop after that many steps
    (used by the offline test)."""
    from checkpoint import load_checkpoint, save_checkpoint
    from sham_chat import build_chat_example, load_arabic_dialogues
    from sham_inputs import publish_dataset
    from sham_link_contrast import attach, report as link_report
    import sham_spider
    from sham_guard import Guard
    from sham_selfdev import record as selfdev_record, summary as selfdev_summary
    from sham_spider import Seen, Spider, default_sources
    from train import build_optimizer
    from train_audio_tokenizer import save_tokenizer_checkpoint as save_aud
    from train_image_tokenizer import save_tokenizer_checkpoint as save_img

    t_start = time.time()
    cuda = torch.cuda.is_available()
    device = "cuda" if cuda else "cpu"
    hours = hours if hours is not None else (7.0 if cuda else 11.0)
    budget = hours * 3600 - 25 * 60  # the last 25 minutes: refine, save, publish
    workers = workers or (16 if cuda else 10)
    token_budget = 8192 if cuda else 2048
    print(f"المدرّب الحي — الجهاز {device}، مدة {hours:.1f} ساعة، {workers} خيط جمع")

    model_ds, corpus_ds = dataset_names(name)
    print(f"المخارج: النموذج → {model_ds} | النصوص → {corpus_ds}")
    ckpt, ckpt_dir, progress, origin = resolve_start(model_ds)
    model, step, _ = load_checkpoint(ckpt, map_location=device)
    tokenizer, (img_tok, img_step, _), (aud_tok, aud_step, _) = _load_tokenizers(ckpt_dir)
    img_tok, aud_tok = img_tok.to(device).eval(), aud_tok.to(device).eval()
    max_len = min(1024, model.cfg.max_seq_len)
    print(f"نقطة الانطلاق: {origin} — {ckpt.name}، الخطوة {step:,}")

    out = WORK / "checkpoints"
    out.mkdir(parents=True, exist_ok=True)
    tokenizer.save(str(out / "sham_small_tokenizer.json"))
    save_img(out / "image_tokenizer.pt", img_tok.cpu(), step=img_step)
    save_aud(out / "audio_tokenizer.pt", aud_tok.cpu(), step=aud_step)
    img_tok, aud_tok = img_tok.to(device), aud_tok.to(device)

    seen_path = next(iter(ckpt_dir.rglob("crawl_seen.json")), None)
    seen = Seen.load(seen_path) if seen_path else Seen()
    # `seen` stops the spider from emitting anything twice in this session;
    # `kept` (what is saved) only grows with items actually encoded, so items
    # still waiting in a queue when the session ends are collected next time.
    kept = Seen(list(seen._keys))
    print(f"بصمات سابقة (لن يُجمع أي منها مرة أخرى): {len(seen):,}")
    urls_path = next(iter(ckpt_dir.rglob("crawl_urls.json")), None)
    sham_spider.URL_SEEN = Seen.load(urls_path) if urls_path else Seen()
    print(f"عناوين سبقت زيارتها (لا تُحمَّل ثانيةً): {len(sham_spider.URL_SEEN):,}")

    # — the spider network and the encoders
    raw_q, enc_q = queue.Queue(maxsize=256), queue.Queue(maxsize=512)
    ledgers = {}
    spider = Spider(default_sources(WORK / "live_mirror", ledgers, mirrors=mirrors, video=video),
                    seen, raw_q, TARGETS if video else {k: v for k, v in TARGETS.items() if k != "video"},
                    workers=workers, seed=step).start()
    encoder = Encoder(tokenizer, img_tok, aud_tok, max_len, device)
    stop = threading.Event()
    counts = {"encoded": 0, "failed": 0}
    corpus_dir = WORK / "crawl_corpus" / "text"
    corpus_dir.mkdir(parents=True, exist_ok=True)
    shard = open(corpus_dir / f"live_{int(time.time())}.txt", "a", encoding="utf-8")
    shard_lock = threading.Lock()

    def encode_loop(i):
        rng = random.Random(step + i)
        while not stop.is_set():
            try:
                item = raw_q.get(timeout=2)
            except queue.Empty:
                continue
            try:
                exs = [e for e in encoder(item, rng) if len(e[0]) <= max_len]
            except Exception:
                counts["failed"] += 1
                continue
            if item.kind == "text":
                with shard_lock:
                    shard.write(item.text.replace("\n", " ") + "\n")
            for ex in exs:
                enc_q.put((item.kind, ex))
            kept.add_new(item.key)
            counts["encoded"] += 1

    for i in range(3):
        threading.Thread(target=encode_loop, args=(i,), daemon=True).start()

    # — dialogue rehearsal (chat must not be forgotten). The HF download can fail (a live report had no
    # chat at all, so no "before" and no rehearsal): retry, then fall back to the copy saved with the checkpoint.
    dialogues = []
    for attempt, wait in enumerate((0, 20, 60)):
        time.sleep(wait)
        try:
            dialogues, dprog = load_arabic_dialogues(progress.get("dialogues", {}), 3000)
            progress["dialogues"] = dprog
            (out / "rehearsal_cache.json").write_text(json.dumps(dialogues, ensure_ascii=False), encoding="utf-8")
            break
        except Exception as exc:
            print(f"⚠ تعذّر تحميل حوارات التذكّر (محاولة {attempt + 1}/3): {str(exc)[:120]}")
    if not dialogues:
        cached = next(iter(ckpt_dir.rglob("rehearsal_cache.json")), None)
        if cached:
            try:
                dialogues = [tuple(x) for x in json.loads(cached.read_text(encoding="utf-8"))]
                (out / "rehearsal_cache.json").write_text(json.dumps(dialogues, ensure_ascii=False), encoding="utf-8")
                print(f"↩ حوارات التذكّر من النسخة المحفوظة مع النقطة: {len(dialogues):,}")
            except Exception as exc:
                print(f"⚠ نسخة الحوارات المحفوظة تالفة: {exc}")
    if not dialogues:
        print("⚠ لا حوارات للتذكّر هذه الجلسة — المحادثة لن تُقاس ولن تُذكَّر")
    rehearsal = [build_chat_example(tokenizer.encode(q), tokenizer.encode(a), max_len=max_len) for q, a in dialogues]
    random.Random(step).shuffle(rehearsal)

    # — held-out yardstick: the first examples of each modality are never trained on
    holdout = {k: [] for k in TARGETS}
    holdout["chat"] = rehearsal[:HOLDOUT_PER_KIND]
    rehearsal = rehearsal[HOLDOUT_PER_KIND:]

    optimizer = build_optimizer(model, lr=LR, weight_decay=0.1)
    detach_link = attach(model)
    ema = EMA(model, EMA_DECAY)
    guard = Guard(model, base_rehearsal=REHEARSAL_SHARE)   # remembers the starting weights = the reference
    save_every = SAVE_EVERY_GPU if cuda else SAVE_EVERY_CPU
    model.train()
    start_step, pending, losses = step, [], []
    trained_kind = {k: 0 for k in list(TARGETS) + ["chat"]}
    last_log = last_save = last_pub = time.time()
    t_train = time.time()

    def save(tag=""):
        # score the current weights (raw and EMA) on every skill's held-out set against the starting
        # weights; keep the best, roll back on a clear regression; publish ALWAYS the best weights
        r = guard.evaluate(model, ema, lambda kinds=None: holdout_loss(model, holdout, device, kinds))
        with guard.best_loaded(model):
            save_checkpoint(out / "final.pt", model, step)
        model.train()
        kept.save(out / "crawl_seen.json")
        sham_spider.URL_SEEN.save(out / "crawl_urls.json")
        for ledger in ledgers.values():
            ledger.save(out)
        chosen = dict(guard.best_losses)
        progress.update({"by": "sham_live", "step": step, "holdout": chosen, "baseline": dict(guard.base),
                         "weights": guard.best_flavor, "guard_score": guard.best_score, "rollbacks": guard.rollbacks,
                         "seen_total": len(kept), "sources": {s.name: s.items for s in spider.sources},
                         "sessions": int(progress.get("sessions", 0)) + (1 if tag == "final" else 0)})
        (out / "crawl_progress.json").write_text(json.dumps(progress, ensure_ascii=False), encoding="utf-8")
        print(f"💾 حفظ الخطوة {step:,} — {guard.line(r)}\n   تحقق (أفضل نقطة): "
              + ", ".join(f"{k} {guard.base.get(k, float('nan')):.3f}→{v:.3f}" for k, v in chosen.items()))
        return chosen

    def publish(message):
        snap = WORK / "for_crawl_publish"
        shutil.rmtree(snap, ignore_errors=True)
        snap.mkdir(parents=True)
        for f in ("final.pt", "sham_small_tokenizer.json", "image_tokenizer.pt", "audio_tokenizer.pt",
                  "crawl_progress.json", "crawl_seen.json", "crawl_urls.json", "rehearsal_cache.json"):
            if (out / f).exists():
                shutil.copy2(out / f, snap / f)
        for f in out.glob("live_*_ledger.json"):
            shutil.copy2(f, snap / f.name)
        return publish_dataset(snap, model_ds, message)

    print("🚀 جمع ← ترميز ← تدريب ← تكرير ← حفظ (كلها معاً)")
    rng = random.Random(step)
    while time.time() - t_start < budget and not (dry_run_steps and step - start_step >= dry_run_steps):
        # gather a pool of fresh examples, fill held-out first
        deadline = time.time() + 30
        while len(pending) < 48 and time.time() < deadline:
            try:
                kind, ex = enc_q.get(timeout=1)
            except queue.Empty:
                continue
            if len(holdout[kind]) < HOLDOUT_PER_KIND:
                holdout[kind].append(ex)
            else:
                pending.append((kind, ex))
        if not pending:
            continue
        pool = [ex for _, ex in pending]
        kinds = [k for k, _ in pending]
        n_rehearse = int(len(pool) * guard.rehearsal / (1 - guard.rehearsal))
        if rehearsal and n_rehearse:
            pick = [rehearsal[rng.randrange(len(rehearsal))] for _ in range(n_rehearse)]
            pool += pick
            kinds += ["chat"] * len(pick)
        pending = []
        for k in kinds:
            trained_kind[k] += 1
        for ids, labels in make_batches(pool, token_budget):
            for g in optimizer.param_groups:
                g["lr"] = lr_at(step - start_step, time.time() - t_train, budget - (t_train - t_start)) * guard.lr_scale
            try:
                _, loss = model(ids.to(device), labels=labels.to(device))
                if not torch.isfinite(loss):
                    optimizer.zero_grad(set_to_none=True)
                    continue
                loss.backward()
            except torch.cuda.OutOfMemoryError:
                optimizer.zero_grad(set_to_none=True)
                torch.cuda.empty_cache()
                token_budget = max(1024, token_budget // 2)
                print(f"⚠ الذاكرة لا تكفي — ميزانية الدفعة أصبحت {token_budget} رمزاً")
                break
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
            ema.update(model)
            step += 1
            losses.append(float(loss.detach()))
        if time.time() - last_log > 120:
            avg = sum(losses[-50:]) / max(len(losses[-50:]), 1)
            print(f"الخطوة {step:,} | خسارة {avg:.3f} | lr {optimizer.param_groups[0]['lr']:.2e} | "
                  f"مُرمَّز {counts['encoded']:,} (فشل {counts['failed']:,}) | طابور {raw_q.qsize()}/{enc_q.qsize()} | "
                  + " ".join(f"{k}:{v:,}" for k, v in trained_kind.items()))
            print(spider.report())
            last_log = time.time()
        if time.time() - last_save > save_every:
            save()
            last_save = time.time()
        if time.time() - last_pub > publish_every_hours * 3600:
            threading.Thread(target=publish, args=(f"live step {step:,}",), daemon=True).start()
            last_pub = time.time()

    stop.set()
    spider.stop()
    detach_link()
    shard.close()
    final = save("final")
    print(link_report())
    selfdev_record("حارس التراجع", f"أفضل نقطة {guard.best_flavor} بمؤشر {guard.best_score:.3f} "
                   f"(1.000 = نقطة البداية)، تراجعات {guard.rollbacks}")
    report = (f"🕸 المدرّب الحي ({'GPU' if cuda else 'CPU'}): {step - start_step:,} خطوة (من {start_step:,} إلى {step:,}) في "
              f"{(time.time() - t_start) / 3600:.1f} ساعة\n" + spider.report() + "\n"
              + "📏 التحقق قبل → بعد (أفضل نقطة، على أمثلة لم يرها): " + ", ".join(
                  f"{k} {guard.base[k]:.3f}→{v:.3f}" if k in guard.base else f"{k} {v:.3f}" for k, v in final.items())
              + f"\n🛡 المؤشر {guard.best_score:.3f} (أقل من 1.000 = أفضل من نقطة البداية) | تراجعات {guard.rollbacks}"
              + ("\n" + selfdev_summary() if selfdev_summary() else ""))
    print(report)
    published = publish(f"live session to step {step:,}")
    corpus = None
    if any((WORK / "crawl_corpus" / "text").glob("*.txt")):
        corpus = publish_dataset(WORK / "crawl_corpus", corpus_ds, f"live corpus to step {step:,}")
    try:
        from kaggle_secrets import UserSecretsClient
        from telegram_report import send_telegram_message
        sec = UserSecretsClient()
        send_telegram_message(sec.get_secret("TELEGRAM_BOT_TOKEN"), sec.get_secret("TELEGRAM_CHAT_ID"), report[:4000])
    except Exception:
        pass
    return {"steps": step - start_step, "published": published, "corpus": corpus, "holdout": final,
            "before": dict(guard.base), "trained": trained_kind, "guard_score": guard.best_score,
            "rollbacks": guard.rollbacks}
