"""
Sham's own tool-call shape, enforced INSIDE its generation (not by a rule after the fact).

A donor body (Qwen3) writes a call as  <tool_call>{"name": "...", "arguments": {...}}</tool_call>.  A small model sometimes writes a name that does not exist or breaks
the JSON. Here the decoding itself is held to the valid shape:
  - after the opening tag the next tokens must spell  {"name": "<one of the LOADED tools>", "arguments":  (a token trie over the loaded tools' names: the model still
    chooses WHICH tool through its own logits, it just cannot invent one or mistype the frame);
  - the arguments are free (that is where the model's judgement is), and generation stops at the closing tag;
  - repair_call() closes a truncated or slightly broken JSON body when that is unambiguous.
The loaded tools are read from the prompt the engine builds (src/lib/shamTools.ts: lines "- name(arg, ...) — ..."). No tools in the prompt = nothing is constrained.
"""
from __future__ import annotations

import json
import re

OPEN_TAG, CLOSE_TAG = "<tool_call>", "</tool_call>"


def tool_names_from_prompt(prompt: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"^- ([A-Za-z_][\w]*)\(", prompt, re.M)))


def _single_id(tokenizer, text: str) -> int | None:
    ids = tokenizer.encode(text)
    return ids[0] if len(ids) == 1 else None


class ToolCallGuard:
    """allowed_fn for generate_tokens: restricts the tokens right after the opening tag to the frame + a loaded tool's name."""

    def __init__(self, tokenizer, names: list[str]):
        self.open_id = _single_id(tokenizer, OPEN_TAG)
        self.close_id = _single_id(tokenizer, CLOSE_TAG)
        self.trie: dict = {}
        for n in names:
            node = self.trie
            for t in tokenizer.encode(f'{{"name": "{n}", "arguments":'):
                node = node.setdefault(t, {})
            node["end"] = {}                                     # (token ids are ints, so the string key cannot collide)
        self.usable = self.open_id is not None and self.close_id is not None and bool(names)

    def __call__(self, new_ids: list[int]):
        if not self.usable or self.open_id not in new_ids:
            return None
        i = len(new_ids) - 1 - new_ids[::-1].index(self.open_id)
        node = self.trie
        for t in new_ids[i + 1:]:
            if t not in node:
                return None                                      # past the frame (arguments) or something unexpected: free
            node = node[t]
        kids = {k for k in node if k != "end"}
        if "end" in node and not kids:
            return None                                          # frame complete: the arguments are the model's
        return kids or None


def extract_tool_call(text: str, prompt: str, available_tool_names: list[str] | None = None) -> dict | None:
    """Turn the model's constrained call envelope into a typed function call.

    This is the Studio-side protocol boundary: callers receive a structured
    {name, arguments, text} object, not a tool-call tag to parse themselves.
    Only names present in the current prompt are accepted. Arguments must be a
    JSON object; the execution service still performs its full schema and
    permission validation before running anything.
    """
    raw = str(text or "").strip()
    if not raw:
        return None
    repaired = repair_call(raw)
    match = re.search(re.escape(OPEN_TAG) + r"\s*([\s\S]*?)\s*" + re.escape(CLOSE_TAG), repaired)
    if not match:
        return None
    try:
        payload = json.loads(match.group(1).strip())
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    name = str(payload.get("name") or payload.get("tool") or "").strip()
    prompt_names = set(tool_names_from_prompt(prompt))
    if available_tool_names is not None:
        prompt_names.intersection_update(str(item).strip() for item in available_tool_names)
    if not name or name not in prompt_names:
        return None
    arguments = payload.get("arguments", payload.get("args", payload.get("parameters", {})))
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    if not isinstance(arguments, dict):
        return None
    remainder = (repaired[:match.start()] + repaired[match.end():]).strip()
    return {"name": name, "arguments": arguments, "text": remainder}


def repair_call(text: str) -> str:
    """Make the LAST <tool_call> body valid JSON when a small, certain fix does it (missing closing braces / quote / close tag). Anything else is returned untouched
    (the engine then sends the error back to the model)."""
    i = text.rfind(OPEN_TAG)
    if i < 0:
        return text
    head, body = text[:i], text[i + len(OPEN_TAG):]
    body = body.split(CLOSE_TAG)[0].strip()
    try:
        json.loads(body)
        return f"{head}{OPEN_TAG}{body}{CLOSE_TAG}"
    except ValueError:
        pass
    stack, in_str, esc = [], False, False
    for ch in body:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]" and stack:
            stack.pop()
    fixed = body + ('"' if in_str else "") + "".join(reversed(stack))
    fixed = re.sub(r",\s*([}\]])", r"\1", fixed)
    try:
        json.loads(fixed)
        return f"{head}{OPEN_TAG}{fixed}{CLOSE_TAG}"
    except ValueError:
        return text


if __name__ == "__main__":
    import torch

    from generate import generate_tokens
    from model import ShamSmall, ShamSmallConfig

    class Tok:                       # one id per character, plus the two tags as single ids
        vocab_size = 200
        OPEN, CLOSE = 150, 151

        def encode(self, t):
            out = []
            while t:
                if t.startswith(OPEN_TAG):
                    out.append(self.OPEN); t = t[len(OPEN_TAG):]
                elif t.startswith(CLOSE_TAG):
                    out.append(self.CLOSE); t = t[len(CLOSE_TAG):]
                else:
                    out.append(ord(t[0]) % 140 + 1); t = t[1:]
            return out

    names = tool_names_from_prompt("الأدوات:\n- github_read_file(repo, path) — x\n- sandbox_exec(command) — y\n- ask_user(question, options?) — z\nالصيغة")
    assert names == ["github_read_file", "sandbox_exec", "ask_user"], names
    tok = Tok()
    g = ToolCallGuard(tok, names)
    assert g.usable and g([5, 6]) is None
    cfg = ShamSmallConfig(vocab_size=200, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=256)
    torch.manual_seed(0)
    model = ShamSmall(cfg).train(False)
    for seed in range(8):                                       # a random model, forced to open a call: the frame and a REAL tool name come out every time
        torch.manual_seed(seed)
        prompt = torch.tensor([[7, 8, 9]])
        out = generate_tokens(model, prompt, 70, temperature=1.0, allowed_fn=g, stop_ids={tok.CLOSE}, forced_ids=[tok.OPEN] + [None] * 69)
        new = out[0, prompt.shape[1]:].tolist()[1:]       # after the forced opening tag
        frame = [t for t in new[:len(tok.encode('{"name": "ask_user", "arguments":'))]]
        txt_frames = {tuple(tok.encode(f'{{"name": "{n}", "arguments":')) for n in names}
        assert any(tuple(new[:len(f)]) == f for f in txt_frames), (seed, new[:20])
    assert g([tok.OPEN] + tok.encode('{"name": "ask_user", "arguments":')) is None   # the arguments are free
    assert repair_call('hi <tool_call>{"name": "sandbox_exec", "arguments": {"command": "ls') == 'hi <tool_call>{"name": "sandbox_exec", "arguments": {"command": "ls"}}</tool_call>'
    assert repair_call('<tool_call>{"name": "a", "arguments": {"x": 1,}}') == '<tool_call>{"name": "a", "arguments": {"x": 1}}</tool_call>'
    assert repair_call("جواب عادي") == "جواب عادي"
    assert repair_call('<tool_call>{"name": "a" "arguments"}</tool_call>') == '<tool_call>{"name": "a" "arguments"}</tool_call>'   # not a certain fix: untouched
    print("sham_toolcall self-test OK")
