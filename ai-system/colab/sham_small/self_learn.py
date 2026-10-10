"""
Sham — self-learning from live web questions ("التعلّم الذاتي"), rebuilt 2026-10-10 to fit the system.

What the first version did (Grok + the engineer, 2026-10-07) and why it did not fit:
  • it changed the SERVED model in place, one question at a time, and saved a lone `final_chat_self.pt` outside every lineage;
  • nothing checked that the step helped (no held-out measure, no gate), and anyone who could reach the open endpoint could steer it;
  • its training target was a snippet glued to the model's own text.

What it does now — every step is one the rest of Sham already uses:
  1. A web question is answered from the live search results (ask_web_generate: sources in the prompt) — as before.
  2. The turn is RECORDED as an experience (record_experience): the question, the sources, and a target built only from the
     retrieved text. Credential-shaped text never enters (the same filter the crawlers use); the same question is never kept
     twice; a daily cap stops a flood. Nothing touches the served weights.
  3. When enough experiences wait (SHAM_SELF_LEARN_BATCH, default 24) learn_pending trains a COPY: the last transformer layers
     only, small learning rate, on the experiences in Sham's own formats — «ابحث ثم أجب» (query → result → answer) and the
     grounded prompt it was asked with. 10% of the experiences are held out; the copy is kept only if it is better on them
     than the weights it started from.
  4. A kept copy is published like every other collection notebook's output: model → `sham-crawl-selflearn`, the experiences as
     text → `sham-crawl-selflearn-corpus`. Both names are found automatically: the corpus joins the text mixture and the chat
     stage; the model goes through the repair stage and the guarded merge gate (held-out text / chat / media) on the free CPU
     runner before a single weight of it reaches the main line.

On by default (the owner asked for it and wants no manual steps); SHAM_SELF_LEARN=0 turns it off.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import random
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import torch

from model import ShamSmall, SpecialTokens
from sham_chat import IGNORE, build_chat_example, pad_batch
from sham_decoding import SHAM_TURN, USER_TURN, chat_prompt_ids, web_search_text
from text_tokenizer import ShamTextTokenizer

NAME = "selflearn"
_lock = threading.Lock()
_busy = threading.Event()


@dataclass
class SearchHit:
    title: str
    body: str
    href: str = ""


def self_learn_enabled() -> bool:
    return os.environ.get("SHAM_SELF_LEARN", "1").strip().lower() not in ("0", "off", "false", "no", "")


def _dir() -> Path:
    d = Path(os.environ.get("SHAM_SELF_LEARN_DIR", "/kaggle/working/selflearn" if Path("/kaggle/working").exists() else "selflearn_out"))
    (d / "corpus" / "text").mkdir(parents=True, exist_ok=True)
    return d


# ------------------------------------------------------------------ search / generation (unchanged behaviour)
def search_hits(query: str, max_results: int = 4) -> list[SearchHit]:
    """Live web search via ddgs (same stack as sham_decoding / web_access)."""
    hits: list[SearchHit] = []
    try:
        from ddgs import DDGS

        with DDGS() as d:
            raw = list(d.text(query, region="xa-ar", max_results=max_results))
        for h in raw:
            body = (h.get("body") or "").strip()
            title = (h.get("title") or "").strip()
            href = (h.get("href") or "").strip()
            if body or title:
                hits.append(SearchHit(title=title, body=body, href=href))
    except Exception as exc:
        print(f"self_learn.search_hits failed ({type(exc).__name__}); falling back to web_search_text")
        snippet = web_search_text(query, max_results=max_results, max_chars=800)
        if snippet:
            hits.append(SearchHit(title=query, body=snippet, href=""))
    return hits


def format_sources_context(hits: list[SearchHit], max_chars: int = 900) -> str:
    if not hits:
        return ""
    return "\n".join(f"[{i}] {h.title}: {h.body}".strip() for i, h in enumerate(hits, 1))[:max_chars]


def build_grounded_user_prompt(question: str, sources: str) -> str:
    if sources:
        return (f"سؤال المستخدم: {question}\n\n"
                f"مقتطفات من البحث (اعتمد عليها في الإجابة دون اختلاق):\n{sources}\n\n"
                f"أجب بالعربية بإيجاز ووضوح.")
    return question


def ask_web_generate(model: ShamSmall, tokenizer: ShamTextTokenizer, question: str, *, max_new_tokens: int = 60,
                     use_chat_wrap: bool = True) -> tuple[str, list[SearchHit], str]:
    """Search → build context → generate. Returns (answer, hits, sources_text)."""
    from generate import generate_tokens

    hits = search_hits(question)
    sources = format_sources_context(hits)
    prompt_ids = tokenizer.encode(build_grounded_user_prompt(question, sources))
    if use_chat_wrap:
        try:
            wrapped = chat_prompt_ids(prompt_ids[-384:])
        except Exception:
            wrapped = [SpecialTokens.BOS] + prompt_ids[-384:]
    else:
        wrapped = [SpecialTokens.BOS] + prompt_ids[-384:]
    ids = torch.tensor([wrapped], dtype=torch.long)
    out = generate_tokens(model, ids, max_new_tokens=max_new_tokens, temperature=0.6, top_k=40, top_p=0.9,
                          eos_id=SpecialTokens.EOS, allowed_ranges=[(0, tokenizer.vocab_size)] * max_new_tokens)
    gen_ids = [i for i in out[0, ids.shape[1]:].tolist() if i != SpecialTokens.EOS and i < tokenizer.vocab_size]
    return tokenizer.decode(gen_ids), hits, sources


# --------------------------------------------------------------------------- experiences
def grounded_target_answer(question: str, hits: list[SearchHit]) -> str:
    """The target is built ONLY from retrieved text (never from the model's own words): the opening sentences of the best
    source, the same extractive rule `sham_chat.build_search_example` uses on Wikipedia."""
    for h in hits:
        body = re.sub(r"\s+", " ", h.body or "").strip()
        if len(body) < 40:
            continue
        sentences = re.split(r"(?<=[.!؟?۔])\s+", body)
        out = " ".join(sentences[:2]).strip()
        if len(out) < 30:
            out = body[:240]
        return out[:360]
    return ""


def _norm(q: str) -> str:
    return re.sub(r"[\W_]+", " ", q.lower()).strip()


def _queue_path() -> Path:
    return _dir() / "queue.jsonl"


def _read_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    rows = []
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except Exception:
            continue
    return rows


def pending() -> int:
    return len(_read_jsonl(_queue_path()))


def record_experience(question: str, hits: list[SearchHit], sources: str) -> dict:
    """Keep one grounded turn for learning. Never changes weights. Returns {"queued": bool, "reason"?, "pending": n}."""
    if not self_learn_enabled():
        return {"queued": False, "reason": "التعلّم الذاتي مغلق (SHAM_SELF_LEARN=0)", "pending": pending()}
    q = (question or "").strip()
    if len(q) < 4 or len(q) > 300:
        return {"queued": False, "reason": "سؤال قصير جداً أو طويل جداً", "pending": pending()}
    target = grounded_target_answer(q, hits)
    if not target:
        return {"queued": False, "reason": "لا نص مسترجع صالح — لا تعلّم من دورة بلا مصدر", "pending": pending()}
    try:
        from autonomous_knowledge_crawler import contains_credential_risk
        if contains_credential_risk(q) or contains_credential_risk(sources) or contains_credential_risk(target):
            return {"queued": False, "reason": "نص يشبه كلمة مرور/مفتاح — لا يدخل التعلّم", "pending": pending()}
    except Exception:
        pass
    key = hashlib.sha1(_norm(q).encode("utf-8")).hexdigest()[:16]
    with _lock:
        d = _dir()
        seen_p = d / "seen.json"
        seen = set(json.loads(seen_p.read_text(encoding="utf-8"))) if seen_p.exists() else set()
        if key in seen:
            return {"queued": False, "reason": "السؤال نفسه سُجّل من قبل", "pending": pending()}
        today = time.strftime("%Y-%m-%d")
        counts_p = d / "daily.json"
        counts = json.loads(counts_p.read_text(encoding="utf-8")) if counts_p.exists() else {}
        if counts.get(today, 0) >= int(os.environ.get("SHAM_SELF_LEARN_DAILY_MAX", "300")):
            return {"queued": False, "reason": "بلغ سقف تجارب اليوم", "pending": pending()}
        entry = {"key": key, "q": q, "query": q[:120], "result": sources[:700], "target": target, "ts": time.time()}
        with _queue_path().open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        (d / "corpus" / "text" / f"selflearn_{key}.txt").write_text(
            f"{q}\n{target}\n(من نتائج البحث: {sources[:400]})", encoding="utf-8")
        seen.add(key)
        seen_p.write_text(json.dumps(sorted(seen)), encoding="utf-8")
        counts[today] = counts.get(today, 0) + 1
        counts_p.write_text(json.dumps(counts), encoding="utf-8")
    return {"queued": True, "pending": pending()}


# ----------------------------------------------------------------------------- learning
def build_examples(encode, entries: list[dict]) -> tuple[list, list]:
    """(training examples, held-out examples) in Sham's own formats; each experience gives:
       «ابحث ثم أجب»: <USER> q <SHAM> <SEARCH> query </SEARCH> <RESULT> text </RESULT> answer   (result not trained on)
       grounded chat: <USER> prompt-with-sources <SHAM> answer                                  (what the web route asks)"""
    train, held = [], []
    for i, e in enumerate(entries):
        q, ans = encode(e["q"]), encode(e["target"])[:96]
        prefix = [SpecialTokens.BOS, USER_TURN] + q[:160] + [SHAM_TURN]
        call = [SpecialTokens.SEARCH_START] + encode(e["query"])[:48] + [SpecialTokens.SEARCH_END]
        back = [SpecialTokens.RESULT_START] + encode(e["result"])[:160] + [SpecialTokens.RESULT_END]
        search_ex = (prefix + call + back + ans + [SpecialTokens.EOS],
                     [IGNORE] * len(prefix) + call + [IGNORE] * len(back) + ans + [SpecialTokens.EOS])
        grounded_ex = build_chat_example(encode(build_grounded_user_prompt(e["q"], e["result"])), ans, max_len=384, max_user=300)
        (held if i % 10 == 9 else train).append((search_ex, grounded_ex))
    flat = lambda pairs: [x for p in pairs for x in p]
    return flat(train), flat(held)


@torch.no_grad()
def _loss(model, examples, device) -> float:
    model.train(False)
    total, n = 0.0, 0
    for i in range(0, len(examples), 4):
        ids, labels = pad_batch(examples[i:i + 4])
        total += float(model(ids.to(device), labels=labels.to(device))[1])
        n += 1
    return total / max(n, 1)


def _freeze_all_but_top(model: ShamSmall, n_layers: int) -> int:
    for p in model.parameters():
        p.requires_grad = False
    top = list(model.layers)[-max(1, n_layers):]
    count = 0
    for mod in top + [model.final_norm]:       # the embedding (tied with the output head) is NEVER unfrozen: it would drift every token
        for p in mod.parameters():
            p.requires_grad = True
            count += p.numel()
    return count


def learn_pending(model: ShamSmall, tokenizer: ShamTextTokenizer, device: str = "cpu", *, current_step: int = 0,
                  min_batch: int | None = None, epochs: int | None = None, lr: float | None = None,
                  publisher=None) -> dict:
    """Train a COPY on the waiting experiences; keep it only if it is better on the held-out ones. `model` is never changed."""
    min_batch = int(min_batch if min_batch is not None else os.environ.get("SHAM_SELF_LEARN_BATCH", "24"))
    epochs = int(epochs if epochs is not None else os.environ.get("SHAM_SELF_LEARN_EPOCHS", "2"))
    lr = float(lr if lr is not None else os.environ.get("SHAM_SELF_LEARN_LR", "1e-5"))
    n_top = int(os.environ.get("SHAM_SELF_LEARN_TOP_LAYERS", "4"))
    with _lock:
        entries = _read_jsonl(_queue_path())
    if len(entries) < min_batch:
        return {"learned": False, "reason": f"بانتظار الدفعة: {len(entries)}/{min_batch}"}
    from train import build_optimizer

    rng = random.Random(len(entries))
    rng.shuffle(entries)
    train_ex, held_ex = build_examples(tokenizer.encode, entries)
    if not train_ex or not held_ex:
        return {"learned": False, "reason": "لا أمثلة كافية بعد التقسيم"}
    cand = copy.deepcopy(model).to(device)
    trainable = _freeze_all_but_top(cand, n_top)
    before = _loss(cand, held_ex, device)
    opt = build_optimizer(cand, lr=lr, weight_decay=0.01)
    cand.train()
    steps = 0
    for _ in range(epochs):
        rng.shuffle(train_ex)
        for i in range(0, len(train_ex), 4):
            ids, labels = pad_batch(train_ex[i:i + 4])
            loss = cand(ids.to(device), labels=labels.to(device))[1]
            if not torch.isfinite(loss):
                return {"learned": False, "reason": "خسارة غير صالحة — أُلغيت الدفعة"}
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_([p for p in cand.parameters() if p.requires_grad], 1.0)
            opt.step()
            steps += 1
    after = _loss(cand, held_ex, device)
    result = {"before": round(before, 4), "after": round(after, 4), "steps": steps, "experiences": len(entries),
              "trainable_params": trainable}
    if not (after < before):
        return {**result, "learned": False, "reason": "النسخة المتعلّمة ليست أفضل على التجارب المحجوبة — رُفضت (النموذج المخدوم لم يتغيّر)"}
    from checkpoint import save_checkpoint
    d = _dir()
    new_step = int(current_step) + steps
    for p in cand.parameters():
        p.requires_grad = False
    save_checkpoint(d / "final.pt", cand, step=new_step, optimizer=None, extra={"self_learn": True, "text_tokenizer": "general-v1"})
    tokenizer.save(str(d / "sham_small_tokenizer.json"))
    published = None
    try:
        if publisher is None:
            import sham_crawl_publish
            publisher = lambda: sham_crawl_publish.publish(d / "final.pt", d / "corpus", name=NAME,
                                                            message=f"self-learn: {len(entries)} web experiences, held-out {before:.3f}→{after:.3f}")
        published = publisher()
    except Exception as exc:     # no credentials / offline: the candidate stays on disk and is published by the next run
        result["publish_error"] = f"{type(exc).__name__}: {str(exc)[:120]}"
    with _lock:
        done = d / "done.jsonl"
        with done.open("a", encoding="utf-8") as f:
            for e in entries:
                f.write(json.dumps(e, ensure_ascii=False) + "\n")
        _queue_path().write_text("", encoding="utf-8")
    return {**result, "learned": True, "step": new_step, "published": published}


def learn_in_background(state: dict, device: str = "cpu") -> bool:
    """Start learn_pending on a CPU COPY of the served model when a batch is waiting. At most one at a time; never blocks serving."""
    if not self_learn_enabled() or _busy.is_set():
        return False
    if pending() < int(os.environ.get("SHAM_SELF_LEARN_BATCH", "24")):
        return False
    _busy.set()
    snapshot = copy.deepcopy(state["model"]).to("cpu")
    tokenizer, step = state["text_tokenizer"], int(state.get("train_step") or 0)

    def run():
        try:
            out = learn_pending(snapshot, tokenizer, device, current_step=step)
            state["last_self_learn"] = out
            print(f"🧬 التعلّم الذاتي: {out}")
        except Exception as exc:
            state["last_self_learn"] = {"learned": False, "reason": f"{type(exc).__name__}: {str(exc)[:120]}"}
        finally:
            _busy.clear()

    threading.Thread(target=run, daemon=True).start()
    return True


if __name__ == "__main__":
    import tempfile

    from checkpoint import load_checkpoint
    from model import ShamSmallConfig, TOTAL_VOCAB_SIZE
    from text_tokenizer import train_text_tokenizer

    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=TOTAL_VOCAB_SIZE, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=512)
    model = ShamSmall(cfg)
    with tempfile.TemporaryDirectory() as td:
        os.environ["SHAM_SELF_LEARN_DIR"] = str(Path(td) / "sl")
        os.environ["SHAM_SELF_LEARN_BATCH"] = "10"
        os.environ["SHAM_SELF_LEARN_LR"] = "3e-3"
        os.environ["SHAM_SELF_LEARN_EPOCHS"] = "3"
        corpus = Path(td) / "c.txt"
        corpus.write_text("سؤال جواب مصدر نتائج البحث مقتطفات تعلّم شام الذكاء الاصطناعي. " * 120, encoding="utf-8")
        tok = train_text_tokenizer([str(corpus)], vocab_size=800)

        hit = lambda i: [SearchHit(f"عنوان {i}", f"هذا نص مسترجع رقم {i} عن الموضوع. ويتابع الجملة الثانية عن الموضوع نفسه.", "https://x.test")]
        # 1) a turn without a retrieved text, a credential-shaped one, a repeat and a too-short question are all refused
        assert not record_experience("ما هو شام؟", [], "")["queued"]
        assert not record_experience("ما هو المفتاح؟", hit(0), "api_key = abcdefghijklmnop1234567890")["queued"]
        r = record_experience("ما هي عاصمة فرنسا الآن؟", hit(1), format_sources_context(hit(1)))
        assert r["queued"] and r["pending"] == 1, r
        assert not record_experience("ما هي عاصمة فرنسا الآن؟", hit(1), "x")["queued"], "the same question twice"
        assert not record_experience("؟", hit(1), "x")["queued"]
        # 2) not enough yet → no learning, and nothing changes
        before_w = {k: v.clone() for k, v in model.state_dict().items()}
        out = learn_pending(model, tok, "cpu", current_step=100)
        assert not out["learned"] and "بانتظار" in out["reason"], out
        for i in range(2, 16):
            record_experience(f"ما هو الموضوع رقم {i} في هذا الاختبار؟", hit(i), format_sources_context(hit(i)))
        assert pending() == 15, pending()
        # 3) a full batch: a copy learns, the served model is untouched, a kept copy is saved and published
        pubs = []
        out = learn_pending(model, tok, "cpu", current_step=100, publisher=lambda: pubs.append("published") or "sham-crawl-selflearn")
        assert all(torch.equal(v, model.state_dict()[k]) for k, v in before_w.items()), "the served model must never change"
        assert out["learned"] and out["after"] < out["before"] and out["published"] == "sham-crawl-selflearn" and pubs, out
        m2, step2, extra = load_checkpoint(Path(td) / "sl" / "final.pt")
        assert step2 == out["step"] > 100 and extra.get("self_learn")
        assert pending() == 0 and (Path(td) / "sl" / "done.jsonl").exists()
        assert list((Path(td) / "sl" / "corpus" / "text").glob("selflearn_*.txt")), "the experiences must also be published as text"
        # 4) a copy that is NOT better is rejected
        for i in range(30, 42):
            record_experience(f"سؤال آخر مختلف رقم {i} للفحص؟", hit(i), format_sources_context(hit(i)))
        os.environ["SHAM_SELF_LEARN_LR"] = "0.0"
        out = learn_pending(model, tok, "cpu", current_step=100, publisher=lambda: "x")
        assert not out["learned"] and "ليست أفضل" in out["reason"], out
        assert pending() == 12, "a rejected batch stays waiting"
        # 5) off switch
        os.environ["SHAM_SELF_LEARN"] = "0"
        assert not self_learn_enabled() and not record_experience("سؤال جديد تماماً هنا؟", hit(99), "x")["queued"]
        print("self_learn self-test passed")
