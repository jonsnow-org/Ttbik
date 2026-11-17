"""The hidden terminal behind Sham's chat (v1 and v2): the user writes to the chat; the T-LDM model reads the task and what the terminal returned so far and writes the NEXT block:
    "$ <command>"  -> run through the model's own embedded computer (ShamEmbeddedBackend);   anything else -> the final reply, the only thing the user sees.
OFF by default: SHAM_TLDM=1 enables it, and nothing in the serving code calls it until it is deliberately wired (after the model passes the gate).

Long-term memory as files (step 2 of docs/experiments/TLDM_TERMINAL_SPEC.md §3), optional (`memory_factory=None` = off, the behaviour before it existed):
  * RECALL: a task this model already finished successfully is REPLAYED command by command; after each command the result must equal the remembered one.
            All equal -> the remembered reply, with no model call.  First difference -> the replay stops there and the model continues from the REAL history
            (a remembered value is never written over a different present: the check runs before the next command).
  * LESSONS: a command that failed for the same task before is not run again; the model sees one line saying so and writes another block.
  * every finished episode is saved (success = a final reply was reached and every command that ran exited 0); the store is per model (memory_for(root, model_id, session)).
"""
from __future__ import annotations

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "data"))
sys.path.insert(0, os.path.join(HERE, "memory"))
sys.path.insert(0, os.path.join(HERE, "..", "terminal"))
import trajectories as J  # noqa: E402
from store import MemoryStore, memory_for  # noqa: E402,F401

LESSON = "[lesson] this command failed before for this task; not run again"
GAVE_UP = "I could not finish within the allowed number of steps."


def enabled() -> bool:
    return os.environ.get("SHAM_TLDM", "0").strip() == "1"


def _flat(r) -> str:
    return (r.out if r.ok else (r.refused or r.out)).strip().replace("\n", " ")


def load_writer(ckpt: str):
    """-> writer(task, hist) -> text of the next block, from a checkpoint of training/train_loop.py. The input is built exactly as in training (J.view_ids:
    the task, then the TAIL of the history), so the latest result the terminal returned is never the part that gets cut."""
    import torch
    sys.path.insert(0, HERE)
    from sham_tldm import Sham1_TLDM, from_state
    ck = torch.load(ckpt, map_location="cpu")
    c = ck["cfg"]
    model = Sham1_TLDM(d=c["d"], layers=c["layers"], latents=c["latents"], think_steps=c["think_steps"], block=c["block"], writer_layers=c["writer_layers"], heads=c["heads"], bitnet=c["bitnet"], in_len=c["in_len"], vocab=c.get("vocab", 257))
    model.load_state_dict(ck["model"])
    model.eval()
    tok = from_state(ck.get("tokenizer", {"kind": "byte"}))

    def writer(task, hist):
        ids = torch.tensor([J.view_ids(tok, task, hist, c["in_len"])])
        with torch.no_grad():
            out, _ = model.generate(ids, steps=c["diffusion_steps"])
        return tok.decode(out[0])
    return writer


class TLDMChat:
    def __init__(self, writer, backend_factory, max_steps: int = 5, confirm=None, memory_factory=None):
        """writer(task, hist) -> text of the next block. backend_factory(session) -> an executor with .run(command, confirm).
        memory_factory(session) -> this model's MemoryStore for that session, or None (memory off)."""
        self.writer, self.backend_factory, self.max_steps, self.confirm = writer, backend_factory, max_steps, confirm
        self.memory_factory = memory_factory
        self.last_info: dict = {}

    @classmethod
    def from_checkpoint(cls, ckpt: str, backend_factory, **kw):
        return cls(load_writer(ckpt), backend_factory, **kw)

    def respond(self, session: str, message: str):
        """-> (reply, events). The terminal stays hidden: `events` is for the owner's logs, not for the user. `self.last_info` says how the reply was made."""
        t0 = time.time()
        backend, hist, events, steps = self.backend_factory(session), [], [], []
        backend.task = message[:200]
        info = {"mode": "model", "writer_calls": 0, "replayed": 0, "lessons": 0}
        self.last_info = info
        memory = None
        if self.memory_factory is not None:
            try:
                memory = self.memory_factory(session)
            except OSError:
                memory = None                                       # memory is a help, never a reason to fail the reply

        def execute(cmd):
            r = backend.run(cmd)
            if r.needs_confirmation and self.confirm is not None and self.confirm(cmd):
                r = backend.run(cmd, confirm=True)
            events.append(r)
            out = _flat(r)
            hist.append((cmd, out))
            steps.append((cmd, out, bool(r.ok)))
            return r, out

        def finish(reply, success):
            if memory is not None:
                try:
                    memory.save(message, steps, reply, success, time.time() - t0)
                except OSError:
                    pass
            return reply, events

        rec = memory.recall(message) if memory is not None else None
        if rec is not None:
            diverged = False
            for s in rec.get("steps", []):
                r, out = execute(s[0])
                info["replayed"] += 1
                if not r.ok or out != str(s[1]).strip().replace("\n", " "):
                    diverged = True
                    break
            if not diverged:
                info["mode"] = "recall"
                return rec.get("reply", ""), events           # nothing new to save: the remembered episode is still true
            info["mode"] = "recall+model"
        bad = memory.failed_commands(message) if memory is not None else set()
        for _ in range(self.max_steps):
            info["writer_calls"] += 1
            text = self.writer(message, hist).strip()
            if not text.startswith("$ "):
                return finish(text, all(ok for _, _, ok in steps))
            cmd = text[2:].strip()
            if cmd in bad:
                info["lessons"] += 1
                hist.append((cmd, LESSON))
                continue
            execute(cmd)
        return finish(GAVE_UP, False)
