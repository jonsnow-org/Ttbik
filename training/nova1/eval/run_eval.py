"""Nova 1 eval: runs a model behind any OpenAI-compatible endpoint (llama-server on the GGUF, vLLM, or the ModelScope Studio) on
  1. HumanEval+ and MBPP+ (EvalPlus, base + plus tests, pass@1 greedy)
  2. our Arabic-instruction coding tasks (eval/arabic_code_tasks.jsonl, pass@1)
  3. tool-call accuracy in our tool format (eval/tool_calls.jsonl): right tool, required arguments, and no tool when none is needed
and writes one JSON report. Run it on the base model first, then on Nova 1; ship only if Nova 1 is not worse on any line.

    LLM_BASE_URL=http://127.0.0.1:8080/v1 LLM_MODEL=nova1 python eval/run_eval.py --out reports/nova1.json
Generated code is executed: run inside a container / the sandbox, never on a machine holding secrets.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FENCE = re.compile(r"```(?:python|py)?\n(.*?)```", re.S)


def chat(messages, tools=None, max_tokens=2048):
    body = {"model": os.environ.get("LLM_MODEL", "nova1"), "temperature": 0, "max_tokens": max_tokens, "messages": messages,
            "chat_template_kwargs": {"enable_thinking": os.environ.get("THINK", "0") == "1"}}
    if tools:
        body["tools"] = tools
    req = urllib.request.Request(os.environ["LLM_BASE_URL"].rstrip("/") + "/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + os.environ.get("LLM_API_KEY", "none")})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.load(r)["choices"][0]["message"]


def code_of(text: str) -> str:
    b = FENCE.findall(text or "")
    return max(b, key=len) if b else (text or "")


def passes(code: str, tests: str) -> bool:
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "t.py"
        p.write_text(code + "\n\n" + tests + "\n")
        try:
            return subprocess.run([sys.executable, str(p)], capture_output=True, timeout=30, cwd=d).returncode == 0
        except subprocess.TimeoutExpired:
            return False


def evalplus(dataset: str, workdir: Path) -> dict:
    from evalplus.data import get_human_eval_plus, get_mbpp_plus, write_jsonl
    probs = get_human_eval_plus() if dataset == "humaneval" else get_mbpp_plus()
    samples = []
    for tid, p in probs.items():
        m = chat([{"role": "user", "content": "Complete this Python function. Return the whole function in one ```python block.\n\n```python\n" + p["prompt"] + "\n```"}])
        samples.append({"task_id": tid, "solution": code_of(m.get("content"))})
    f = workdir / f"{dataset}_samples.jsonl"
    write_jsonl(str(f), samples)
    r = subprocess.run([sys.executable, "-m", "evalplus.evaluate", "--dataset", dataset, "--samples", str(f)], capture_output=True, text=True)
    nums = re.findall(r"pass@1:\s*([0-9.]+)", r.stdout)
    return {"base": float(nums[0]) if nums else None, "plus": float(nums[1]) if len(nums) > 1 else None}


def arabic() -> dict:
    ok = n = 0
    for line in (HERE / "arabic_code_tasks.jsonl").open():
        t = json.loads(line)
        m = chat([{"role": "user", "content": t["prompt_ar"] + "\n\nاكتب الحل بلغة بايثون في كتلة ```python واحدة."}])
        n += 1
        ok += passes(code_of(m.get("content")), t["tests"])
    return {"pass@1": ok / max(n, 1), "n": n}


def tool_calls() -> dict:
    tools = json.loads((ROOT / "tools" / "coder_tools.json").read_text())
    ok = n = 0
    for line in (HERE / "tool_calls.jsonl").open():
        t = json.loads(line)
        m = chat([{"role": "system", "content": "You are Nova 1, a coding agent. Use a tool only when it is needed."},
                  {"role": "user", "content": t["prompt"]}], tools=tools, max_tokens=512)
        calls = m.get("tool_calls") or []
        n += 1
        if t["expect_tool"] is None:
            ok += not calls
            continue
        if not calls or calls[0]["function"]["name"] != t["expect_tool"]:
            continue
        args = calls[0]["function"].get("arguments") or "{}"
        args = json.loads(args) if isinstance(args, str) else args
        ok += all(k in args and (v is None or str(args[k]).strip("/") == v) for k, v in t["expect_args"].items())
    return {"accuracy": ok / max(n, 1), "n": n}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="reports/eval.json")
    ap.add_argument("--skip", nargs="*", default=[], choices=["humaneval", "mbpp", "arabic", "tools"])
    a = ap.parse_args()
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    rep = {"model": os.environ.get("LLM_MODEL")}
    if "humaneval" not in a.skip:
        rep["humaneval_plus"] = evalplus("humaneval", out.parent)
    if "mbpp" not in a.skip:
        rep["mbpp_plus"] = evalplus("mbpp", out.parent)
    if "arabic" not in a.skip:
        rep["arabic_code"] = arabic()
    if "tools" not in a.skip:
        rep["tool_calls"] = tool_calls()
    out.write_text(json.dumps(rep, indent=2))
    print(json.dumps(rep, indent=2))


if __name__ == "__main__":
    main()
