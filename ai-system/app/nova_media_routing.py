"""Explicit media-tool selection for Nova. All providers passed here are Nova-owned or external; Sham is never a provider."""
from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


def generate_image(
    prompt: str,
    *,
    external_enabled: bool,
    hf_generate: Callable[[str], T | None],
    cloudflare_generate: Callable[[str], T | None],
    nova_studio_generate: Callable[[str], T | None],
    nova_model_generate: Callable[[str], T | None],
) -> tuple[T | None, str]:
    """Use exactly the selected tool family; external failure never falls back to Nova internal tools."""
    if external_enabled:
        result = hf_generate(prompt)
        if result is not None:
            return result, "huggingface"
        result = cloudflare_generate(prompt)
        if result is not None:
            return result, "cloudflare"
        return None, "external-unavailable"
    result = nova_studio_generate(prompt)
    if result is not None:
        return result, "nova-media-studio"
    result = nova_model_generate(prompt)
    if result is not None:
        return result, "nova-modelscope"
    return None, "nova-internal-unavailable"
