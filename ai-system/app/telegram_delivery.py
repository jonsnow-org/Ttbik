"""Helpers for reliable delivery of Nova text replies to Telegram."""

def split_telegram_text(text: str, limit: int = 3900) -> list[str]:
    """Split long answers into Telegram-safe chunks at paragraph/whitespace boundaries."""
    if limit < 1:
        raise ValueError("limit must be positive")
    remaining = (text or "").strip()
    if not remaining:
        return []
    chunks: list[str] = []
    while len(remaining) > limit:
        cut = remaining.rfind("\n", 0, limit + 1)
        if cut < limit // 2:
            cut = remaining.rfind(" ", 0, limit + 1)
        if cut < limit // 2:
            cut = limit
        chunk = remaining[:cut].strip()
        if chunk:
            chunks.append(chunk)
        remaining = remaining[cut:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks
