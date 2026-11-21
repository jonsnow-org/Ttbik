#!/usr/bin/env python3
"""Fail-closed validation for an existing Remotion episode before any public upload."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ARABIC_EARNINGS = re.compile(
    r"(?:اربح|اكسب)\s+(?:المال|أموال|اموال|دخل|مبلغ)"
    r"|(?:اربح|اكسب)\s+(?:من|عن طريق|بسبب)\s+(?:مشاهدة|المشاهدة|الإعلانات|الاعلانات|النقرات|الضغطات)"
    r"|(?:توزيع|يوزّع|يوزع|توزّع|توزع)\s+(?:الأرباح|الارباح|أرباح|ارباح|ربح)"
    r"|(?:أرباح|ارباح|عوائد?|دخل)\s*(?:مضمونة|مضمون|ثابتة|ثابت|يومية|يومي|أسبوعية|اسبوعية|أسبوعي|اسبوعي|شهرية|شهري)"
    r"|(?:ضاعف|مضاعفة)\s+(?:أموالك|اموالك|مالك|رأس المال|راس المال|الأرباح|الارباح)",
    re.IGNORECASE,
)
ENGLISH_EARNINGS = re.compile(
    r"\b(?:guaranteed|guarantee)\s+(?:profit|profits|earnings?|income|returns?|yield)\b"
    r"|\b(?:make|earn)\s+(?:easy\s+)?money\b"
    r"|\bpassive\s+income\b"
    r"|\b(?:daily|weekly|monthly)\s+(?:profit|profits|returns?|income)\b"
    r"|\b(?:profits?|earnings?)\s+(?:are|will\s+be|is)\s+(?:paid|distributed|credited|guaranteed)\b"
    r"|\b(?:distribute|distributes|pay|pays)\s+(?:the\s+)?(?:viewing\s+)?(?:profits?|earnings?)\b"
    r"|\b(?:earn|earnings?)\s+(?:from|by|through)\s+(?:watching|viewing|ads?|clicks?|referrals?)\b"
    r"|\bget\s+paid\s+to\s+(?:watch|view|click)\b"
    r"|\bpaid\s+per\s+(?:view|click|watch)\b"
    r"|\bprofit[\s-]sharing\b"
    r"|\bdouble\s+(?:your\s+)?(?:money|investment|profits?)\b",
    re.IGNORECASE,
)


def has_arabic(text: Any) -> bool:
    return any(
        0x0600 <= ord(ch) <= 0x06FF
        or 0x0750 <= ord(ch) <= 0x077F
        or 0x08A0 <= ord(ch) <= 0x08FF
        for ch in str(text or "")
    )


def has_earnings_claim(text: Any) -> bool:
    value = str(text or "")
    return bool(ARABIC_EARNINGS.search(value) or ENGLISH_EARNINGS.search(value))


def public_caption(episode: dict[str, Any]) -> str:
    channel = episode.get("channel", "general")
    if channel not in {"general", "coins"}:
        raise ValueError("Only the existing general and coins channels are allowed.")

    caption = episode.get("caption") or (
        str(episode.get("hook") or "")
        + "\n"
        + str(episode.get("title") or "")
        + " | Sham AI\n"
        + str(episode.get("site") or "")
        + str(episode.get("path") or "")
    )
    fields = [
        caption,
        episode.get("title", ""),
        episode.get("hook", ""),
        episode.get("script", ""),
    ]
    if any(has_earnings_claim(value) for value in fields):
        raise ValueError("Public promo copy contains a profit or returns promise.")

    if channel == "coins":
        if str(episode.get("lang") or "").lower() != "en":
            raise ValueError("Coins-channel episodes must declare lang=en.")
        if any(has_arabic(value) for value in fields):
            raise ValueError("Coins-channel episode must be English-only, including narration.")
        return str(caption).strip()

    value = re.sub(r"<[^>]*>", "", str(caption)).strip()
    first = next((line.strip() for line in value.splitlines() if line.strip()), "")
    if not re.search(r"[A-Za-z]", first):
        caption = "Sham AI update\n\n" + str(caption).strip()
    return str(caption).strip()


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "episode.json")
    try:
        episode = json.loads(path.read_text(encoding="utf-8"))
        print(public_caption(episode))
        return 0
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"promo publish blocked: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
