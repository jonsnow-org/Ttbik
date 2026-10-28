"""Structured boundary between Sham v2's constrained text generation and its native agent API.

The model is still autoregressive text generation; this module converts the single
constrained call envelope into a typed function-call object. Execution, schema checks,
consent and side effects remain in the Sham web runtime.
"""
from __future__ import annotations

import json
import re

from sham_toolcall import CLOSE_TAG, OPEN_TAG, repair_call, tool_names_from_prompt


def extract_tool_call(text: str, prompt: str, available_tool_names: list[str] | None = None) -> dict | None:
    """Return one allowed call as {name, arguments, text}; reject unknown names or invalid arguments."""
    raw = str(text or "").strip()
    if not raw:
        return None

    repaired = repair_call(raw)
    match = re.search(re.escape(OPEN_TAG) + r"\s*([\s\S]*?)\s*" + re.escape(CLOSE_TAG), repaired)
    payload_text = ""
    remainder = ""
    if match:
        payload_text = match.group(1).strip()
        remainder = (repaired[:match.start()] + repaired[match.end():]).strip()
    else:
        # Normalize fenced/bare JSON calls into the same structured envelope.
        fenced = re.search(r"\x60{3}(?:json)?\s*([\s\S]*?)\s*\x60{3}", repaired, re.IGNORECASE)
        if fenced:
            payload_text = fenced.group(1).strip()
            remainder = (repaired[:fenced.start()] + repaired[fenced.end():]).strip()
        elif repaired.startswith("{") and repaired.endswith("}"):
            payload_text = repaired
        else:
            return None

    try:
        payload = json.loads(payload_text)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None

    name = str(payload.get("name") or payload.get("tool") or "").strip()
    allowed = set(tool_names_from_prompt(prompt))
    if available_tool_names is not None:
        allowed.intersection_update(str(item).strip() for item in available_tool_names)
    if not name or name not in allowed:
        return None

    arguments = payload.get("arguments", payload.get("args", payload.get("parameters", {})))
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    if not isinstance(arguments, dict):
        return None

    return {"name": name, "arguments": arguments, "text": remainder}
