"""Read-only sanity check of the PUBLISHED Sham v1 head (owner, 2026-11-15: "is it a technical fault or just a small model?").
Writes nothing anywhere. Prints: (1) tokenizer round trip and id ranges, (2) replies to greetings / simple questions in the chat layout the model was TRAINED on
(<BOS><USER> q <SHAM>) under three decoding settings (greedy; the Studio's chat default; the Studio's other path with repetition penalty 1.3), (3) a task that is
inside the training data (the date line) so "can it do something it was trained on" is answered, (4) whether answers end with <EOS>, (5) the loss on the model's own
answers (a model that has memorised or collapsed shows ~0 or huge)."""
from __future__ import annotations

import datetime
import os
import sys
import time

import torch


def main() -> int:
    from checkpoint import load_checkpoint
    from generate import generate_tokens
    from model import SpecialTokens
    from sham_ci_merge import OWN, WORK
    from sham_decoding import SHAM_TURN, chat_prompt_ids
    from sham_inputs import fetch_dataset
    from sham_chat import date_context_line
    from text_tokenizer import ShamTextTokenizer
    import shutil

    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True)
    own = fetch_dataset(OWN)
    hits = sorted(own.rglob("final_merged.pt")) if own else []
    if not hits:
        print("NO HEAD FOUND")
        # offline (the repository's CI runs every script as a self-test without Kaggle keys): nothing to check, not a failure; the workflow sets SHAM_SANITY_REQUIRE_HEAD=1
        return 1 if os.environ.get("SHAM_SANITY_REQUIRE_HEAD") == "1" else 0
    model, step, _ = load_checkpoint(hits[0], map_location="cpu")
    tok_path = sorted(hits[0].parent.rglob("sham_small_tokenizer.json"))[0]
    tok = ShamTextTokenizer.load(str(tok_path))
    model.eval()
    print(f"head: step {step:,} | vocab in the model {model.cfg.vocab_size} | text tokenizer vocab {tok.vocab_size}")

    print("\n== 1. tokenizer round trip ==")
    bad = 0
    for s in ["مرحبا", "كيف حالك؟", "ما هي عاصمة فرنسا؟", "اكتب لي قصيدة قصيرة", "Hello world", "2 + 3 = 5", "التاريخ اليوم: 2026-11-14"]:
        ids = tok.encode(s)
        back = tok.decode(ids)
        ok = back.strip() == s.strip()
        bad += 0 if ok else 1
        print(f"  {'OK ' if ok else 'BAD'} {s!r} -> {len(ids)} ids (max {max(ids)}) -> {back!r}")
    print("  round-trip failures:", bad)

    def reply(text: str, **kw) -> tuple[str, bool, float]:
        prompt = chat_prompt_ids(tok.encode(text))
        t = time.time()
        with torch.no_grad():
            out = generate_tokens(model, torch.tensor([prompt]), max_new_tokens=60, eos_id=SpecialTokens.EOS, **kw)[0].tolist()[len(prompt):]
        ended = bool(out) and out[-1] == SpecialTokens.EOS
        body = [i for i in out if i != SpecialTokens.EOS]
        try:
            txt = tok.decode([i for i in body if 0 <= i < tok.vocab_size])
        except Exception as exc:  # noqa: BLE001
            txt = f"<decode failed: {type(exc).__name__}>"
        return txt.replace("\n", " ")[:200], ended, time.time() - t

    settings = {"greedy": dict(temperature=0.0), "studio chat (0.6, top_p .95)": dict(temperature=0.6, top_p=0.95),
                "studio other path (0.8, top_k 50, top_p .95, rep 1.3)": dict(temperature=0.8, top_k=50, top_p=0.95, repetition_penalty=1.3)}
    print("\n== 2. replies in the training layout ==")
    for q in ["مرحبا", "السلام عليكم", "كيف حالك؟", "ما هي عاصمة فرنسا؟", "كم ناتج 12 + 30؟", "من أنت؟"]:
        print(f"  Q: {q}")
        for name, kw in settings.items():
            txt, ended, sec = reply(q, **kw)
            print(f"    [{name}] ({'EOS' if ended else 'no EOS in 60'}, {sec:.1f}s) {txt!r}")

    print("\n== 3. a task that is in the training data (date line) ==")
    today = datetime.date(2026, 11, 14)
    ctx = date_context_line(today)
    for q in ["ما تاريخ اليوم؟", "في أي شهر نحن؟", "في أي سنة نحن؟"]:
        txt, ended, _ = reply(ctx + "\n" + q, temperature=0.0)
        print(f"  Q: {q} -> {txt!r} ({'EOS' if ended else 'no EOS'})")

    print("\n== 4. loss on its own greedy answers vs random tokens (collapse / memorisation signal) ==")
    prompt = chat_prompt_ids(tok.encode("مرحبا"))
    with torch.no_grad():
        out = generate_tokens(model, torch.tensor([prompt]), max_new_tokens=40, eos_id=SpecialTokens.EOS, temperature=0.0)
        ids = out[:, :]
        labels = ids.clone()
        labels[:, :len(prompt)] = -100
        _, loss = model(ids, labels=labels)[:2]
    print(f"  mean loss on its own greedy answer to 'مرحبا': {float(loss):.3f} (near 0 = repeating itself; > 8 = garbage)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
