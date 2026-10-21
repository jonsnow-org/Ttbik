"""Builds the phase-1 (code) training mix as chat JSONL in the format the coder serves with (Qwen3.5 chat template, OpenAI-style
tool calls). Streams every source, normalises it to {"messages": [...], "tools"?: [...], "source": key}, filters, and samples to the
weights in datasets.yaml. Output: data/mix.raw.jsonl (dedup / decontamination run afterwards: scripts/dedup_decontam.py).

    python scripts/check_licenses.py && python scripts/build_mix.py --tokens 60_000_000
"""
import argparse
import ast
import json
import random
import re
from pathlib import Path

import yaml
from datasets import load_dataset

HERE = Path(__file__).resolve().parent.parent
SYSTEM = "You are Nova 1, a careful software engineer. Write correct, tested, minimal code. Explain briefly in the user's language."
CODE_BLOCK = re.compile(r"```(?:python|py)?\n(.*?)```", re.S)
ANY_BLOCK = re.compile(r"```.*?```", re.S)
# Rows of other sources in which an assistant (or a system message) speaks as another provider's model. SHAM AI's identity
# comes from identity/identity_sft.jsonl, so such rows are rewritten (system message) or left out (assistant self-description).
PROVIDERS = r"(?:Qwen\w*|Tongyi|Alibaba(?: Cloud)?|ChatGPT|GPT-?[34]\w*|OpenAI|Claude|Anthropic|Gemini|Bard|Llama\w*|Meta AI|DeepSeek\w*|Mistral|Mixtral|Nemotron|StarCoder\w*|Phi-?\d\w*|Grok|Google|Microsoft|NVIDIA)"
SELF_ID = re.compile(
    r"\b(?:I am|I'm|I’m|my name is|call me)\s+(?:an?\s+)?(?:AI\s+|large\s+|language\s+|model\s+|assistant\s+|named\s+|called\s+)*" + PROVIDERS + r"\b"
    r"|\bI\s+(?:was|am|have been)\s+(?:created|developed|trained|built|made|designed)\s+by\s+(?:the\s+)?(?:\w+\s+){0,3}?" + PROVIDERS +
    r"|\b(?:I am|I'm|I’m|as)\s+an?\s+[\w\s-]{0,40}?\b(?:created|developed|trained|built|made|designed)\s+by\s+(?:the\s+)?(?:\w+\s+){0,3}?" + PROVIDERS +
    r"|\b(?:Qwen|Tongyi)\w*\b[^.\n]{0,80}\b(?:created|developed|made|built)\s+by\s+Alibaba"
    r"|通义千问|我是.{0,6}(?:千问|Qwen)|阿里(?:巴巴|云)"
    r"|أنا\s+(?:نموذج\s+)?(?:Qwen|ChatGPT|Claude|Gemini|Llama|DeepSeek|كوين|تشات ?جي ?بي ?تي)|(?:طوّرت|طورت|طوّرتني|طورتني|صنعتني|دربتني)\S*\s+(?:شركة\s+)?(?:علي ?بابا|OpenAI|Alibaba|جوجل|Google)",
    re.I)
SYS_ID = re.compile(r"\byou are\s+(?:an?\s+)?(?:AI\s+|assistant\s+|named\s+|called\s+)*" + PROVIDERS + r"\b|created by Alibaba|通义千问", re.I)
SCRUB = {"system_rewritten": 0, "dropped_self_id": 0}


def scrub_identity(row: dict) -> bool:
    """Rewrites another provider's identity in a system message to SYSTEM; returns False for a row whose assistant turns
    describe themselves as another provider's model (prose only; code blocks are not looked at)."""
    for m in row["messages"]:
        if m.get("role") == "system" and SYS_ID.search(m.get("content") or ""):
            m["content"] = SYSTEM
            SCRUB["system_rewritten"] += 1
        elif m.get("role") == "assistant" and SELF_ID.search(ANY_BLOCK.sub(" ", m.get("content") or "")):
            SCRUB["dropped_self_id"] += 1
            return False
    return True


IDENTITY_TOOLS = ("web_search", "sandbox_exec", "github_read_file", "memory_search")


def identity_rows(path: Path):
    """identity/identity_sft.jsonl in three renderings, so the identity holds with no system message, with the training system
    message, and with tools offered (a small subset of tools/coder_tools.json, every third row, to keep rows short)."""
    tools = [t for t in json.loads((HERE / "tools" / "coder_tools.json").read_text()) if t["function"]["name"] in IDENTITY_TOOLS]
    base = [json.loads(line) for line in path.open() if line.strip()]
    for r in base:
        yield {"messages": r["messages"]}
    for r in base:
        yield {"messages": [{"role": "system", "content": SYSTEM}] + r["messages"]}
    for r in base[::3]:
        yield {"messages": r["messages"], "tools": tools}


def msgs(user: str, assistant: str, system: str = SYSTEM) -> list:
    return [{"role": "system", "content": system}, {"role": "user", "content": user.strip()}, {"role": "assistant", "content": assistant.strip()}]


def python_parses(text: str) -> bool:
    blocks = CODE_BLOCK.findall(text)
    if not blocks:
        return True          # non-Python answers are not checked here
    try:
        for b in blocks:
            ast.parse(b)
        return True
    except SyntaxError:
        return False


def rows(key: str):
    """Yields normalised rows for one source key."""
    if key == "sc2_selfoss":
        for r in load_dataset("bigcode/self-oss-instruct-sc2-exec-filter-50k", split="train", streaming=True):
            yield {"messages": msgs(r["instruction"], r["response"])}
    elif key == "opencodeinstruct":
        for r in load_dataset("nvidia/OpenCodeInstruct", split="train", streaming=True):
            if float(r.get("average_test_score") or 0) >= 0.8:
                yield {"messages": msgs(r["input"], r["output"])}
    elif key == "opc_stage2":
        for sub in ("educational_instruct", "package_instruct"):
            for r in load_dataset("OpenCoder-LLM/opc-sft-stage2", sub, split="train", streaming=True):
                yield {"messages": msgs(r["instruction"], r["output"])}
    elif key in ("nemotron_code", "nemotron_tools"):
        split = "code" if key == "nemotron_code" else "tool_calling"
        for r in load_dataset("nvidia/Nemotron-Post-Training-Dataset-v1", split=split, streaming=True):
            gen = str(r.get("generator") or "")
            if "llama" in gen.lower() or "CC BY 4.0" not in str(r.get("license") or ""):
                continue
            m = r["messages"]
            if isinstance(m, str):
                m = json.loads(m)
            yield {"messages": m}
    elif key == "ocr_reasoning":
        for r in load_dataset("nvidia/OpenCodeReasoning", "split_0", split="split_0", streaming=True):
            out = r.get("output") or ""
            if out and len(out) < 64_000:
                yield {"messages": msgs(r["input"], out)}
    elif key == "commitpackft":
        langs = next(x for x in yaml.safe_load((HERE / "datasets.yaml").read_text())["sources"] if x["key"] == "commitpackft")["languages"]
        for lang in langs:
            # the hub repo still carries a loading script (no longer run by datasets>=4): read its JSONL files directly
            files = f"hf://datasets/bigcode/commitpackft/data/{lang}/data.jsonl"
            for r in load_dataset("json", data_files=files, split="train", streaming=True):
                if len(r["old_contents"]) > 12_000:
                    continue
                user = f"{r['message']}\n\nFile `{r['old_file']}`:\n```\n{r['old_contents']}\n```\nReturn the full updated file."
                yield {"messages": msgs(user, f"```\n{r['new_contents']}\n```")}
    elif key == "xlam_fc":
        for r in load_dataset("Salesforce/xlam-function-calling-60k", split="train", streaming=True):
            tools = json.loads(r["tools"])
            calls = json.loads(r["answers"])
            yield {
                "tools": [{"type": "function", "function": t} for t in tools],
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": r["query"]},
                    {"role": "assistant", "content": "", "tool_calls": [
                        {"type": "function", "function": {"name": c["name"], "arguments": json.dumps(c["arguments"], ensure_ascii=False)}} for c in calls]},
                ],
            }
    elif key == "identity":
        yield from identity_rows(HERE / "identity" / "identity_sft.jsonl")
    else:  # generated locally (synth_repair, nova_traces, ar_code): read their JSONL
        p = HERE / "data" / f"{key}.jsonl"
        if p.exists():
            with p.open() as f:
                for line in f:
                    try:
                        yield json.loads(line)
                    except ValueError:      # a last line cut short (generator stopped by a time limit)
                        continue


def ok(row: dict) -> bool:
    last = row["messages"][-1]
    text = last.get("content") or ""
    if not text and not last.get("tool_calls"):
        return False
    return python_parses(text)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tokens", type=int, default=60_000_000, help="target size of the mix in (approximate) tokens")
    ap.add_argument("--seed", type=int, default=3407)
    ap.add_argument("--max-len", type=int, default=0, help="drop rows longer than this many (approx.) tokens, e.g. 2048 for config.colab.yaml")
    ap.add_argument("--out", default=str(HERE / "data" / "mix.raw.jsonl"))
    a = ap.parse_args()
    random.seed(a.seed)
    plan = yaml.safe_load((HERE / "datasets.yaml").read_text())
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as f:
        for s in plan["sources"]:
            if s["status"] not in ("use", "use-subset"):
                continue
            budget = int(a.tokens * float(s["weight"]))
            used = 0
            try:
                for r in rows(s["key"]):
                    if not ok(r):
                        continue
                    if s["key"] != "identity" and not scrub_identity(r):
                        continue
                    r["source"] = s["key"]
                    n = sum(len(m.get("content") or "") for m in r["messages"]) // 4      # ~4 chars per token
                    if a.max_len and n > a.max_len:
                        continue
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
                    used += n
                    if used >= budget:
                        break
            except Exception as e:  # e.g. a gated source without an HF token: the rest of the mix is still built
                print(f"{s['key']:18s} skipped: {type(e).__name__}: {str(e)[:160]}")
            print(f"{s['key']:18s} {used:>12,} / {budget:,} tokens")
    print("identity scrub:", json.dumps(SCRUB))


if __name__ == "__main__":
    main()
