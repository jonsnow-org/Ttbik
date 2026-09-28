"""
Sham's chat stage: turning a model that only ever CONTINUED text (stage 1)
and paired captions with images/sounds (stage 2) into one that ANSWERS —
in text, with an image, or with sound, from the same brain.

Three ideas, all trained into the one ShamSmall model:

1. Sham's own dialogue format (sham_decoding.USER_TURN / SHAM_TURN):
       <BOS> <USER> question <SHAM> answer <EOS>
   Loss only on the answer (+ its <EOS>, so the model learns to STOP —
   the missing stop is half of the "سامي سامي سامي" loop).

2. Media inside the conversation ("وسائط داخل المحادثة"): the same caption
   pairs stage 2 used become dialogue turns in both directions —
       <USER> صف هذه الصورة <IMAGE_START>..<IMAGE_END> <SHAM> caption <EOS>
       <USER> ارسم: caption <SHAM> <IMAGE_START>..<IMAGE_END> <EOS>
   (and the same for audio: transcribe / speak). So the model learns that a
   reply MAY BE an image or a sound — the first step to a Sham that decides
   by itself when to draw or speak, instead of a bot command choosing.

3. Rehearsal ("التذكّر"): every chat batch list is mixed with plain Arabic
   Wikipedia text (already-seen stream positions) and media pairs, so new
   skills don't erase old ones — the forgetting that stage 2 showed.

Data (licensed, human-written, verified before use):
  - arbml/CIDAR — apache-2.0, 10k culturally-relevant Arabic instructions.
  - CohereLabs/aya_dataset — apache-2.0, human-written; only rows whose
    `language` contains "Arabic". Its TEST split's Arabic rows are never
    trained on — sham_eval.py uses them as the fixed yardstick.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

import torch

from model import SpecialTokens
from sham_decoding import SHAM_TURN, USER_TURN

IGNORE = -100

DESCRIBE_IMAGE = ["صف هذه الصورة.", "ماذا ترى في الصورة؟", "اكتب وصفاً لهذه الصورة.", "ما الذي تظهره هذه الصورة؟"]
DRAW_IMAGE = ["ارسم: {}", "أنشئ صورة: {}", "ارسم لي صورة لـ {}", "صورة: {}"]
DESCRIBE_VIDEO = ["صف هذا الفيديو.", "ماذا يحدث في هذا الفيديو؟", "ما الذي يظهر في المقطع؟"]
MAKE_VIDEO = ["أنشئ فيديو: {}", "اصنع مقطع فيديو: {}", "فيديو: {}"]
ASK_ABOUT = ["ما هو {}؟", "حدثني عن {}.", "ماذا تعرف عن {}؟", "من هو {}؟", "عرّف {}."]
TRANSCRIBE_AUDIO = ["اكتب ما يقال في هذا المقطع.", "ماذا يقول هذا الصوت؟", "حوّل هذا الصوت إلى نص."]
SPEAK_AUDIO = ["انطق: {}", "قل بصوتك: {}", "حوّل إلى صوت: {}"]


def build_chat_example(
    user_ids: list[int], answer_ids: list[int], max_len: int = 512, max_user: int = 192,
) -> tuple[list[int], list[int]]:
    """One turn: ids and labels (IGNORE everywhere except the answer and its
    <EOS>). model.forward shifts internally, so labels line up with ids."""
    user_ids = user_ids[:max_user]
    room = max_len - len(user_ids) - 4
    answer_ids = answer_ids[:max(room, 0)]
    prefix = [SpecialTokens.BOS, USER_TURN] + user_ids + [SHAM_TURN]
    ids = prefix + answer_ids + [SpecialTokens.EOS]
    labels = [IGNORE] * len(prefix) + answer_ids + [SpecialTokens.EOS]
    return ids, labels


def build_media_chat_examples(
    text_ids_fn, caption: str, media_ids: list[int], kind: str, rng: random.Random,
) -> list[tuple[list[int], list[int]]]:
    """Both directions of one (caption, media) pair as dialogue turns.
    media_ids: offset vocab ids WITHOUT delimiters. kind: "image"|"audio"."""
    start, end = (SpecialTokens.IMAGE_START, SpecialTokens.IMAGE_END) if kind == "image" else (
        SpecialTokens.AUDIO_START, SpecialTokens.AUDIO_END)
    understand, create = (DESCRIBE_IMAGE, DRAW_IMAGE) if kind == "image" else (TRANSCRIBE_AUDIO, SPEAK_AUDIO)
    span = [start] + media_ids + [end]
    cap = text_ids_fn(caption)
    ask = text_ids_fn(rng.choice(understand))
    # understanding: the media is part of the question, the caption is the answer
    u_prefix = [SpecialTokens.BOS, USER_TURN] + span + ask + [SHAM_TURN]
    understand_ex = (u_prefix + cap + [SpecialTokens.EOS], [IGNORE] * len(u_prefix) + cap + [SpecialTokens.EOS])
    # creation: the caption is the question, the media span is the answer
    c_prefix = [SpecialTokens.BOS, USER_TURN] + text_ids_fn(rng.choice(create).format(caption)) + [SHAM_TURN]
    create_ex = (c_prefix + span + [SpecialTokens.EOS], [IGNORE] * len(c_prefix) + span + [SpecialTokens.EOS])
    return [understand_ex, create_ex]


def build_video_chat_examples(
    text_ids_fn, caption: str, frame_ids: list[list[int]], audio_ids: list[int] | None, rng: random.Random,
) -> list[tuple[list[int], list[int]]]:
    """Video inside the conversation, both directions. frame_ids: offset image
    ids per keyframe; audio_ids: one offset audio segment (the clip's sound)
    or None. Same span layout as video_tokenizer.encode_video_with_audio."""
    span = [SpecialTokens.VIDEO_START]
    for f in frame_ids:
        span += [SpecialTokens.IMAGE_START] + f + [SpecialTokens.IMAGE_END]
    if audio_ids:
        span += [SpecialTokens.AUDIO_START] + audio_ids + [SpecialTokens.AUDIO_END]
    span += [SpecialTokens.VIDEO_END]
    cap = text_ids_fn(caption)
    u_prefix = [SpecialTokens.BOS, USER_TURN] + span + text_ids_fn(rng.choice(DESCRIBE_VIDEO)) + [SHAM_TURN]
    c_prefix = [SpecialTokens.BOS, USER_TURN] + text_ids_fn(rng.choice(MAKE_VIDEO).format(caption)) + [SHAM_TURN]
    return [
        (u_prefix + cap + [SpecialTokens.EOS], [IGNORE] * len(u_prefix) + cap + [SpecialTokens.EOS]),
        (c_prefix + span + [SpecialTokens.EOS], [IGNORE] * len(c_prefix) + span + [SpecialTokens.EOS]),
    ]


def build_search_example(
    text_ids_fn, title: str, article: str, rng: random.Random, max_result_tokens: int = 160, max_answer_tokens: int = 96,
) -> tuple[list[int], list[int]] | None:
    """Learned search, self-supervised from Wikipedia (no labels needed):
        <USER> ما هو {title}؟ <SHAM> <SEARCH_START> title <SEARCH_END>
        <RESULT_START> article opening <RESULT_END> answer <EOS>
    The query and the answer are learned; the result text is NOT (it comes
    from the tool at inference), so its labels are ignored."""
    paragraphs = [p.strip() for p in article.split("\n") if len(p.strip()) > 80]
    if not title or not paragraphs:
        return None
    first = paragraphs[0]
    answer = first.split(". ")[0].strip()
    answer = answer if answer.endswith(".") else answer + "."
    q = text_ids_fn(rng.choice(ASK_ABOUT).format(title))
    query = text_ids_fn(title)
    result = text_ids_fn(" ".join(paragraphs[:2]))[:max_result_tokens]
    ans = text_ids_fn(answer)[:max_answer_tokens]
    prefix = [SpecialTokens.BOS, USER_TURN] + q + [SHAM_TURN]
    call = [SpecialTokens.SEARCH_START] + query + [SpecialTokens.SEARCH_END]
    back = [SpecialTokens.RESULT_START] + result + [SpecialTokens.RESULT_END]
    ids = prefix + call + back + ans + [SpecialTokens.EOS]
    labels = [IGNORE] * len(prefix) + call + [IGNORE] * len(back) + ans + [SpecialTokens.EOS]
    return ids, labels


def load_wiki_articles(n: int, skip: int) -> list[tuple[str, str]]:
    """(title, text) pairs from Arabic Wikipedia, continuing at `skip`."""
    from datasets import load_dataset

    ds = load_dataset("wikimedia/wikipedia", "20231101.ar", split="train", streaming=True).skip(skip)
    out = []
    for row in ds:
        out.append((row.get("title", ""), row.get("text", "")))
        if len(out) >= n:
            break
    return out


def split_holdout(items: list, fraction: float = 0.05, seed: int = 0) -> tuple[list, list]:
    """(train, holdout) — the holdout is never trained on; it guards merges
    and self-reward rounds so they are judged on unseen examples."""
    items = list(items)
    random.Random(seed).shuffle(items)
    k = max(1, int(len(items) * fraction)) if items else 0
    return items[k:], items[:k]


def pad_batch(examples: list[tuple[list[int], list[int]]]) -> tuple[torch.Tensor, torch.Tensor]:
    n = max(len(i) for i, _ in examples)
    ids = torch.full((len(examples), n), SpecialTokens.PAD, dtype=torch.long)
    labels = torch.full((len(examples), n), IGNORE, dtype=torch.long)
    for r, (i, l) in enumerate(examples):
        ids[r, :len(i)] = torch.tensor(i)
        labels[r, :len(l)] = torch.tensor(l)
    return ids, labels


def batch_examples(examples: list, batch_size: int, seed: int = 0) -> list[tuple[torch.Tensor, torch.Tensor]]:
    """Length-bucketed batches (similar lengths together → little padding
    waste on CPU), then shuffled so buckets are interleaved."""
    order = sorted(range(len(examples)), key=lambda k: len(examples[k][0]))
    batches = [pad_batch([examples[k] for k in order[s:s + batch_size]])
               for s in range(0, len(order), batch_size)]  # the last, shorter batch too
    random.Random(seed).shuffle(batches)
    return batches


# ---------------------------------------------------------------- data

def _is_arabic_row(row: dict) -> bool:
    return "Arabic" in (row.get("language") or "")


def load_arabic_dialogues(progress: dict, max_examples: int) -> tuple[list[tuple[str, str]], dict]:
    """Next `max_examples` NEW (question, answer) pairs, continuing where
    `progress` (saved next to the checkpoint) stopped: CIDAR first, then
    Aya's Arabic training rows. Returns (pairs, updated progress)."""
    from datasets import load_dataset

    progress = dict(progress or {})
    pairs: list[tuple[str, str]] = []
    plan = [
        ("cidar", lambda: load_dataset("arbml/CIDAR", split="train"), "instruction", "output", None),
        ("aya_ar", lambda: load_dataset("CohereLabs/aya_dataset", split="train"), "inputs", "targets", _is_arabic_row),
    ]
    for key, loader, q_col, a_col, keep in plan:
        if len(pairs) >= max_examples:
            break
        start = int(progress.get(key, 0))
        try:
            ds = loader()
        except Exception as exc:  # one source down must not stop the run
            print(f"⚠ تعذّر تحميل {key}: {exc}")
            continue
        if keep is not None:
            ds = ds.filter(keep)
        end = min(len(ds), start + (max_examples - len(pairs)))
        for row in ds.select(range(start, end)):
            q, a = (row.get(q_col) or "").strip(), (row.get(a_col) or "").strip()
            if q and a:
                pairs.append((q, a))
        progress[key] = end
        print(f"{key}: الأمثلة {start:,}..{end:,} من {len(ds):,}")
    return pairs, progress


def load_progress(search_paths: list[Path]) -> dict:
    """Furthest position per source over every chat_progress.json found."""
    best: dict = {}
    for root in search_paths:
        for p in Path(root).rglob("chat_progress.json") if Path(root).exists() else []:
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            for k, v in d.items():
                if isinstance(v, dict):  # e.g. {"merged": {dataset: step}}
                    sub = best.setdefault(k, {})
                    for kk, vv in v.items():
                        sub[kk] = max(int(sub.get(kk, -1)), int(vv))
                else:
                    best[k] = max(int(best.get(k, 0)), int(v))
    return best


def text_replay_batches(
    tokenizer, seq_len: int, batch_size: int, n_batches: int, workdir: str | Path,
    max_position: int = 200_000, seed: int | None = None, extra_files: list[str] | None = None,
) -> list[torch.Tensor]:
    """Rehearsal batches of plain Arabic Wikipedia from a RANDOM already-seen
    region of the stream (stage 1 has read ≥ max_position articles), so each
    run rehearses a different slice instead of the same first pages."""
    from data_acquisition import stream_hf_text_corpus
    from dataset import TextSequenceDataset

    if n_batches <= 0:
        return []
    rng = random.Random(seed)
    need_tokens = n_batches * batch_size * seq_len
    docs = max(200, need_tokens // 250)  # ~250 tokens per article on average, measured loosely
    skip = rng.randrange(0, max(1, max_position - docs))
    files = stream_hf_text_corpus("wikimedia/wikipedia", "20231101.ar", "text", str(workdir),
                                  max_documents=docs, skip=skip)
    # extra_files: e.g. Track B's filtered web corpus (sham_merge.research_corpus_files) —
    # the data-level half of the knowledge merge.
    ds = TextSequenceDataset(files + list(extra_files or []), tokenizer, seq_len)
    chunks = [ds[i] for i in range(len(ds))]
    rng.shuffle(chunks)
    batches = [torch.stack(chunks[s:s + batch_size]) for s in range(0, len(chunks) - batch_size + 1, batch_size)]
    print(f"تذكّر النص: {len(batches):,} دفعة من ويكيبيديا (بدءاً من المقال {skip:,})")
    return batches[:n_batches]


def interleave(groups: list[list], weights: list[float], seed: int = 0) -> list:
    """Mix several batch lists so each appears spread over the whole run
    (not all chat first, then all text) — proportional round-robin."""
    rng = random.Random(seed)
    pools = [list(g) for g in groups]
    for p in pools:
        rng.shuffle(p)
    out = []
    credit = [0.0] * len(pools)
    while any(pools):
        for k, p in enumerate(pools):
            if not p:
                continue
            credit[k] += weights[k]
            while credit[k] >= 1 and p:
                out.append(p.pop())
                credit[k] -= 1
    return out


if __name__ == "__main__":
    # Offline self-test (no network): format, labels, media turns, batching.
    rng = random.Random(0)
    fake = lambda s: [ord(c) % 1000 for c in s]
    ids, labels = build_chat_example(fake("سؤال"), fake("جواب"))
    assert ids[0] == SpecialTokens.BOS and ids[1] == USER_TURN and SHAM_TURN in ids
    assert labels[:ids.index(SHAM_TURN) + 1] == [IGNORE] * (ids.index(SHAM_TURN) + 1)
    assert labels[-1] == SpecialTokens.EOS
    u, c = build_media_chat_examples(fake, "قطة", [32000 + 5] * 16, "image", rng)
    assert SpecialTokens.IMAGE_START in u[0][:u[0].index(SHAM_TURN)]
    assert c[1][-2] == SpecialTokens.IMAGE_END and c[1][c[0].index(SHAM_TURN) + 1] == SpecialTokens.IMAGE_START
    bs = batch_examples([(ids, labels)] * 8 + [u, c] * 4, 4)
    assert len(bs) == 4 and all(b[0].shape == b[1].shape for b in bs)
    mixed = interleave([[1] * 6, [2] * 3], [1.0, 0.5])
    assert sorted(mixed) == [1] * 6 + [2] * 3 and 2 in mixed[:3]
    v = build_video_chat_examples(fake, "رجل يركض", [[32000 + 1] * 4, [32000 + 2] * 4], [40192 + 3] * 5, rng)
    assert v[1][0].count(SpecialTokens.IMAGE_START) == 2 and SpecialTokens.AUDIO_START in v[1][0]
    t_ids, t_lab = build_search_example(fake, "دمشق", "دمشق عاصمة سوريا وأقدم مدينة مأهولة في العالم. " * 3, rng)
    s0, r0 = t_ids.index(SpecialTokens.SEARCH_START), t_ids.index(SpecialTokens.RESULT_START)
    assert t_lab[s0] == SpecialTokens.SEARCH_START and t_lab[r0 + 1] == IGNORE and t_lab[-1] == SpecialTokens.EOS
    tr, ho = split_holdout(list(range(100)))
    assert len(ho) == 5 and not set(tr) & set(ho)
    print("sham_chat self-test OK")
