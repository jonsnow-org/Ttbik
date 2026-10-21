"""Agentic coding traces in our own tool format (tools/coder_tools.json, the schemas the coder pipeline sends).

For each SWE-Gym / SWE-rebench task: start the task's Docker image, let the base model (any OpenAI-compatible endpoint serving
Qwen3.5) work with the sandbox tools (sandbox_exec, sandbox_read_file, sandbox_write_file) for up to --steps turns, then run the
task's FAIL_TO_PASS and PASS_TO_PASS tests. Only runs where every test passes are written (rejection sampling). The saved row
holds the full message list with tool calls and tool results, ready for SFT. Needs Docker on the machine (Oracle runner or a
local box); no GPU — the model is called over HTTP.

    LLM_BASE_URL=http://127.0.0.1:8080/v1 python scripts/collect_traces.py --tasks SWE-Gym/SWE-Gym --n 300 --out data/nova_traces.jsonl
"""
import argparse
import json
import os
import subprocess
import urllib.request
from pathlib import Path

from datasets import load_dataset

HERE = Path(__file__).resolve().parent.parent
USE = ("sandbox_exec", "sandbox_read_file", "sandbox_write_file")
SYSTEM = ("You are Nova 1, a careful software engineer working in a repository at /testbed. Use the tools to read code, "
          "reproduce the problem, make the smallest correct fix and run the tests. Reply with a short summary when done.")


def tools() -> list:
    return [t for t in json.loads((HERE / "tools" / "coder_tools.json").read_text()) if t["function"]["name"] in USE]


def llm(messages: list, tl: list) -> dict:
    body = {"model": os.environ.get("LLM_MODEL", "qwen3.5-4b"), "temperature": 0.6, "messages": messages, "tools": tl}
    req = urllib.request.Request(os.environ["LLM_BASE_URL"].rstrip("/") + "/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + os.environ.get("LLM_API_KEY", "none")})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.load(r)["choices"][0]["message"]


def sh(cid: str, cmd: str, cwd: str = "/testbed", timeout: int = 300) -> str:
    try:
        r = subprocess.run(["docker", "exec", "-w", cwd, cid, "bash", "-lc", cmd], capture_output=True, text=True, timeout=timeout)
        return (f"exit {r.returncode}\n" + r.stdout + r.stderr)[-6000:]
    except subprocess.TimeoutExpired:
        return "exit 124\ncommand timed out"


def call(cid: str, name: str, args: dict) -> str:
    cwd = args.get("cwd") or "/testbed"
    if name == "sandbox_exec":
        return sh(cid, args["command"], cwd)
    if name == "sandbox_read_file":
        start = int(args.get("start_line") or 1)
        return sh(cid, f"sed -n '{start},{start + int(args.get('max_lines') or 200) - 1}p' {json.dumps(args['path'])}", cwd)
    if name == "sandbox_write_file":
        p = subprocess.run(["docker", "exec", "-i", "-w", cwd, cid, "bash", "-c", f"mkdir -p \"$(dirname {json.dumps(args['path'])})\" && cat > {json.dumps(args['path'])}"],
                           input=args["content"], text=True, capture_output=True)
        return "written" if p.returncode == 0 else p.stderr[-2000:]
    return f"unknown tool {name}"


IMAGE_PREFIX = os.environ.get("TASK_IMAGE_PREFIX", "xingyaoww/sweb.eval.x86_64.")   # SWE-Gym's published images; override per task set


def image_for(t: dict) -> str:
    return t.get("docker_image") or t.get("image_name") or IMAGE_PREFIX + t["instance_id"].replace("__", "_s_").lower()


def solve(t: dict, steps: int) -> list | None:
    cid = subprocess.run(["docker", "run", "-d", "--rm", "--network", "none", image_for(t), "sleep", "3600"], capture_output=True, text=True).stdout.strip()
    if not cid:
        return None
    try:
        tl = tools()
        msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": t["problem_statement"]}]
        for _ in range(steps):
            m = llm(msgs, tl)
            msgs.append({k: v for k, v in m.items() if k in ("role", "content", "tool_calls")})
            if not m.get("tool_calls"):
                break
            for c in m["tool_calls"]:
                try:
                    args = json.loads(c["function"]["arguments"] or "{}")
                    out = call(cid, c["function"]["name"], args)
                except Exception as e:
                    out = f"error: {e}"
                msgs.append({"role": "tool", "tool_call_id": c.get("id"), "content": out})
        # hidden tests are applied only after the model has finished, exactly like SWE-bench grading
        subprocess.run(["docker", "exec", "-i", "-w", "/testbed", cid, "git", "apply", "-"], input=t["test_patch"], text=True, capture_output=True)
        tests = json.loads(t["FAIL_TO_PASS"]) + json.loads(t["PASS_TO_PASS"]) if isinstance(t["FAIL_TO_PASS"], str) else t["FAIL_TO_PASS"] + t["PASS_TO_PASS"]
        if tests and sh(cid, "python -m pytest -q -x " + " ".join(json.dumps(x) for x in tests[:200]), timeout=1200).startswith("exit 0"):
            return msgs
        return None
    finally:
        subprocess.run(["docker", "rm", "-f", cid], capture_output=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", default="SWE-Gym/SWE-Gym")
    ap.add_argument("--split", default="train")
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--steps", type=int, default=40)
    ap.add_argument("--out", default=str(HERE / "data" / "nova_traces.jsonl"))
    a = ap.parse_args()
    ok = 0
    with open(a.out, "a") as f:
        for t in load_dataset(a.tasks, split=a.split, streaming=True):
            msgs = solve(t, a.steps)
            if msgs:
                f.write(json.dumps({"tools": tools(), "messages": msgs, "task": t["instance_id"]}, ensure_ascii=False) + "\n")
                ok += 1
                print("kept", t["instance_id"], ok)
            if ok >= a.n:
                break


if __name__ == "__main__":
    main()
