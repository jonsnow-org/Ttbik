#!/usr/bin/env python3
"""python terminal/terminal_loop.py --model sham1 --demo : task -> the model thinks (latent steps, no words) and writes ONE command block -> the sandbox runs it -> the result comes back -> the pair is saved
(success -> memory_lora/, failure -> memory_errors/: the self-evolution records; training them into LoRA is the next stage)."""
import argparse
import hashlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from common import ROOT  # noqa: E402
import torch  # noqa: E402
from sham_tldm import Sham1_TLDM, encode_bytes, decode_bytes  # noqa: E402
import terminal_tasks as T  # noqa: E402


def load(ckpt):
    ck = torch.load(ckpt, map_location="cpu")
    c = ck["cfg"]
    m = Sham1_TLDM(d=c["d"], layers=c["layers"], latents=c["latents"], think_steps=c["think_steps"], block=c["block"], writer_layers=c["writer_layers"], heads=c["heads"], bitnet=c["bitnet"], in_len=c["in_len"])
    m.load_state_dict(ck["model"])
    m.eval()
    return m, c


def save_evolution(folder_root, task, command, result, success):
    folder = os.path.join(folder_root, "memory_lora" if success else "memory_errors")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, hashlib.md5(task.encode()).hexdigest()[:10] + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"task": task, "command": command, "result": result[:500], "success": success}, f, ensure_ascii=False, indent=2)
    return path


def run_task(model, cfg, task, term, confirm_cb=None):
    t0 = time.time()
    ids = torch.tensor([encode_bytes(task, cfg["in_len"])])
    out, info = model.generate(ids, steps=cfg["diffusion_steps"], early_exit=True)
    command = decode_bytes(out[0])
    r = term.run(command)
    if r.needs_confirmation and confirm_cb is not None and confirm_cb(command):
        r = term.run(command, confirm=True)
    return command, r, info, time.time() - t0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="sham1")
    ap.add_argument("--ckpt", default=os.path.join(ROOT, "checkpoints", "0.3b", "final.pt"))
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--memory", default=os.path.join(ROOT, "checkpoints", "memory"))
    a = ap.parse_args()
    model, cfg = load(a.ckpt)
    term = T.fresh()
    print("=== SHAM T-LDM terminal ===  (type a task; 'exit' to quit; confirmation questions are asked before mkdir)")
    tasks = ["Organize files", "list files", "how many errors are in the log", "create a backup folder"] if a.demo else None
    try:
        i = 0
        while True:
            if tasks is not None:
                if i >= len(tasks):
                    break
                task = tasks[i]; i += 1
                print(f"\n>> {task}")
            else:
                try:
                    task = input("\n>> ")
                except EOFError:
                    break
                if task.strip() in ("exit", "quit"):
                    break
            term.task = task
            command, r, info, secs = run_task(model, cfg, task, term, confirm_cb=(lambda c: True) if a.demo else (lambda c: input(f"confirm `{c}`? [y/N] ").strip().lower() == "y"))
            shown = r.refused and f"[BLOCKED] {r.refused}" or r.out or "[ok, no output]"
            print(f"[model wrote] {command}\n[terminal] {shown}\n[time] {secs:.3f}s | latent steps used {info['latent_steps_used']}")
            print("saved", save_evolution(a.memory, task, command, shown, r.ok))
    finally:
        term.close()


if __name__ == "__main__":
    main()
