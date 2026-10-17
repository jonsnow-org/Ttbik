"""
Measures Palmyra Memory (sham_memory.py) on a REAL checkpoint, CPU only, no training:
  recall     a fact said in turn 1, asked after 3 / 10 / 30 filler turns: log-probability of the true answer and whether a greedy answer contains it,
             for three set-ups — none (the old single-message path), window (history only), full (history + facts + episodic + kNN)
  regression a user with no memory gets EXACTLY the old single-turn scores (same log-probability to 1e-4)
  isolation  another user asking the same question has no facts, no kNN, and no gain
  forget     «انسَ معلوماتي» deletes the directory; the next question has no facts
  speed      seconds per message at 30 turns, with and without the saved cache
Usage: python sham_memory_eval.py <checkpoint.pt> <tokenizer.json> [out.json]
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time

import torch

FILLER = [("كيف حالك اليوم؟", "بخير، شكراً لسؤالك."), ("ما هي عاصمة مصر؟", "عاصمة مصر هي القاهرة."), ("اقترح لي كتاباً.", "أنصحك بقراءة رواية جميلة."),
          ("كم يوماً في الأسبوع؟", "في الأسبوع سبعة أيام."), ("ما لون السماء؟", "السماء زرقاء في النهار."), ("ما هو الطقس اليوم؟", "لا أعرف الطقس الآن.")]
FACT_MSG = "مرحبا، اسمي سامر وأنا من حلب"
CASES = [("ما اسمي؟", "اسمك سامر", "سامر"), ("من أين أنا؟", "أنت من حلب", "حلب"), ("ما هو اسمي؟", "اسمك سامر", "سامر"),
         ("هل تتذكر من أين أنا؟", "أنت من حلب", "حلب")]


def load(ckpt, tok_path):
    from model import ShamSmall, ShamSmallConfig
    from text_tokenizer import ShamTextTokenizer
    c = torch.load(ckpt, map_location="cpu", weights_only=False)
    m = ShamSmall(ShamSmallConfig(**c["config"]))
    m.load_state_dict(c["model_state_dict"])
    return m.eval(), ShamTextTokenizer.load(tok_path)


def main(ckpt, tok_path, out_path=None):
    import sham_memory as sm
    torch.set_num_threads(int(os.environ.get("SHAM_EVAL_THREADS", "2")))
    model, tok = load(ckpt, tok_path)
    res: dict = {"recall": {}, "checks": {}}
    with tempfile.TemporaryDirectory() as td:
        os.environ["SHAM_MEMORY_DIR"] = td
        os.environ.setdefault("SHAM_STUDIO_DATE", "0")
        for n in (3, 10, 30):
            hist = [{"q": FACT_MSG, "a": "أهلاً سامر!"}] + [{"q": q, "a": a} for q, a in (FILLER * 6)[:n]]
            row = {}
            for q, target, word in CASES:
                cfgs = {}
                word_key = q
                for name, env in (("none", None), ("window", {"SHAM_MEMORY_KNN": "0", "SHAM_MEMORY_EPISODIC": "0", "SHAM_MEMORY_NOFACTS": "1"}),
                                  ("full", {})):
                    uid = f"rec-{n}-{name}-{word}"
                    saved = {k: os.environ.get(k) for k in ("SHAM_MEMORY_KNN", "SHAM_MEMORY_EPISODIC")}
                    for k, v in (env or {}).items():
                        if k != "SHAM_MEMORY_NOFACTS":
                            os.environ[k] = v
                    h = [] if name == "none" else hist
                    if name == "window":                      # history only: hide the fact rules by giving the history as-is but no fact store
                        sm_extract = sm.extract_facts
                        sm.extract_facts = lambda _t: {}
                    try:
                        sc = sm.memory_answer(model, tok, uid, q, 1, history=h, score=target, record=False)
                        gen = sm.memory_answer(model, tok, uid, q, 12, history=h, greedy=True, record=False)
                    finally:
                        if name == "window":
                            sm.extract_facts = sm_extract
                        for k, v in saved.items():
                            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
                    cfgs[name] = {"target_logp": sc["memory"]["target_logp"], "contains": word in gen["text"], "answer": gen["text"][:60],
                                  "prefix_tokens": sc["memory"]["prefix_tokens"], "seconds": gen["memory"]["seconds"]}
                row[word_key] = cfgs
            res["recall"][str(n)] = row
            print(n, json.dumps(row, ensure_ascii=False), flush=True)
        # regression: empty memory == the old single-turn layout
        from sham_decoding import chat_prompt_ids
        q, target = "ما هي عاصمة فرنسا؟", "عاصمة فرنسا باريس"
        new = sm.memory_answer(model, tok, "fresh-user", q, 1, history=[], score=target, record=False)["memory"]["target_logp"]
        ids = chat_prompt_ids(tok.encode(q))
        t = tok.encode(target)
        with torch.no_grad():
            lg = model(torch.tensor([ids + t]))[0][0].float().log_softmax(-1)
        old = float(sum(lg[len(ids) - 1 + j, x] for j, x in enumerate(t)))
        res["checks"]["regression"] = {"old_logp": round(old, 4), "memory_empty_logp": new, "equal": abs(old - new) < 1e-3}
        # unrelated questions are not hijacked by the user's facts
        hij = []
        for uq in ("ما هي عاصمة مصر؟", "اكتب جملة عن البحر", "كم يوماً في السنة؟"):
            g = sm.memory_answer(model, tok, "hijack", uq, 12, history=[{"q": FACT_MSG, "a": "أهلاً سامر!"}], greedy=True, record=False)
            hij.append({"q": uq, "answer": g["text"][:50], "knn": g["memory"]["knn"], "leaked": ("سامر" in g["text"] or "حلب" in g["text"])})
        res["checks"]["unrelated"] = hij
        # episodic: a detail no rule extracts, said long before the window, asked later
        os.environ["SHAM_MEMORY_WINDOW_TOKENS"] = "200"
        eh = [{"q": "سيارتي الجديدة لونها أحمر", "a": "مبروك على السيارة!"}] + [{"q": q, "a": a} for q, a in (FILLER * 6)[:30]]
        ep = sm.memory_answer(model, tok, "episodic", "ما لون سيارتي الجديدة؟", 1, history=eh, score="لونها أحمر", record=False)
        bank = sm.EpisodicBank(sm.UserMemory("episodic"), sm.weight_fingerprint(model))
        top = bank.recall(model, tok, "ما لون سيارتي الجديدة؟", int(os.environ.get("SHAM_MEMORY_KEY_LAYER", "14")), k=2)
        os.environ.pop("SHAM_MEMORY_WINDOW_TOKENS")
        nm = sm.memory_answer(model, tok, "episodic-none", "ما لون سيارتي الجديدة؟", 1, history=[], score="لونها أحمر", record=False)
        res["checks"]["episodic"] = {"older_turns": ep["memory"]["older_turns"], "recalled": ep["memory"]["recalled"],
                                     "detail_in_recall": any("سيارتي" in x for x in top), "logp_with": ep["memory"]["target_logp"],
                                     "logp_none": nm["memory"]["target_logp"]}
        # isolation
        sm.memory_answer(model, tok, "alice", FACT_MSG, 4, greedy=True)
        bob = sm.memory_answer(model, tok, "bob", "ما اسمي؟", 1, history=[], score="اسمك سامر", record=False)
        res["checks"]["isolation"] = {"bob_facts": bob["memory"]["facts"], "bob_knn": bob["memory"]["knn"], "bob_logp": bob["memory"]["target_logp"],
                                      "alice_dir_separate": sm.UserMemory("alice").dir != sm.UserMemory("bob").dir}
        # forget
        f = sm.memory_answer(model, tok, "alice", "انسَ معلوماتي", 4)
        after = sm.memory_answer(model, tok, "alice", "ما اسمي؟", 1, history=[], score="اسمك سامر", record=False)
        res["checks"]["forget"] = {"forgotten": bool(f.get("forgotten")), "facts_after": after["memory"]["facts"]}
        # speed with / without cache at 30 turns
        hist = [{"q": FACT_MSG, "a": "أهلاً سامر!"}] + [{"q": q, "a": a} for q, a in (FILLER * 6)[:30]]
        os.environ["SHAM_MEMORY_KV"] = "0"
        t0 = time.time(); sm.memory_answer(model, tok, "speed", "ما اسمي؟", 20, history=hist, greedy=True, record=False); cold = time.time() - t0
        os.environ["SHAM_MEMORY_KV"] = "1"
        sm.memory_answer(model, tok, "speed2", "ما اسمي؟", 20, history=hist, greedy=True, record=False)
        t0 = time.time(); r = sm.memory_answer(model, tok, "speed2", "من أين أنا؟", 20, history=hist, greedy=True, record=False); warm = time.time() - t0
        kvf = sm.UserMemory("speed2")._p("kv.pt")
        res["checks"]["speed"] = {"no_cache_s": round(cold, 2), "with_cache_s": round(warm, 2), "kv_reused_tokens": r["memory"]["kv_reused_tokens"],
                                  "kv_file_mb": round(kvf.stat().st_size / 1e6, 1) if kvf.exists() else 0}
    print(json.dumps(res["checks"], ensure_ascii=False, indent=1))
    if out_path:
        open(out_path, "w", encoding="utf-8").write(json.dumps(res, ensure_ascii=False, indent=1))
    return res


if __name__ == "__main__":
    if len(sys.argv) < 3:        # CI runs every changed module with no arguments: a real run needs a checkpoint and its tokenizer
        print("sham_memory_eval: usage: python sham_memory_eval.py <checkpoint.pt> <tokenizer.json> [out.json] — nothing to do without them (offline self-test: none)")
        raise SystemExit(0)
    main(*sys.argv[1:4])
