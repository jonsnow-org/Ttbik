"""Pre-training reasoning probe (Kaggle, one T4): the base model on LiveCodeBench release_v6 AtCoder problems (Jan-Apr 2025,
stdin/stdout, public + up to 12 private tests), thinking on vs off. Its result decides the share of reasoning rows (ocr_reasoning).

On the box (2026-10-21, Q4_K_M GGUF on CPU, eval/reasoning_probe_2026-10-21.json): thinking off solved 6 of 13; 6 of the 7
failures ran out of a 2,048-token budget without a final program. Thinking on (4,300 tokens) solved 0 of those 6: every run was
still thinking when the budget ended. The failure is not finishing (no closed reasoning, no final code), so finished, bounded
reasoning traces are what the mix needs more of.

Rule (written to --out, applied by the notebook to its own clone of datasets.yaml before build_mix):
  share of thinking-on runs that end without code >= 0.5, or thinking-on pass rate <= thinking-off pass rate
      -> ocr_reasoning weight 0.12 -> 0.18 (rows are capped at 2,048 tokens by build_mix --max-len, so each one is a finished trace)
  otherwise -> 0.12 unchanged.
Time-capped (--max-minutes); any failure or too few results (< 4 per mode) leaves the weights unchanged.

    python eval/reasoning_probe.py --out /kaggle/working/reasoning_probe.json --max-minutes 25
"""
import argparse, base64, json, pickle, re, subprocess, sys, tempfile, time, zlib, random

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--n", type=int, default=8)
ap.add_argument("--max-minutes", type=float, default=25)
ap.add_argument("--think-tokens", type=int, default=3072)
ap.add_argument("--off-tokens", type=int, default=2048)
a = ap.parse_args()
T0 = time.time()
CODE = re.compile(r"```(?:python|py)?\n(.*?)```", re.S)


def run(code, tests):
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(code)
    for t in tests:
        try:
            o = subprocess.run([sys.executable, f.name], input=t["input"], capture_output=True, text=True, timeout=6)
        except subprocess.TimeoutExpired:
            return "timeout"
        if o.stdout.split() != t["output"].split():
            return "wrong"
    return "pass"


def main():
    import torch
    from huggingface_hub import hf_hub_download
    from transformers import AutoModelForCausalLM, AutoTokenizer
    p = hf_hub_download("livecodebench/code_generation_lite", "test6.jsonl", repo_type="dataset")
    rows = [json.loads(l) for l in open(p)]
    rnd = random.Random(7)
    easy = [r for r in rows if r["platform"] == "atcoder" and r["difficulty"] == "easy"]
    med = [r for r in rows if r["platform"] == "atcoder" and r["difficulty"] == "medium"]
    rnd.shuffle(easy); rnd.shuffle(med)
    probs = easy[: a.n // 2] + med[: a.n - a.n // 2]
    tok = AutoTokenizer.from_pretrained("Qwen/Qwen3.5-4B")
    model = AutoModelForCausalLM.from_pretrained("Qwen/Qwen3.5-4B", dtype=torch.float16).to("cuda").eval()
    res = {"off": [], "think": []}
    for r in probs:
        tests = json.loads(r["public_test_cases"])
        try:
            tests += json.loads(pickle.loads(zlib.decompress(base64.b64decode(r["private_test_cases"]))))[:12]
        except Exception:
            pass
        q = r["question_content"] + "\n\nWrite a Python 3 program that reads from standard input and writes to standard output. Put the complete program in one ```python code block."
        for mode in ("off", "think"):
            if time.time() - T0 > 60 * a.max_minutes:
                break
            text = tok.apply_chat_template([{"role": "user", "content": q}], tokenize=False, add_generation_prompt=True,
                                           enable_thinking=(mode == "think"))
            ids = tok(text, return_tensors="pt").to("cuda")
            with torch.no_grad():
                g = model.generate(**ids, max_new_tokens=a.think_tokens if mode == "think" else a.off_tokens, do_sample=True,
                                   temperature=0.6 if mode == "think" else 0.7, top_p=0.95 if mode == "think" else 0.8, top_k=20)
            out = tok.decode(g[0, ids["input_ids"].shape[1]:], skip_special_tokens=True)
            answer = out.split("</think>")[-1] if mode == "think" else out
            blocks = CODE.findall(answer)
            res[mode].append({"id": r["question_id"], "res": run(blocks[-1], tests) if blocks else "no_code",
                              "tokens": int(g.shape[1] - ids["input_ids"].shape[1])})
            print(mode, res[mode][-1], f"{(time.time() - T0) / 60:.1f} min", flush=True)
    off, th = res["off"], res["think"]
    decision = {"ocr_reasoning_weight": 0.12, "why": "too few results; unchanged"}
    if len(off) >= 4 and len(th) >= 4:
        p_off = sum(x["res"] == "pass" for x in off) / len(off)
        p_th = sum(x["res"] == "pass" for x in th) / len(th)
        unfinished = sum(x["res"] == "no_code" for x in th) / len(th)
        if unfinished >= 0.5 or p_th <= p_off:
            decision = {"ocr_reasoning_weight": 0.18, "why": f"thinking unfinished {unfinished:.0%}, pass on {p_th:.0%} vs off {p_off:.0%}"}
        else:
            decision = {"ocr_reasoning_weight": 0.12, "why": f"thinking helps: pass on {p_th:.0%} vs off {p_off:.0%}"}
    json.dump({"results": res, "decision": decision}, open(a.out, "w"), indent=1)
    print("decision:", decision)


if __name__ == "__main__":
    main()
