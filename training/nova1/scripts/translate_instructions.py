"""Arabic for code tasks only: rewrites the USER instruction of sampled code rows in Modern Standard Arabic and asks for the
explanation part of the answer in Arabic, leaving every code block, identifier, file name, command and error message as is.
Uses an OpenAI-compatible endpoint serving Qwen3.5 (Apache-2.0), e.g. llama.cpp `llama-server` on the base GGUF or the coder
ModelScope Studio. Rows whose code blocks change during rewriting are dropped.

    LLM_BASE_URL=http://127.0.0.1:8080/v1 python scripts/translate_instructions.py data/mix.raw.jsonl data/ar_code.jsonl --n 15000
"""
import argparse
import json
import os
import random
import re
import urllib.request

FENCE = re.compile(r"```.*?```", re.S)
ASK_Q = ("Translate the following programming task into clear Modern Standard Arabic. Keep code, identifiers, file paths, "
         "commands, numbers and quoted strings exactly as they are. Output only the translation.\n\n")
ASK_A = ("Rewrite the prose of this programming answer in clear Modern Standard Arabic. Copy every fenced code block "
         "byte-for-byte. Keep identifiers and technical terms in English where Arab developers normally do. Output only the answer.\n\n")


def chat(prompt: str) -> str:
    body = {"model": os.environ.get("LLM_MODEL", "qwen3.5-4b"), "temperature": 0.2,
            "messages": [{"role": "user", "content": prompt}], "chat_template_kwargs": {"enable_thinking": False}}
    req = urllib.request.Request(os.environ["LLM_BASE_URL"].rstrip("/") + "/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + os.environ.get("LLM_API_KEY", "none")})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)["choices"][0]["message"]["content"].strip()


ARABIC = re.compile(r"[\u0600-\u06FF]")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--n", type=int, default=15000)
    a = ap.parse_args()
    random.seed(7)
    rows = [json.loads(l) for l in open(a.src)]
    rows = [r for r in rows if r["source"] in ("sc2_selfoss", "opencodeinstruct", "opc_stage2", "synth_repair") and "tools" not in r]
    random.shuffle(rows)
    made = 0
    with open(a.dst, "w") as f:
        for r in rows:
            u = next(m for m in r["messages"] if m["role"] == "user")
            last = r["messages"][-1]
            try:
                q = chat(ASK_Q + u["content"])
                ans = chat(ASK_A + last["content"]) if random.random() < 0.6 else last["content"]   # 40% keep an English answer
            except Exception:
                continue
            if FENCE.findall(q) != FENCE.findall(u["content"]) or FENCE.findall(ans) != FENCE.findall(last["content"]):
                continue
            if len(ARABIC.findall(q)) < 20:
                continue
            msgs = [m if m is not u else {"role": "user", "content": q} for m in r["messages"][:-1]] + [{"role": "assistant", "content": ans}]
            f.write(json.dumps({"messages": msgs}, ensure_ascii=False) + "\n")
            made += 1
            if made >= a.n:
                break
    print("arabic code rows:", made)


if __name__ == "__main__":
    main()
