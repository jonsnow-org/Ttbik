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
  - FreedomIntelligence/alpaca-gpt4-arabic, 2A2I/Arabic-OpenHermes-2.5 — apache-2.0 (added 2026-10-14);
    every source gives its share each session and starts again when used up (several epochs).
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
DRAW_IMAGE = ["ارسم: {}", "أنشئ صورة: {}", "ارسم لي صورة لـ {}", "صورة: {}",
              # 2026-10-12: how people really ask on Telegram — the model must DECIDE to draw from many phrasings, not from one fixed template
              "اعطني صورة {}", "أعطني صورة {}", "أريد صورة {}", "ولّد صورة {}", "اصنع لي صورة {}", "أرني صورة {}", "صوّر لي {}", "هات صورة {}",
              "ارسم {}", "اريد رسمة {}", "أنشئ لي صورة عن {}", "اعرض صورة {}"]
DESCRIBE_VIDEO = ["صف هذا الفيديو.", "ماذا يحدث في هذا الفيديو؟", "ما الذي يظهر في المقطع؟"]
MAKE_VIDEO = ["أنشئ فيديو: {}", "اصنع مقطع فيديو: {}", "فيديو: {}",
              "اعطني فيديو {}", "أعطني مقطع فيديو {}", "أريد فيديو {}", "ولّد فيديو {}", "اصنع لي فيديو {}", "أرني فيديو {}", "هات فيديو {}", "صوّر فيديو {}"]
ASK_ABOUT = ["ما هو {}؟", "حدثني عن {}.", "ماذا تعرف عن {}؟", "من هو {}؟", "عرّف {}."]
TRANSCRIBE_AUDIO = ["اكتب ما يقال في هذا المقطع.", "ماذا يقول هذا الصوت؟", "حوّل هذا الصوت إلى نص."]
SPEAK_AUDIO = ["انطق: {}", "قل بصوتك: {}", "حوّل إلى صوت: {}",
               "اعطني صوت {}", "أعطني تسجيلاً صوتياً {}", "أريد صوتاً {}", "ولّد صوتاً {}", "اقرأ بصوت عالٍ {}", "تكلّم عن {}", "أسمعني {}", "هات صوت {}"]


# ---- today's date as CONTEXT (owner, 2026-10-12): a model that only remembers answers "the date is 2024". The date is handed to it in the
# prompt like any other input, and these examples teach it to READ it (and convert it: the context line has the ISO date, the answer says the month in words).
WEEKDAYS_AR = ["الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"]      # datetime.date.weekday(): Monday = 0
MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
DATE_QUESTIONS = ["ما تاريخ اليوم؟", "كم التاريخ اليوم؟", "في أي سنة نحن؟", "ما هو اليوم؟", "في أي شهر نحن؟", "ما اليوم وتاريخه؟"]


def date_context_line(d) -> str:
    """The context line put in front of a question: «التاريخ اليوم: 2026-10-12 (الاثنين)»."""
    return f"التاريخ اليوم: {d.isoformat()} ({WEEKDAYS_AR[d.weekday()]})"


def build_date_example(text_ids_fn, rng: random.Random, today=None) -> tuple[list[int], list[int]]:
    """A question about the date whose answer is read from the date line in the context. `today` is a datetime.date; None draws a random day
    from 2024-2028, so the model learns the skill, never a particular date."""
    import datetime
    d = today or datetime.date(2024, 1, 1) + datetime.timedelta(days=rng.randrange(0, 365 * 5))
    q = rng.choice(DATE_QUESTIONS)
    wd, mon = WEEKDAYS_AR[d.weekday()], MONTHS_AR[d.month - 1]
    if "سنة" in q:
        a = f"نحن في سنة {d.year}."
    elif "شهر" in q:
        a = f"نحن في شهر {mon} من سنة {d.year}."
    elif q == "ما هو اليوم؟":
        a = f"اليوم {wd}."
    else:
        a = f"اليوم {wd} {d.day} {mon} {d.year}."
    return build_chat_example(text_ids_fn(date_context_line(d) + "\n" + q), text_ids_fn(a))


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
    date_line: str | None = None,
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
    q = text_ids_fn((date_line + "\n" if date_line else "") + rng.choice(ASK_ABOUT).format(title))
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


def _conversation_pair(row: dict) -> tuple[str, str]:
    """First user turn and the reply after it, from a ShareGPT-style `conversations` list (from: human/gpt or role/content)."""
    if row.get("user") and row.get("gpt") and isinstance(row["user"], str):        # Arabic-OpenHermes: ready columns
        return row["user"].strip(), str(row["gpt"]).strip()
    conv = row.get("conversations") or []
    if isinstance(conv, str):                                                      # a JSON string in some sets
        try:
            conv = json.loads(conv)
        except Exception:
            return "", ""
    for k, t in enumerate(conv[:-1]):
        if not isinstance(t, dict) or not isinstance(conv[k + 1], dict):
            continue
        who = (t.get("from") or t.get("role") or "").lower()
        nxt = conv[k + 1]
        if who in ("human", "user") and (nxt.get("from") or nxt.get("role") or "").lower() in ("gpt", "assistant"):
            return (t.get("value") or t.get("content") or "").strip(), (nxt.get("value") or nxt.get("content") or "").strip()
    return "", ""


# (progress key, loader, question column, answer column, keep-filter, streaming). The first two are the original plan, unchanged; the
# last two were added 2026-10-14 (apache-2.0 on their dataset cards; both are GPT-4-written / translated Arabic conversations):
#   FreedomIntelligence/alpaca-gpt4-arabic — 49,969 Arabic instruction → answer conversations
#   2A2I/Arabic-OpenHermes-2.5           — 981,618 Arabic conversations (streamed: never downloaded whole)
def _chat_plan():
    from datasets import load_dataset
    return [
        ("cidar", lambda: load_dataset("arbml/CIDAR", split="train"), "instruction", "output", None, False),
        ("aya_ar", lambda: load_dataset("CohereLabs/aya_dataset", split="train"), "inputs", "targets", _is_arabic_row, False),
        ("alpaca_gpt4_ar", lambda: load_dataset("FreedomIntelligence/alpaca-gpt4-arabic", split="train"), None, None, None, False),
        ("openhermes_ar", lambda: load_dataset("2A2I/Arabic-OpenHermes-2.5", split="train", streaming=True), None, None, None, True),
    ]


CHAT_SOURCE_SIZES = {"openhermes_ar": 981_618}      # a streamed source has no len(): its wrap-around point


def load_arabic_dialogues(progress: dict, max_examples: int, plan=None) -> tuple[list[tuple[str, str]], dict]:
    """Next `max_examples` NEW (question, answer) pairs, continuing where `progress` (saved next to the checkpoint) stopped.

    2026-10-14: every source gives its SHARE each session (before, the plan was strictly sequential, so with 4,000 per session the
    second source waited until CIDAR was used up), and a source that is used up starts again from its beginning by itself
    (progress["<key>_epoch"] counts the passes) — several epochs over the chat data, and a session never comes back empty.
    SHAM_CHAT_SOURCES=cidar,aya_ar limits the plan. Returns (pairs, updated progress)."""
    import os
    progress = dict(progress or {})
    plan = plan if plan is not None else _chat_plan()
    only = {k.strip() for k in os.environ.get("SHAM_CHAT_SOURCES", "").split(",") if k.strip()}
    if only:
        plan = [p for p in plan if p[0] in only]
    pairs: list[tuple[str, str]] = []
    seen: set[str] = set()
    share = max(1, max_examples // max(1, len(plan)))
    for n, (key, loader, q_col, a_col, keep, streaming) in enumerate(plan):
        want = min(share if n < len(plan) - 1 else max_examples - len(pairs), max_examples - len(pairs))
        if want <= 0:
            break
        try:
            ds = loader()
            if keep is not None:
                ds = ds.filter(keep)
        except Exception as exc:  # one source down must not stop the run
            print(f"⚠ تعذّر تحميل {key}: {exc}")
            continue
        size = CHAT_SOURCE_SIZES.get(key) if streaming else len(ds)
        start = int(progress.get(key, 0))
        if size and start >= size:                      # used up: the next pass over this source
            start = 0
            progress[f"{key}_epoch"] = int(progress.get(f"{key}_epoch", 0)) + 1
        end = min(size, start + want) if size else start + want
        rows = ds.skip(start).take(end - start) if streaming else ds.select(range(start, end))
        got = 0
        for row in rows:
            q, a = ((row.get(q_col) or "").strip(), (row.get(a_col) or "").strip()) if q_col else _conversation_pair(row)
            norm_q = " ".join(q.split())
            if q and a and norm_q not in seen:            # the same question from two sources is kept once
                seen.add(norm_q)
                pairs.append((q, a))
                got += 1
        progress[key] = end
        print(f"{key}: الأمثلة {start:,}..{end:,} من {size or '?'} (الدورة {progress.get(f'{key}_epoch', 0)}) — {got:,} زوج")
    return pairs, progress

# ---------------------------------------------------------------- multi-turn dialogues (memory, 2026-10-14)
# build_chat_example trains ONE turn, so the model never saw a conversation that refers back to something said earlier. The functions below are
# additive: the single-turn path is untouched; sham_live and the chat-stage notebook add them unless SHAM_CHAT_MULTITURN=0, and what they train still passes the same
# held-out gate (the yardstick examples stay single-turn, exactly as before).

def multiturn_enabled() -> bool:
    """ON by default since 2026-10-14 (owner: multi-turn training must actually run); SHAM_CHAT_MULTITURN=0 switches it off."""
    import os
    return os.environ.get("SHAM_CHAT_MULTITURN", "1").strip().lower() not in ("0", "off", "false", "no", "")


def _conversation_turns(row: dict, max_turns: int = 8) -> list[tuple[str, str]]:
    """EVERY (user, assistant) pair of a ShareGPT-style conversation, in order (the single-turn loader keeps only the first)."""
    if row.get("user") and row.get("gpt") and isinstance(row["user"], str):
        return [(row["user"].strip(), str(row["gpt"]).strip())]
    conv = row.get("conversations") or []
    if isinstance(conv, str):
        try:
            conv = json.loads(conv)
        except Exception:
            return []
    turns: list[tuple[str, str]] = []
    k = 0
    while k < len(conv) - 1 and len(turns) < max_turns:
        t, nxt = conv[k], conv[k + 1]
        if isinstance(t, dict) and isinstance(nxt, dict):
            who = (t.get("from") or t.get("role") or "").lower()
            if who in ("human", "user") and (nxt.get("from") or nxt.get("role") or "").lower() in ("gpt", "assistant"):
                q = (t.get("value") or t.get("content") or "").strip()
                a = (nxt.get("value") or nxt.get("content") or "").strip()
                if q and a:
                    turns.append((q, a))
                k += 2
                continue
        k += 1
    return turns


def build_multiturn_example(turns: list[tuple[list[int], list[int]]], max_len: int = 1024, max_user: int = 192,
                            max_answer: int = 256) -> tuple[list[int], list[int]]:
    """<BOS> [<USER> q <SHAM> a <EOS>]* — the layout sham_decoding.chat_prompt_ids(history=...) builds at answer time. Labels: every SHAM answer
    and its <EOS>; user turns and markers are IGNORE. Too long: the OLDEST turns are dropped (the last turn is always kept), the way the live
    memory window drops them. One turn gives exactly build_chat_example's ids and labels (when it fits)."""
    pieces = []
    for q, a in turns:
        q, a = q[:max_user], a[:max_answer]
        pieces.append(([USER_TURN] + q + [SHAM_TURN], a + [SpecialTokens.EOS]))
    while len(pieces) > 1 and 1 + sum(len(u) + len(a) for u, a in pieces) > max_len:
        pieces.pop(0)
    ids, labels = [SpecialTokens.BOS], [IGNORE]
    for u, a in pieces:
        room = max_len - len(ids) - len(u)
        if room <= 1:
            break
        a = a if len(a) <= room else a[:room - 1] + [SpecialTokens.EOS]
        ids += u + a
        labels += [IGNORE] * len(u) + a
    return ids, labels


def load_arabic_conversations(progress: dict, max_examples: int, plan=None, min_turns: int = 2, max_turns: int = 8):
    """Like load_arabic_dialogues, but whole conversations (lists of (q, a)) with at least `min_turns` turns, from the sources that HAVE
    conversations (column sources are single-turn and skipped). Its own progress keys ("<key>_mt"), so the single-turn positions never move."""
    import os
    progress = dict(progress or {})
    plan = plan if plan is not None else _chat_plan()
    only = {k.strip() for k in os.environ.get("SHAM_CHAT_SOURCES", "").split(",") if k.strip()}
    plan = [p for p in plan if p[2] is None and (not only or p[0] in only)]
    convs: list[list[tuple[str, str]]] = []
    share = max(1, max_examples // max(1, len(plan)))
    for key, loader, _q, _a, keep, streaming in plan:
        try:
            ds = loader()
            if keep is not None:
                ds = ds.filter(keep)
        except Exception as exc:
            print(f"⚠ تعذّر تحميل {key}: {exc}")
            continue
        size = CHAT_SOURCE_SIZES.get(key) if streaming else len(ds)
        pk = f"{key}_mt"
        start = int(progress.get(pk, 0))
        if size and start >= size:
            start = 0
        scan = share * 20                                    # most rows are single-turn: read further to find enough conversations
        end = min(size, start + scan) if size else start + scan
        rows = ds.skip(start).take(end - start) if streaming else ds.select(range(start, end))
        got, pos = 0, start
        for row in rows:
            pos += 1
            t = _conversation_turns(row, max_turns)
            if len(t) >= min_turns:
                convs.append(t)
                got += 1
                if got >= share:
                    break
        progress[pk] = pos
        print(f"{key}: محادثات متعددة الأدوار {got:,} (حتى الصف {pos:,})")
    return convs, progress


def conversation_examples(convs: list[list[tuple[str, str]]], encode, max_len: int = 1024) -> list[tuple[list[int], list[int]]]:
    return [build_multiturn_example([(encode(q), encode(a)) for q, a in c], max_len=max_len) for c in convs if c]


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
    class _DS(list):
        def filter(self, f):
            return _DS(r for r in self if f(r))

        def select(self, r):
            return [self[i] for i in r]

    _plan = [("a", lambda: _DS({"q": f"س{i}", "a": f"ج{i}"} for i in range(5)), "q", "a", None, False),
             ("b", lambda: _DS({"conversations": [{"from": "human", "value": f"سؤال{i}"}, {"from": "gpt", "value": f"جواب{i}"}]}
                               for i in range(3)), None, None, None, False)]
    _p, _prog = load_arabic_dialogues({}, 4, plan=_plan)
    assert len(_p) == 4 and _prog == {"a": 2, "b": 2} and ("سؤال0", "جواب0") in _p, (_p, _prog)       # both sources give a share
    _p, _prog = load_arabic_dialogues(_prog, 4, plan=_plan)
    assert _prog["b"] == 3 and _prog["a"] == 4
    _p, _prog = load_arabic_dialogues(_prog, 4, plan=_plan)
    assert _prog.get("b_epoch") == 1 and _p, _prog                                                      # used up → next pass
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
    # the date is context: the line goes in front of the question and the answer is read from it (the model learns the skill, not a date)
    import datetime
    seen: list[str] = []
    cap = lambda t: (seen.append(t), fake(t))[1]
    build_date_example(cap, random.Random(1), today=datetime.date(2026, 10, 12))
    assert seen[0].startswith("التاريخ اليوم: 2026-10-12 (الاثنين)\n") and any(q in seen[0] for q in DATE_QUESTIONS), seen
    assert "2026" in seen[1] or "الاثنين" in seen[1], seen
    days = {build_date_example(lambda t: [len(t)], random.Random(k))[0][-2] for k in range(30)}
    assert len(days) > 3                                              # random days: not one memorised date
    dated = build_search_example(cap, "دمشق", "دمشق عاصمة سوريا وأقدم مدينة مأهولة في العالم. " * 3, rng, date_line=date_context_line(datetime.date(2026, 1, 5)))
    assert seen[-4].startswith("التاريخ اليوم: 2026-01-05") and dated[0].count(SpecialTokens.SEARCH_START) == 1
    tr, ho = split_holdout(list(range(100)))
    assert len(ho) == 5 and not set(tr) & set(ho)
    # multi-turn: every turn, labels only on Sham's answers, oldest turns dropped first, one turn == build_chat_example
    row = {"conversations": [{"from": "system", "value": "x"}, {"from": "human", "value": "اسمي سامر"}, {"from": "gpt", "value": "أهلاً سامر"},
                             {"from": "human", "value": "ما اسمي؟"}, {"from": "gpt", "value": "اسمك سامر"}]}
    assert _conversation_turns(row) == [("اسمي سامر", "أهلاً سامر"), ("ما اسمي؟", "اسمك سامر")]
    assert _conversation_pair(row) == ("اسمي سامر", "أهلاً سامر")                       # the single-turn loader is unchanged
    one = build_multiturn_example([(fake("سؤال"), fake("جواب"))])
    assert one == build_chat_example(fake("سؤال"), fake("جواب")), "one turn must equal the single-turn layout"
    mt_ids, mt_lab = build_multiturn_example([(fake("اسمي سامر"), fake("أهلاً سامر")), (fake("ما اسمي؟"), fake("اسمك سامر"))])
    assert mt_ids.count(USER_TURN) == 2 and mt_ids.count(SHAM_TURN) == 2 and mt_ids.count(SpecialTokens.EOS) == 2
    scored = [i for i, l in zip(mt_ids, mt_lab) if l != IGNORE]
    assert scored == fake("أهلاً سامر") + [SpecialTokens.EOS] + fake("اسمك سامر") + [SpecialTokens.EOS], scored
    for i, (tok, lab) in enumerate(zip(mt_ids, mt_lab)):
        if tok in (USER_TURN, SHAM_TURN, SpecialTokens.BOS):
            assert lab == IGNORE
    long_ids, long_lab = build_multiturn_example([(fake("ق" * 50), fake("ج" * 50))] * 10 + [(fake("آخر"), fake("رد"))], max_len=120)
    assert len(long_ids) <= 120 and long_ids[-len(fake("رد")) - 1:-1] == fake("رد") and long_ids.count(USER_TURN) < 11
    _mplan = [("q", lambda: _DS({"q": "س", "a": "ج"} for _ in range(3)), "q", "a", None, False),
              ("c", lambda: _DS({"conversations": row["conversations"] if i % 2 else row["conversations"][:3]} for i in range(10)), None, None, None, False)]
    _c, _cp = load_arabic_conversations({}, 2, plan=_mplan)
    assert len(_c) == 2 and all(len(x) == 2 for x in _c) and "c_mt" in _cp and "q_mt" not in _cp, (_c, _cp)
    assert len(conversation_examples(_c, fake)) == 2
    print("sham_chat self-test OK")
