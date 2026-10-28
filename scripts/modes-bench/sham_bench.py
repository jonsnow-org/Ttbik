"""Sham v2 (Qwen3-1.7B body, own Studio): the same three prompts with the bot's real tool conversation, in each speed / thinking combination.
Usage: T=<token> python sham_bench.py [base url]"""
import json, sys, time
from common import call, SHAM_V2

BASE = sys.argv[1] if len(sys.argv) > 1 else SHAM_V2
FIX = json.load(open("fixtures.json"))
OUT = []
st = call(BASE, "status", {})
print("STATUS", json.dumps({k: st.get(k) for k in ("phase", "model", "detail", "device", "threads", "cpu_count") if isinstance(st, dict) and k in st}, ensure_ascii=False)[:400], flush=True)
print("STATUS-keys", sorted(st.keys())[:40] if isinstance(st, dict) else st, flush=True)


def run(label, prompt, mx, header=""):
    t0 = time.time()
    r = call(BASE, "generate_any", {"prompt": header + prompt, "max_new_tokens": mx}, t=300)
    total = round(time.time() - t0, 1)
    text = (r.get("text") if isinstance(r, dict) else str(r)) or ""
    row = dict(label=label, total_s=total, type=r.get("type") if isinstance(r, dict) else None, chars=len(text), text=text[:300].replace("\n", " / "))
    print(json.dumps(row, ensure_ascii=False), flush=True)
    OUT.append(row)


MODES = [("fast", 96, "[[sham temp=0.70]]\n"), ("balanced", 160, "[[sham temp=0.60]]\n"), ("balanced+think(400t)", 160, "[[sham temp=0.60 think=400]]\n"),
         ("precise", 240, "[[sham temp=0.20]]\n"), ("precise+think(1000t)", 240, "[[sham temp=0.20 think=1000]]\n")]
run("warmup", FIX["sham"]["chat"], 8)
for task in ("chat", "code", "github"):
    for name, mx, hdr in MODES:
        run(f"{task} | {name}", FIX["sham"][task], mx, hdr)
run("chat | balanced (repeat 2)", FIX["sham"]["chat"], 160, "[[sham temp=0.60]]\n")
run("chat | balanced (repeat 3)", FIX["sham"]["chat"], 160, "[[sham temp=0.60]]\n")
run("github step2 | balanced", FIX["sham_github_step2"], 160, "[[sham temp=0.60]]\n")
t0 = time.time()
r = call(BASE, "generate_media_from_panel", {"kind": "image", "prompt": "a white horse standing in a green field", "backend_label": "المسار البديل (أوزان محلية جاهزة)", "scenes_json": "[]", "narration": ""}, t=600)
print(json.dumps({"label": "image 512 (Studio default)", "total_s": round(time.time() - t0, 1), "type": r.get("type") if isinstance(r, dict) else None, "b64_chars": len(r.get("b64", "")) if isinstance(r, dict) else 0, "text": (r.get("text", "") if isinstance(r, dict) else "")[:120]}, ensure_ascii=False), flush=True)
json.dump(OUT, open("sham_v2.json", "w"), ensure_ascii=False, indent=1)
