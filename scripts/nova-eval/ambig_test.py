#!/usr/bin/env python3
"""A vague request ("can you inspect a project on GitHub and fix the errors?", no project named) must be answered with a question, not with a search + clone of some project nobody named.
Sends it N times (balanced accuracy, thinking off) to a local llama-server with (a) Nova's fixed full tool list and (b) the earlier small list (load_tools + ask_user + delegate) and
prints what the model did first each time."""
import json, sys, urllib.request, collections

P = json.load(open("scripts/nova-eval/ambig_payload.json"))
N = int(sys.argv[1]) if len(sys.argv) > 1 else 8
MSGS = {"vague (user without GitHub)": ("system_user", "هل تستطيع فحص مشروع على جيتهوب واصلاح الاخطاء"),
        "vague, other wording": ("system_user", "اريد منك مراجعة كود مشروعي واصلاح مشاكله"),
        "named but no GitHub linked": ("system_user", "افحص المستودع jonsnow-org/Ttbik على جيتهوب وأخبرني بأخطائه ولا تصلح شيئاً")}

def post(body):
    r = urllib.request.Request("http://127.0.0.1:8080/v1/chat/completions", data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(r, timeout=3600))

for tools_name in ("full", "lite"):
    for label, (sysk, text) in MSGS.items():
        seen = collections.Counter()
        for k in range(N):
            d = post({"messages": [{"role": "system", "content": P[sysk]}, {"role": "user", "content": text}], "tools": P[tools_name], "max_tokens": 160, "temperature": 0.6, "chat_template_kwargs": {"enable_thinking": False}})
            m = d["choices"][0]["message"]
            calls = m.get("tool_calls") or []
            seen[calls[0]["function"]["name"] if calls else ("text-question" if "?" in (m.get("content") or "") or "؟" in (m.get("content") or "") else "text")] += 1
        print(f"{tools_name:5s} | {label:32s} | {dict(seen)}", flush=True)
