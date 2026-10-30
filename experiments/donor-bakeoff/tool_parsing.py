"""Tool-call parsing helpers for donor model runtimes.

Supports OpenAI function-call objects, Qwen-style JSON tool calls, Gemma 4's
textual <|tool_call>call:name{...}<tool_call|> form, and XML-style calls.
"""
from __future__ import annotations
import json
import re
from typing import Any

_GEMMA_CALL = re.compile(r"<\|tool_call\>\s*call:([A-Za-z0-9_.-]+)\s*\{(.*?)\}<tool_call\|>", re.S)
_JSON_CALL = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.S)
_FUNCTION_CALL = re.compile(r"<function=([^>\n]+)>\s*(.*?)</function>", re.S)
_STRING_MARKER = '<|"|>'


def _split_top_level(value: str, separator: str = ",") -> list[str]:
    parts, start, depth, in_string, i = [], 0, 0, False, 0
    while i < len(value):
        if value.startswith(_STRING_MARKER, i):
            in_string = not in_string
            i += len(_STRING_MARKER)
            continue
        char = value[i]
        if not in_string:
            if char in "[{":
                depth += 1
            elif char in "]}":
                depth = max(0, depth - 1)
            elif char == separator and depth == 0:
                parts.append(value[start:i].strip())
                start = i + 1
        i += 1
    tail = value[start:].strip()
    if tail:
        parts.append(tail)
    return parts


def _split_key_value(part: str) -> tuple[str, str] | None:
    depth, in_string, i = 0, False, 0
    while i < len(part):
        if part.startswith(_STRING_MARKER, i):
            in_string = not in_string
            i += len(_STRING_MARKER)
            continue
        char = part[i]
        if not in_string:
            if char in "[{":
                depth += 1
            elif char in "]}":
                depth = max(0, depth - 1)
            elif char == ":" and depth == 0:
                key = part[:i].strip()
                if key:
                    return key, part[i + 1:].strip()
        i += 1
    return None


def _parse_value(value: str) -> Any:
    value = value.strip()
    if not value:
        return ""
    if value.startswith(_STRING_MARKER):
        end = value.find(_STRING_MARKER, len(_STRING_MARKER))
        if end >= 0:
            return value[len(_STRING_MARKER):end]
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        return [_parse_value(x) for x in _split_top_level(inner)] if inner else []
    if value.startswith("{") and value.endswith("}"):
        return _parse_gemma_arguments(value[1:-1])
    try:
        return json.loads(value)
    except Exception:
        return value.rstrip(",").strip()


def _parse_gemma_arguments(body: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for item in _split_top_level(body):
        pair = _split_key_value(item)
        if pair:
            result[pair[0]] = _parse_value(pair[1])
    return result


def parse_tool_calls(message: dict[str, Any]) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    for call in message.get("tool_calls") or []:
        if not isinstance(call, dict):
            continue
        fn = call.get("function") or {}
        args: Any = fn.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {"_invalid_json": args}
        calls.append({"name": fn.get("name"), "arguments": args if isinstance(args, dict) else {}})

    content = str(message.get("content") or "")
    for match in _GEMMA_CALL.finditer(content):
        calls.append({"name": match.group(1), "arguments": _parse_gemma_arguments(match.group(2))})

    if not calls:
        for match in _JSON_CALL.finditer(content):
            try:
                item = json.loads(match.group(1))
            except Exception:
                continue
            if isinstance(item, dict) and item.get("name"):
                args = item.get("arguments")
                calls.append({"name": str(item["name"]), "arguments": args if isinstance(args, dict) else {}})

    if not calls:
        for match in _FUNCTION_CALL.finditer(content):
            args = {}
            for param in re.finditer(r"<parameter=([^>\n]+)>\s*(.*?)\s*</parameter>", match.group(2), re.S):
                args[param.group(1).strip()] = _parse_value(param.group(2).strip())
            calls.append({"name": match.group(1).strip(), "arguments": args})
    return calls


def strip_tool_call_markup(content: str) -> str:
    value = str(content or "")
    value = _GEMMA_CALL.sub("", value)
    value = _JSON_CALL.sub("", value)
    value = _FUNCTION_CALL.sub("", value)
    return value.replace("<|tool_response>", "").replace("<|tool_response|>", "").strip()
