#!/usr/bin/env python3
"""Live check of what a model really does on the computer hub: fetch a public GitHub repository, search it, read and edit files, list the changes it would publish,
run real commands, start a background job and list which programmer tools exist. Same authenticated Gradio calls as the app; throw-away session; publishes nothing."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelscope_computer_smoke as smoke  # noqa: E402

TOOLS = ("git gh rg jq curl wget gcc g++ make cmake python3 pip3 node npm go java ruby php rustc cargo ffmpeg convert pandoc sqlite3 psql redis-cli mysql clang gdb valgrind "
         "vim nano tmux htop tree unzip 7z rsync ssh ping dig nc strace shellcheck fzf fdfind ag").split()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", required=True)
    ap.add_argument("--repo", default="https://github.com/jonsnow-org/Ttbik")
    args = ap.parse_args()
    token = (os.environ.get("MODELSCOPE_TOKEN") or "").strip()
    session = "check:coder"
    failures: list[str] = []

    def step(label: str, payload: dict, must: bool = True, timeout: int = 120) -> dict:
        t0 = time.time()
        payload = {"session": session, **payload}
        try:
            r = smoke.box_call(args.api, token, payload, timeout=timeout)
        except Exception as exc:  # noqa: BLE001
            r = {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:200]}"}
        ok = r.get("ok") is not False
        print(f"[{'PASS' if ok else 'FAIL'}] {label} ({time.time() - t0:.1f}s)", flush=True)
        if not ok and must:
            failures.append(label)
            print("    ", json.dumps(r, ensure_ascii=False)[:400], flush=True)
        return r

    status = step("computer status", {"action": "status"}, must=False)
    print("    toolchain:", status.get("toolchain"), "| devtools:", status.get("devtools"), flush=True)
    repo = step("computer_repo: get the public repository", {"action": "repo", "url": args.repo}, timeout=150)
    if repo.get("job"):                                       # still downloading: wait for it
        for _ in range(40):
            log = smoke.box_call(args.api, token, {"session": session, "action": "job_log", "id": repo["job"]})
            if log.get("ok") and not log.get("running"):
                repo = {"ok": log.get("exit_code") == 0, "path": f"repos/{args.repo.rstrip('/').split('/')[-2]}-{args.repo.rstrip('/').split('/')[-1]}"}
                break
            time.sleep(3)
    folder = repo.get("path") or "repos/jonsnow-org-Ttbik"
    print("    path:", folder, "| summary:", str(repo.get("summary", ""))[:200].replace("\n", " | "), flush=True)
    found = step("computer_search: find a symbol (ripgrep)", {"action": "search", "pattern": "coderSystemPrompt", "path": folder, "glob": "*.ts"})
    print("    matches:", str(found.get("matches", ""))[:200].replace("\n", " | "), flush=True)
    step("computer_read: read a file", {"action": "read", "path": f"{folder}/package.json"})
    step("computer_write: create a file in the checkout", {"action": "write", "path": f"{folder}/zz_check.txt", "content": "check\n"})
    step("computer_edit: edit a file", {"action": "edit", "path": f"{folder}/zz_check.txt", "old": "check", "new": "checked"})
    changes = step("changes the model would publish (computer_publish input)", {"action": "changes", "dir": folder, "repo": "jonsnow-org/Ttbik"}, must=False)
    print("    changes:", json.dumps(changes, ensure_ascii=False)[:300], flush=True)
    step("computer_run: run the code (python)", {"action": "run", "command": "python3 -c \"print(sum(range(10)))\"", "cwd": folder})
    job = step("computer_job: start a background job", {"action": "job_start", "command": "sleep 2; echo background-done", "name": "check"})
    time.sleep(5)
    if job.get("id"):
        log = smoke.box_call(args.api, token, {"session": session, "action": "job_log", "id": job["id"]})
        print("    job log:", str(log.get("output", ""))[:100].strip(), "| finished:", not log.get("running"), flush=True)
    cmd = "for t in " + " ".join(TOOLS) + "; do command -v $t >/dev/null 2>&1 && echo ok:$t || echo MISSING:$t; done"
    tools = step("programmer tools present", {"action": "run", "command": cmd}, must=False)
    out = str(tools.get("output", ""))
    missing = [x.split(":", 1)[1] for x in out.split() if x.startswith("MISSING:")]
    print("    present:", sum(1 for x in out.split() if x.startswith("ok:")), "| missing:", ", ".join(missing) or "none", flush=True)
    print("FAILED STEPS:", failures or "none", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
