"""
What a plain Telegram message asks for. RED LINE (owner, 2026-10-17): no commands, prefixes or keyword rules anywhere — the MODEL reads the message and decides
whether to answer in words, a picture, a sound or a video, and whether to search (sham_studio_media.generate_any, sham_studio_chat <SEARCH>).
So this file routes nothing: every message is chat, and a caption sent with a photo / voice / video is just the user's words for the model.

  route_text(text)          -> ("chat", text)
  media_caption(caption)    -> (caption, None)    # no «تعلّم:» prefix either: whatever the user wrote goes to the model as it is
Offline self-test: python sham_intent.py
"""
from __future__ import annotations


def route_text(text: str):
    return ("chat", (text or "").strip())


def media_caption(caption: str | None) -> tuple[str, str | None]:
    return (caption or "").strip(), None


if __name__ == "__main__":
    for t in ("/image قطة", "قم بتوليد صورة ارنب", "صورة جبل", "ابحث عن سعر الذهب", "video بحر"):
        assert route_text(t) == ("chat", t), t
    assert media_caption("تعلّم: رجل يقول صباح الخير") == ("تعلّم: رجل يقول صباح الخير", None)
    assert media_caption(None) == ("", None)
    print("sham_intent self-test OK")
