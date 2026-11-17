"""The hidden terminal behind Sham's chat (v1 and v2): the user writes to the chat; the T-LDM model reads the task and what the terminal returned so far and writes the NEXT block:
    "$ <command>"  -> run through the model's own embedded computer (ShamEmbeddedBackend);   anything else -> the final reply, the only thing the user sees.
OFF by default: SHAM_TLDM=1 enables it, and nothing in the serving code calls it until it is deliberately wired (after the model passes the gate)."""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "data"))
sys.path.insert(0, os.path.join(HERE, "..", "terminal"))
import trajectories as J  # noqa: E402


def enabled() -> bool:
    return os.environ.get("SHAM_TLDM", "0").strip() == "1"


class TLDMChat:
    def __init__(self, writer, backend_factory, max_steps: int = 5, confirm=None):
        """writer(view_ids) -> text of the next block. backend_factory(session) -> an executor with .run(command, confirm)."""
        self.writer, self.backend_factory, self.max_steps, self.confirm = writer, backend_factory, max_steps, confirm

    @classmethod
    def from_checkpoint(cls, ckpt: str, backend_factory, **kw):
        import torch
        sys.path.insert(0, HERE)
        from sham_tldm import Sham1_TLDM, from_state
        ck = torch.load(ckpt, map_location="cpu")
        c = ck["cfg"]
        model = Sham1_TLDM(d=c["d"], layers=c["layers"], latents=c["latents"], think_steps=c["think_steps"], block=c["block"], writer_layers=c["writer_layers"], heads=c["heads"], bitnet=c["bitnet"], in_len=c["in_len"], vocab=c.get("vocab", 257))
        model.load_state_dict(ck["model"])
        model.eval()
        tok = from_state(ck.get("tokenizer", {"kind": "byte"}))

        def writer(view_text_pairs_task, hist):
            ids = torch.tensor([tok.encode(J.view_text(view_text_pairs_task, hist), c["in_len"])])
            with torch.no_grad():
                out, _ = model.generate(ids, steps=c["diffusion_steps"])
            return tok.decode(out[0])
        return cls(writer, backend_factory, **kw)

    def respond(self, session: str, message: str):
        """-> (reply, events). The terminal stays hidden: `events` is for the owner's logs, not for the user."""
        backend, hist, events = self.backend_factory(session), [], []
        backend.task = message[:200]
        for _ in range(self.max_steps):
            text = self.writer(message, hist).strip()
            if not text.startswith("$ "):
                return text, events
            cmd = text[2:].strip()
            r = backend.run(cmd)
            if r.needs_confirmation and self.confirm is not None and self.confirm(cmd):
                r = backend.run(cmd, confirm=True)
            events.append(r)
            hist.append((cmd, (r.out if r.ok else (r.refused or r.out)).strip().replace("\n", " ")))
        return "I could not finish within the allowed number of steps.", events
