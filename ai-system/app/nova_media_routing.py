"""Strict Nova-owned image routing: no Sham, third-party API, or secondary model fallback."""
from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


def generate_image(
    prompt: str,
    *,
    nova_studio_generate: Callable[[str], T | None],
) -> tuple[T | None, str]:
    """Use only Nova's dedicated media Studio. Fail closed instead of changing generators."""
    try:
        result = nova_studio_generate(prompt)
    except Exception:
        return None, "nova-media-studio-error"
    if result is None:
        return None, "nova-media-studio-unavailable"
    return result, "nova-media-studio"
