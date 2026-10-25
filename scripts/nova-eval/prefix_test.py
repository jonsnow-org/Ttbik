#!/usr/bin/env python3
"""How much of a new conversation's prompt is read again when the start of every prompt (system + tools) is the same?
Uses Nova's real system prompt and tool definitions (base_payload.json) against a local llama-server.
  prefix_test.py all   : every request carries the whole tool set (stable start)
  prefix_test.py lite  : requests start with the small tool set; the github group is added in the middle of a task (what load_tools does today)
"""
import json, sys, time, urllib.request

mode = sys.argv[1]
d = json.load(open(sys.argv[2] if len(sys.argv) > 2 else "scripts/nova-eval/base_payload.json"))
SYSTEM = d["system"]
FILL = " ".join("الخطوة %d: يقرأ الخادم الطلب ثم يتحقق من الرمز ثم يستعلم من قاعدة البيانات ثم يكتب سطراً في السجل." % i for i in range(1, 60))

def post(body):
    r = urllib.request.Request("http://127.0.0.1:8080/v1/chat/completions", data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(r, timeout=3600))

def ask(label, tools, user, history=None, mt=12):
    msgs = [{"role": "system", "content": SYSTEM}] + (history or []) + [{"role": "user", "content": user}]
    t0 = time.time()
    r = post({"messages": msgs, "tools": tools, "max_tokens": mt, "temperature": 0.2, "chat_template_kwargs": {"enable_thinking": False}})
    t = r.get("timings", {})
    print("%-34s read now %5s tok | from cache %5s tok | wall %4.0f s" % (label, t.get("prompt_n"), t.get("cache_n"), time.time() - t0), flush=True)

if mode == "all":
    T = d["all"]
    ask("warm-up (the base itself)", T, ".")
    ask("conversation A (new, short)", T, "ما هي عاصمة اليابان؟ أجب بسطر واحد.")
    ask("conversation B (new, short)", T, "اشرح لي ما هو الـ webhook بجملتين.")
    h = [{"role": "user", "content": FILL}, {"role": "assistant", "content": "تم."}]
    ask("conversation C (2.5k-token history)", T, "لخّص ما سبق بسطر.", h)
    ask("conversation D (new, short, after C)", T, "كم يساوي ١٢ في ٧؟")
else:
    L, A = d["lite"], d["all"]
    ask("warm-up (small base)", L, ".")
    ask("conversation A (new, short)", L, "ما هي عاصمة اليابان؟ أجب بسطر واحد.")
    h = [{"role": "user", "content": "اقرأ الملف README.md"}, {"role": "assistant", "content": "سأحمّل أدوات GitHub."}]
    ask("same task, github group loaded", L + d["github"], "تابع.", h)
    ask("conversation B (new, short)", L, "اشرح لي ما هو الـ webhook بجملتين.")
