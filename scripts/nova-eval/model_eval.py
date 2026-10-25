#!/usr/bin/env python3
"""Free model bake-off for Nova (owner's rule: nothing that costs money).

Calls ModelScope API-Inference (free daily quota, OpenAI-compatible) for a list of candidate models and measures what decides whether a
model can run Nova's agent loop: (1) native tool calling in OUR tool format, (2) small coding tasks graded by real tests, (3) speed.
Standard library only. The token comes from the environment (MODELSCOPE_TOKEN), is never printed. With EVAL_BASE set it tests a local llama.cpp server instead (no token).

  python3 scripts/nova-eval/model_eval.py [--models a,b] [--selftest]
"""
from __future__ import annotations

import argparse, json, os, re, subprocess, sys, tempfile, time, urllib.error, urllib.request

BASE = os.environ.get("EVAL_BASE", "https://api-inference.modelscope.cn/v1").rstrip("/")   # EVAL_BASE=http://127.0.0.1:8080/v1 = a local llama-server
LOCAL = "EVAL_BASE" in os.environ and not os.environ.get("EVAL_KEY")                                       # local: no token, long timeouts (CPU speed), shorter code answers
TIMEOUT = int(os.environ.get("EVAL_TIMEOUT", "900" if LOCAL else "150"))
CODE_TOKENS = int(os.environ.get("EVAL_CODE_TOKENS", "900" if LOCAL else "1800"))
CANDIDATES = [
    "deepseek-ai/DeepSeek-V4-Pro", "deepseek-ai/DeepSeek-V4.1-Flash", "ZhipuAI/GLM-5.2", "MiniMax/MiniMax-M3",
    "Qwen/Qwen3.5-397B-A17B", "Qwen/Qwen3.8-27B", "Qwen/Qwen3.5-122B-A10B", "nex-agi/Nex-N2.5-Pro", "stepfun-ai/Step-3.7-Flash",
]

def tool(name, desc, props, req):
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {"type": "object", "properties": props, "required": req}}}
S = lambda d: {"type": "string", "description": d}
TOOLS = [
    tool("github_read_file", "Read one file of a GitHub repository.", {"repo": S("owner/name"), "path": S("file path")}, ["repo", "path"]),
    tool("web_search", "Search the web for quick facts.", {"query": S("search query")}, ["query"]),
    tool("schedule_create", "Schedule a task that runs by itself later and reports back. kind cron = repeats on a time pattern.", {"title": S("short name"), "prompt": S("full instruction"), "kind": {"type": "string", "enum": ["cron", "event"]}, "recurrence": S("'daily 09:00', 'weekdays 08:30', 'weekly mon 18:00', 'hourly :15'")}, ["prompt", "kind"]),
    tool("ask_user", "Ask the user ONE short question when you cannot go on without a decision or a missing detail.", {"question": S("the question")}, ["question"]),
    tool("memory_note", "Save a short note you need in later steps.", {"text": S("note")}, ["text"]),
    tool("github_delete_branch", "Delete a branch of a repository.", {"repo": S("owner/name"), "branch": S("branch")}, ["repo", "branch"]),
]
SYSTEM = "You are Nova AI, the coding assistant by the Sham team. Use the tools when they fit; ask the user only when a needed detail is missing. Reply in the user's language."
if os.environ.get("EVAL_PAYLOAD"):                                       # Nova's real system prompt and its WHOLE tool set (scripts/nova-eval/base_payload.json): can the model still pick the right tool among them all?
    _p = json.load(open(os.environ["EVAL_PAYLOAD"]))
    TOOLS, SYSTEM = _p["full"], _p["system"]
# (prompt, expected tool or None, argument check)
TOOL_CASES = [
    ("اقرأ الملف README.md من المستودع acme/site", "github_read_file", lambda a: "acme/site" in str(a.get("repo")) and "README" in str(a.get("path"))),
    ("ابحث في الويب عن آخر إصدار من Next.js", "web_search", lambda a: "next" in str(a.get("query", "")).lower()),
    ("كل يوم الساعة 9 صباحاً اكتب لي تقريراً قصيراً عن حالة المستودع acme/site", "schedule_create", lambda a: a.get("kind") == "cron" and re.search(r"9|09", str(a.get("recurrence", "")))),
    ("احذف الفرع القديم", "ask_user", lambda a: bool(a.get("question"))),            # repo and branch are missing: it must ask, not guess
    ("ما هي عاصمة فرنسا؟", None, lambda a: True),                                      # no tool needed
    ("دوّن ملاحظة لنفسك: الخطة ثلاث خطوات، القراءة ثم الاختبار ثم الدمج", "memory_note", lambda a: len(str(a.get("text", ""))) > 8),
]
CODE_TASKS = [
    ("Write a Python function roman_to_int(s) that converts a Roman numeral (I..MMMCMXCIX) to int.",
     "assert roman_to_int('III')==3 and roman_to_int('IV')==4 and roman_to_int('MCMXCIV')==1994 and roman_to_int('LVIII')==58"),
    ("Write a Python function merge_intervals(iv) that merges overlapping [start,end] intervals (touching intervals merge too) and returns them sorted.",
     "assert merge_intervals([[1,3],[2,6],[8,10],[15,18]])==[[1,6],[8,10],[15,18]] and merge_intervals([[1,4],[4,5]])==[[1,5]] and merge_intervals([])==[]"),
    ("Write a Python class LRUCache(capacity) with get(key) (returns -1 if missing) and put(key, value); evict the least recently used when full.",
     "c=LRUCache(2); c.put(1,1); c.put(2,2); assert c.get(1)==1; c.put(3,3); assert c.get(2)==-1; c.put(4,4); assert c.get(1)==-1 and c.get(3)==3 and c.get(4)==4"),
    ("Write a Python function flatten(x) that flattens arbitrarily nested lists/tuples of ints into one flat list, preserving order.",
     "assert flatten([1,[2,[3,(4,5)],6],[],7])==[1,2,3,4,5,6,7] and flatten([])==[] and flatten([[[]]])==[]"),
    ("Write a Python function top_k(words, k) returning the k most frequent words, ties broken alphabetically.",
     "assert top_k(['b','a','b','c','a','b','c','c'],2)==['b','c'] and top_k(['x','y'],5)==['x','y'] and top_k([],3)==[]"),
    ("This binary search has a bug. Return the corrected full function `bsearch(a, x)` (index of x in sorted list a, else -1):\n"
     "def bsearch(a, x):\n    lo, hi = 0, len(a)\n    while lo < hi:\n        mid = (lo+hi)//2\n        if a[mid] == x: return mid\n        if a[mid] < x: lo = mid\n        else: hi = mid\n    return -1",
     "assert bsearch([1,3,5,7,9],7)==3 and bsearch([1,3,5,7,9],1)==0 and bsearch([1,3,5,7,9],9)==4 and bsearch([1,3],2)==-1 and bsearch([],1)==-1"),
]

def call(model, messages, tools=None, max_tokens=1500, timeout=None):
    timeout = timeout or TIMEOUT
    """One streamed chat completion. Returns dict(text, tool_calls, ttft, total, error, status)."""
    body = {"model": model, "messages": messages, "stream": True, "max_tokens": max_tokens, "temperature": 0.2,
            "enable_thinking": False, "chat_template_kwargs": {"enable_thinking": False}, "stream_options": {"include_usage": True}}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    req = urllib.request.Request(f"{BASE}/chat/completions", data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {os.environ.get('EVAL_KEY') or os.environ.get('MODELSCOPE_TOKEN', '')}", "Content-Type": "application/json"})
    t0 = time.time(); ttft = None; text = ""; calls = {}; usage = {}
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            for raw in r:
                line = raw.decode("utf-8", "ignore").strip()
                if not line.startswith("data:") or line.endswith("[DONE]"):
                    continue
                try:
                    d = json.loads(line[5:])
                except ValueError:
                    continue
                usage = d.get("usage") or usage
                for ch in d.get("choices") or []:
                    dl = ch.get("delta") or {}
                    piece = dl.get("content") or ""
                    if (piece or dl.get("tool_calls")) and ttft is None:
                        ttft = time.time() - t0
                    text += piece
                    for tc in dl.get("tool_calls") or []:
                        c = calls.setdefault(tc.get("index", 0), {"name": "", "arguments": ""})
                        f = tc.get("function") or {}
                        c["name"] += f.get("name") or ""
                        c["arguments"] += f.get("arguments") or ""
    except urllib.error.HTTPError as e:
        return {"text": "", "tool_calls": [], "ttft": None, "total": time.time() - t0, "error": f"HTTP {e.code}", "status": e.code, "usage": {}}
    except Exception as e:  # timeouts, resets
        return {"text": text, "tool_calls": list(calls.values()), "ttft": ttft, "total": time.time() - t0, "error": type(e).__name__, "status": 0, "usage": usage}
    return {"text": text, "tool_calls": list(calls.values()), "ttft": ttft, "total": time.time() - t0, "error": "", "status": 200, "usage": usage}

def extract_code(text):
    m = re.findall(r"```(?:python|py)?\n(.*?)```", text, re.S)
    return max(m, key=len) if m else text

def run_tests(code, test):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "t.py")
        open(p, "w").write(code + "\n\n" + test + "\nprint('PASS')\n")
        try:
            r = subprocess.run([sys.executable, "-I", p], capture_output=True, text=True, timeout=10, cwd=d)
            return "PASS" in r.stdout and r.returncode == 0
        except subprocess.TimeoutExpired:
            return False

def judge_tool(case, res):
    prompt, want, check = case
    calls = res["tool_calls"]
    if want is None:
        return not calls and bool(res["text"].strip())
    if not calls or calls[0]["name"] != want:
        return False
    try:
        a = json.loads(calls[0]["arguments"] or "{}")
    except ValueError:
        return False
    return isinstance(a, dict) and bool(check(a))

def eval_model(model):
    out = {"model": model, "tool": 0, "code": 0, "ttft": [], "tps": [], "errors": [], "calls": 0}
    def note(res):
        out["calls"] += 1
        if res["error"]:
            out["errors"].append(res["error"])
        if res["ttft"] is not None:
            out["ttft"].append(res["ttft"])
        toks = (res.get("usage") or {}).get("completion_tokens") or max(1, len(res["text"]) // 3)
        if res["total"] and res["ttft"] is not None and res["total"] > res["ttft"] + 0.3:
            out["tps"].append(toks / (res["total"] - res["ttft"]))
    for case in TOOL_CASES:
        res = call(model, [{"role": "system", "content": SYSTEM}, {"role": "user", "content": case[0]}], TOOLS, max_tokens=600)
        note(res); out["tool"] += int(judge_tool(case, res))
        if res["status"] == 429:
            out["errors"].append("quota"); break
    for spec, test in CODE_TASKS:
        res = call(model, [{"role": "user", "content": spec + "\nReply with ONE ```python block containing only the code."}], None, max_tokens=CODE_TOKENS)
        note(res)
        if res["text"]:
            out["code"] += int(run_tests(extract_code(res["text"]), test))
        if res["status"] == 429:
            out["errors"].append("quota"); break
    return out

def selftest():
    good = ["def roman_to_int(s):\n    v={'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000}\n    t=0\n    for i,c in enumerate(s):\n        t+= -v[c] if i+1<len(s) and v[c]<v[s[i+1]] else v[c]\n    return t"]
    assert run_tests(extract_code("x\n```python\n" + good[0] + "\n```"), CODE_TASKS[0][1])
    assert not run_tests("def roman_to_int(s):\n    return 0", CODE_TASKS[0][1])
    assert judge_tool(TOOL_CASES[0], {"tool_calls": [{"name": "github_read_file", "arguments": '{"repo":"acme/site","path":"README.md"}'}], "text": ""})
    assert not judge_tool(TOOL_CASES[3], {"tool_calls": [{"name": "github_delete_branch", "arguments": '{"repo":"a/b","branch":"x"}'}], "text": ""})
    assert judge_tool(TOOL_CASES[4], {"tool_calls": [], "text": "باريس"})
    assert judge_tool(TOOL_CASES[2], {"tool_calls": [{"name": "schedule_create", "arguments": '{"prompt":"x","kind":"cron","recurrence":"daily 09:00"}'}], "text": ""})
    print("selftest ok")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=",".join(CANDIDATES))
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not LOCAL and not os.environ.get("MODELSCOPE_TOKEN"):
        sys.exit("MODELSCOPE_TOKEN is not set")
    rows = []
    for m in [x.strip() for x in a.models.split(",") if x.strip()]:
        t0 = time.time()
        r = eval_model(m)
        rows.append(r)
        avg = lambda xs: (sum(xs) / len(xs)) if xs else 0
        print(f"{m}: tools {r['tool']}/{len(TOOL_CASES)}  code {r['code']}/{len(CODE_TASKS)}  first-token {avg(r['ttft']):.1f}s  ~{avg(r['tps']):.0f} tok/s  errors {sorted(set(r['errors'])) or '-'}  ({time.time()-t0:.0f}s)", flush=True)
    rows.sort(key=lambda r: (-(r["tool"] + r["code"]), (sum(r["ttft"]) / len(r["ttft"])) if r["ttft"] else 1e9))
    print("\n| rank | model | tools | code | first token | tok/s | errors |\n|---|---|---|---|---|---|---|")
    for i, r in enumerate(rows, 1):
        avg = lambda xs: (sum(xs) / len(xs)) if xs else 0
        print(f"| {i} | {r['model']} | {r['tool']}/{len(TOOL_CASES)} | {r['code']}/{len(CODE_TASKS)} | {avg(r['ttft']):.1f}s | {avg(r['tps']):.0f} | {', '.join(sorted(set(r['errors']))) or '-'} |")
    if not any(r["ttft"] for r in rows):
        sys.exit("no model answered at all (" + ", ".join(sorted({e for r in rows for e in r["errors"]})) + "): this is not a ranking; check the token / API-Inference access of the account")

if __name__ == "__main__":
    main()
