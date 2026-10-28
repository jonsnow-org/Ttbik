"""Nova (Qwen3.5-4B on a coder Studio): latency / speed / tool-call quality for the SAME three prompts, with the bot's real system text and tool list.
Usage: T=<token> python nova_bench.py <studio number>"""
import json, sys, time
from common import call, nova_base

N = sys.argv[1]
BASE = nova_base(N)
FIX = json.load(open("fixtures.json"))
SYS, TOOLS = FIX["nova"]["system"], FIX["nova"]["tools"]
LITE_SYS = "You are Nova AI, a helpful assistant. Reply in the user's language (Arabic or English), briefly and directly."
OUT = []


def run(label, msgs, tools, max_tokens, think, temp=0.6, limit=600):
    t0 = time.time()
    r = call(BASE, "chat", {"messages": json.dumps(msgs), "tools": json.dumps(tools) if tools else "", "max_tokens": max_tokens, "think": think, "temperature": temp, "wait_s": 5})
    job = r.get("job"); ttft = None
    while r.get("type") == "pending" and time.time() - t0 < limit:
        time.sleep(1.5)
        r = call(BASE, "job_result", {"job_id": job, "offset": 0})
        if ttft is None and (r.get("total") or r.get("reasoning_len") or r.get("tool_calls")):
            ttft = round(time.time() - t0, 1)
    total = round(time.time() - t0, 1)
    tm = r.get("timings") or {}
    calls = [(c.get("function") or {}).get("name") + " " + str((c.get("function") or {}).get("arguments"))[:120] for c in (r.get("tool_calls") or [])]
    row = dict(label=label, total_s=total, ttft_s=ttft, type=r.get("type"), prompt_n=tm.get("prompt_n"), cache_n=tm.get("cache_n"), prompt_tps=tm.get("prompt_per_second"), gen_n=tm.get("predicted_n"),
               gen_tps=tm.get("predicted_per_second"), reasoning_chars=r.get("reasoning_len"), answer_chars=len(r.get("text") or ""), tool_calls=calls, text=(r.get("text") or "")[:260].replace("\n", " / "))
    print(json.dumps(row, ensure_ascii=False), flush=True)
    OUT.append(row)
    return r


print("STATUS", json.dumps({k: v for k, v in call(BASE, "status", {}).items() if k in ("phase", "model", "ctx", "threads", "queue", "cpu_model", "error")}, ensure_ascii=False), flush=True)
full = lambda user, extra=None: [{"role": "system", "content": SYS}, *(extra or []), {"role": "user", "content": user}]
lite = lambda user, extra=None: [{"role": "system", "content": LITE_SYS}, *(extra or []), {"role": "user", "content": user}]
T = FIX["tasks"]
run("warmup full-prompt (cold read of system+tools)", full("hi"), TOOLS, 1, "", limit=900)
run("chat | full prompt+tools | think OFF", full(T["chat"]), TOOLS, 300, "")
run("chat | full prompt+tools | think ON (balanced cap)", full(T["chat"]), TOOLS, 400, "1")
run("chat | lite system, no tools | OFF (1st: cold prefix)", lite(T["chat"]), None, 200, "", limit=300)
run("chat | lite system, no tools | OFF (2nd: warm prefix)", lite("كيف حالك اليوم؟"), None, 200, "")
run("code | full prompt+tools | think OFF", full(T["code"]), TOOLS, 500, "")
run("code | full prompt+tools | think ON (balanced)", full(T["code"]), TOOLS, 700, "1")
run("code | lite, no tools | think OFF", lite(T["code"]), None, 500, "")
run("github step1 | full+tools | think OFF", full(T["github"]), TOOLS, 300, "")
run("github step1 | full+tools | think ON", full(T["github"]), TOOLS, 500, "1")
step2 = [{"role": "assistant", "content": "", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "github_read_files", "arguments": json.dumps({"repo": "octocat/Hello-World", "paths": ["README.md"]})}}]},
         {"role": "tool", "name": "github_read_files", "tool_call_id": "c1", "content": "README.md:\nHello World!\n\nThis repository is a demo for GitHub's Hello World tutorial. It contains a single README file."}]
run("github step2 (summarise tool result) | OFF", full(T["github"], None)[:1] + [{"role": "user", "content": T["github"]}] + step2, TOOLS, 300, "")
json.dump(OUT, open(f"nova_{N}.json", "w"), ensure_ascii=False, indent=1)
