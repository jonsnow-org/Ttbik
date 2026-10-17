"""
What a plain Telegram message asks for. RED LINE (owner, 2026-10-17): no fixed commands or keyword rules for the bot or the model — the MODEL decides
whether to answer in words, a picture, a sound or a video, and whether to search (sham_studio_media.generate_any, sham_studio_chat <SEARCH>).
This file therefore routes nothing by words. The only thing it still recognises is an EXPLICIT slash command typed by the user (/image, /audio,
/video — the user's own order, not a guess), and an explicit «تعلّم:» / «احفظ:» prefix on a media caption (a teaching order, not a guess).

  route_text(text)          -> ("image"|"audio"|"video", subject) for an explicit /command | ("chat", text) for everything else
  media_caption(caption)    -> (question, teach)
Offline self-test: python sham_intent.py
"""
from __future__ import annotations

import re

SLASH = {"image": "image", "audio": "audio", "video": "video"}


def route_text(text: str):
    raw = (text or "").strip()
    m = re.match(r"^/(\w+)(?:@\w+)?\s*(.*)$", raw, re.S)
    if m and m.group(1).lower() in SLASH:
        return (SLASH[m.group(1).lower()], m.group(2).strip() or raw)
    return ("chat", raw)


def media_caption(caption: str | None) -> tuple[str, str | None]:
    c = (caption or "").strip()
    if not c:
        return "", None
    m = re.match(r"^\s*(تعلّ?مي?|احفظ)\s*[:：-]\s*", c)
    if m:
        return "", c[m.end():].strip() or None
    return c, None


if __name__ == "__main__":
    assert route_text("/video بحر") == ("video", "بحر") and route_text("/image@Bot قطة") == ("image", "قطة")
    for t in ("قم بتوليد صورة ارنب", "صورة جبل", "ابحث عن سعر الذهب", "ارسم قطة", "video بحر"):
        assert route_text(t) == ("chat", t), t
    assert media_caption("هذه صورة قطتي") == ("هذه صورة قطتي", None)
    assert media_caption("تعلّم: رجل يقول صباح الخير")[1] == "رجل يقول صباح الخير"
    assert media_caption("") == ("", None)
    print("sham_intent self-test OK")
