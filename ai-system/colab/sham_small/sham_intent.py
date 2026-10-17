"""
What a plain Telegram message asks for — no slash commands needed (owner, 2026-10-14: «قم بتوليد صورة ارنب», «ابحث عن سعر الذهب اليوم وآخر
اخبار اليوم», or a photo / voice note / video sent directly).

Extends, does not replace, what already exists: the site bot's first-word media words (novaBotLogic SHAM_MEDIA_COMMANDS: صورة / ارسم / صوت /
فيديو / image / audio / video) and the model's own decisions (sham_studio_media.generate_any picks text or media; sham_studio_chat lets the model
write its own <SEARCH>). This file only catches the clear cases a weak model still misses; everything else stays plain chat for the model.

  route_text(text)          -> ("image"|"audio"|"video", subject) | ("web", query) | ("chat", text)
  media_caption(caption)    -> (question, teach): a caption that DESCRIBES the media («هذه صورة قطتي», «تعلّم: …») is a teach description,
                               anything else is a question about it.
Offline self-test: python sham_intent.py
"""
from __future__ import annotations

import os
import re

_AR_NORM = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي", "ـ": ""})
_DIAC = re.compile(r"[\u064B-\u0652\u0670]")

# the site bot's first words, kept as they are
FIRST_WORD = {"image": "image", "صوره": "image", "ارسم": "image", "audio": "audio", "صوت": "audio", "video": "video", "فيديو": "video"}
_KIND_WORDS = {
    "image": ("صوره", "صور", "رسمه", "رسم", "لوحه", "image", "picture", "photo"),
    "audio": ("صوت", "مقطع صوتي", "تسجيل صوتي", "اغنيه", "نطق", "audio", "voice"),
    "video": ("فيديو", "مقطع فيديو", "فلم", "فيلم", "video", "clip"),
}
_MAKE = ("توليد", "ولد", "انشئ", "انشاء", "اصنع", "صنع", "اعطني", "اعطيني", "عطني", "اريد", "بدي", "ابي", "هات", "ارني", "اعمل", "سوي",
         "ارسم", "ارسمي", "صمم", "انطق", "قل بصوت", "حول الي صوت", "حول الى صوت", "generate", "make", "create", "draw")
_SEARCH = ("ابحث", "بحث", "دور علي", "فتش", "search", "google")
_FRESH = ("سعر", "اسعار", "اخبار", "خبر", "اخر", "اليوم", "الان", "حاليا", "هذا الاسبوع", "طقس", "الطقس", "درجه الحراره", "نتيجه مباراه",
          "نتائج", "بورصه", "سهم", "عمله", "صرف", "الدولار", "الذهب", "بيتكوين", "news", "price", "today", "latest", "weather")
_TEACH = ("تعلم", "احفظ", "هذه", "هذا", "هاي", "هي صوره", "هو صوت", "وصفها", "الوصف")


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", _DIAC.sub("", (text or "").translate(_AR_NORM))).strip().lower()


def _has(t: str, words) -> bool:
    return any(re.search(rf"(^|\s|[وفب]){re.escape(w)}", t) for w in words)


def _subject(text: str, kind: str) -> str:
    t = norm(text)
    for w in sorted(_MAKE + _KIND_WORDS[kind] + ("قم ب", "قم", "لي", "من فضلك", "لو سمحت", "عن", "ل"), key=len, reverse=True):
        t = re.sub(rf"(^|\s)[وفبل]?{re.escape(w)}(?=\s|$)", " ", t)
    t = re.sub(r"^\s*(ب|ل)\s*", "", t).strip(" :،,.")
    return re.sub(r"\s+", " ", t) or text.strip()


def route_text(text: str):
    raw = (text or "").strip()
    if not raw:
        return ("chat", raw)
    t = norm(raw.lstrip("/"))
    first = t.split(" ")[0] if t else ""
    if first in FIRST_WORD:                                     # the site bot's existing first-word words
        kind = FIRST_WORD[first]
        return (kind, raw.split(None, 1)[1].strip() if len(raw.split(None, 1)) > 1 else raw)
    if os.environ.get("SHAM_KEYWORD_ROUTER") != "1":           # 2026-10-17 (supervisor): the keyword guesses below are rules OUTSIDE the model (owner's red line);
        return ("chat", raw)                                    # off by default, the model decides (generate_any: words/media, its own <SEARCH>). =1 restores them.
    if _has(t, _SEARCH):
        return ("web", raw)
    for kind in ("video", "audio", "image"):                    # video before image: «مقطع فيديو» is not a picture
        if _has(t, _KIND_WORDS[kind]) and _has(t, _MAKE):
            return (kind, _subject(raw, kind))
    if _has(t, _FRESH):
        return ("web", raw)
    return ("chat", raw)


def media_caption(caption: str | None) -> tuple[str, str | None]:
    c = (caption or "").strip()
    if not c:
        return "", None
    t = norm(c)
    m = re.match(r"^\s*(تعلّ?مي?|احفظ|الوصف|وصفها)\s*[:：-]?\s*", c)
    if m:
        return "", c[m.end():].strip() or None
    if "?" in c or "؟" in c:
        return c, None
    if _has(t.split(" ")[0] if t else "", _TEACH):
        return "", c
    return c, None


if __name__ == "__main__":
    assert route_text("قم بتوليد صورة ارنب") == ("chat", "قم بتوليد صورة ارنب") and route_text("صورة جبل") == ("image", "جبل")
    os.environ["SHAM_KEYWORD_ROUTER"] = "1"
    cases = {
        "قم بتوليد صورة ارنب": ("image", "ارنب"),
        "ارسم قطة على الشاطئ": ("image", "قطة على الشاطئ"),
        "صورة جبل": ("image", "جبل"),
        "اعطني فيديو لسيارة حمراء": ("video", None),
        "أريد مقطع صوتي يقول مرحبا": ("audio", None),
        "ابحث عن سعر الذهب اليوم وآخر اخبار اليوم": ("web", None),
        "كم سعر الدولار الآن؟": ("web", None),
        "ما هي أخبار اليوم": ("web", None),
        "مرحبا كيف حالك": ("chat", None),
        "ما هي عاصمة فرنسا؟": ("chat", None),
        "/video بحر": ("video", "بحر"),
    }
    for text, (kind, subj) in cases.items():
        k, s = route_text(text)
        assert k == kind, (text, k, s)
        if subj is not None:
            assert s == subj, (text, s)
    assert media_caption("ما هذا؟") == ("ما هذا؟", None)
    assert media_caption("هذه صورة قطتي البيضاء") == ("", "هذه صورة قطتي البيضاء")
    assert media_caption("تعلّم: رجل يقول صباح الخير")[1] == "رجل يقول صباح الخير"
    assert media_caption("") == ("", None)
    assert media_caption("صف الصورة") == ("صف الصورة", None)
    print("sham_intent self-test OK")
