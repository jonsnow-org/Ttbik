"""
Palmyra Memory (ذاكرة تدمر, 2026-10-14) — per-user memory for Sham WITHOUT a training loop. Additive: nothing here edits model.py, generate.py or
a checkpoint; every existing endpoint answers exactly as before. Only the new Studio entry chat_memory (app.py) and the bot's memory path use it.

Three layers, all training-free, all per user (a directory per hashed user id under SHAM_MEMORY_DIR):

  1. SessionKV    the attention cache (past_key_values) of the stable part of the conversation is saved to disk (fp16) and reloaded on the next
                  message, so the model does not re-read the conversation. Every file carries a WEIGHT FINGERPRINT: after a self-learn merge (new
                  weights) an old cache is never used — it is rebuilt from the text.
  2. EpisodicBank turns that slid out of the window go into the engineer's TokenBank (sham_longctx.py) with a key = mean hidden state at a middle
                  layer; the 2 most similar old turns come back into the context for a new question.
  3. FactKNN      user facts (name, city, age, work, likes — Arabic rules, no model needed) go in the context as one line AND into a tiny kNN-LM
                  datastore (hidden state -> next token, Khandelwal et al. 2020): at answer time the model's distribution is mixed with the
                  nearest stored states, only when they are really near (cosine threshold).

Later-stage, OFF by default:
  write_fact_candidate   ROME/MEMIT-style closed-form rank-1 write of a GENERAL fact into one MLP — on a COPY, saved as a candidate for the
                         engineer's gate (sham_guard); the served weights never change here. SHAM_MEMORY_FACT_WRITE=1 to allow.
  StyleVector            a per-user steering vector added at one layer (activation steering). SHAM_MEMORY_STYLE=1 to allow.

"forget my info" (انسَ معلوماتي / امسح ذاكرتي / ...) deletes the user's whole directory.

Environment: SHAM_MEMORY=0 switches everything off (chat_memory then answers like chat_auto); SHAM_MEMORY_DIR (default /tmp/sham_memory);
SHAM_MEMORY_WINDOW_TOKENS (900); SHAM_MEMORY_KV / SHAM_MEMORY_EPISODIC / SHAM_MEMORY_KNN (1); SHAM_MEMORY_KNN_LAMBDA (0.5);
SHAM_MEMORY_KNN_MIN_SIM (0.7); SHAM_MEMORY_KEY_LAYER (14); SHAM_MEMORY_TTL_HOURS (24, cache files only; text memory stays until forgotten).
Self-test: python sham_memory.py (tiny random model; the real checkpoint is measured by sham_memory_eval.py).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import time
from pathlib import Path

import numpy as np
import torch

# ---------------------------------------------------------------- settings


def _flag(name: str, default: str = "1") -> bool:
    return os.environ.get(name, default).strip().lower() not in ("0", "off", "false", "no", "")


def _num(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


def memory_enabled() -> bool:
    return _flag("SHAM_MEMORY", "1")


def memory_root() -> Path:
    return Path(os.environ.get("SHAM_MEMORY_DIR", "/tmp/sham_memory"))


def user_key(user_id: str) -> str:
    """Never the raw chat id on disk: a salted hash (SHAM_MEMORY_SALT)."""
    salt = os.environ.get("SHAM_MEMORY_SALT", "sham-palmyra")
    return hashlib.sha256((salt + "|" + str(user_id)).encode("utf-8")).hexdigest()[:32]


def weight_fingerprint(model) -> str:
    """Cheap identity of the weights now loaded: config + slices of the first, middle and last layers (self-learn changes the TOP layers)."""
    h = hashlib.sha1(json.dumps(vars(model.cfg), sort_keys=True, default=str).encode())
    n = len(model.layers)
    with torch.no_grad():
        for t in (model.token_embedding.weight[:8], model.layers[0].attention.q_proj.weight[:8], model.layers[n // 2].mlp.down_proj.weight[:8],
                  model.layers[-1].mlp.down_proj.weight[:8], model.layers[-1].attention.o_proj.weight[:8], model.final_norm.weight):
            h.update(t.detach().float().cpu().numpy().tobytes())
    return h.hexdigest()[:20]


# ---------------------------------------------------------------- facts (Arabic rules, no model)

_W = r"([^\s،,.!؟?\n]+)"
FACT_RULES = [
    ("name", re.compile(r"(?:^|\s)و?(?:انا |أنا )?اسمي\s+" + _W), "ما اسمي؟", "اسمك {v}", "الاسم"),
    ("name", re.compile(r"(?i)my name is\s+" + _W), "ما اسمي؟", "اسمك {v}", "الاسم"),
    ("city", re.compile(r"(?:^|\s)و?(?:انا من|أنا من|ساكن في|ساكنة في|أسكن في|اسكن في|أعيش في|اعيش في)\s+" + _W), "من أين أنا؟", "أنت من {v}", "المدينة"),
    ("age", re.compile(r"(?:^|\s)و?عمري\s+(\d{1,3})"), "كم عمري؟", "عمرك {v} سنة", "العمر"),
    ("job", re.compile(r"(?:^|\s)و?(?:أعمل|اعمل|أشتغل|اشتغل)\s+([^،,.!؟?\n]{2,40})"), "ما عملي؟", "تعمل {v}", "العمل"),
    ("likes", re.compile(r"(?:^|\s)و?(?:أحب|احب|بحب)\s+([^،,.!؟?\n]{2,40})"), "ماذا أحب؟", "تحب {v}", "يحب"),
]
_FACT_META = {k: (q, a, label) for k, _r, q, a, label in FACT_RULES}


# a fact's kNN entries are used only when the question is ABOUT that fact (measured on the real checkpoint: hidden states right after <SHAM> are
# similar for most questions, so a similarity gate alone let «ما هي عاصمة مصر؟» be answered with the user's city)
FACT_TRIGGERS = {"name": ("اسم", "name"), "city": ("من اين", "منين", "وين ساكن", "مدينت", "بلد", "ساكن", "اسكن", "where"),
                 "age": ("عمر", "كم سنه", "age"), "job": ("عمل", "شغل", "وظيف", "مهنت", "job"), "likes": ("احب", "بحب", "هواي", "like")}


def facts_asked(text: str) -> set[str]:
    t = _norm(text)
    return {k for k, words in FACT_TRIGGERS.items() if any(_norm(w) in t for w in words)}


def extract_facts(text: str) -> dict:
    """{"name": "سامر", "city": "حلب", ...} from one user message. Questions ("ما اسمي؟") are not statements and give nothing."""
    out: dict = {}
    t = " " + (text or "").strip()
    if re.search(r"[؟?]", t) or re.match(r"\s*(هل|ما|ماذا|لماذا|كيف|متى|اين|أين|من|كم)\s", t):      # 2026-10-17: a question states nothing
        return out
    for key, rx, *_ in FACT_RULES:
        m = rx.search(t)
        if m and key not in out:
            v = m.group(1).strip()
            if not v or v in ("؟", "?") or v.startswith(("ما", "شو", "ايش", "إيش")):
                continue
            if key in ("job", "likes") and (len(v.split()) > 4 or v.startswith(("أن", "ان ", "لا", "اسأل", "أسأل", "كثيرا", "جدا"))):
                continue                                                  # a job / a like is a short phrase, not the rest of a sentence
            out[key] = v
    return out


def facts_line(facts: dict) -> str:
    parts = [f"{_FACT_META[k][2]}: {v}" for k, v in facts.items() if k in _FACT_META and v]
    return ("معلومات عن المستخدم — " + "؛ ".join(parts)) if parts else ""


_AR_NORM = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه"})


def _norm(s: str) -> str:
    return re.sub(r"[\u064B-\u0652]", "", (s or "").strip().lower()).translate(_AR_NORM)


# ---------------------------------------------------------------- per-user store


class UserMemory:
    """One user's directory: turns.jsonl (text), facts.json, kv.pt (SessionKV), bank.npz + bank.json (EpisodicBank), knn.npz (FactKNN)."""

    def __init__(self, user_id: str, root: Path | None = None):
        self.key = user_key(user_id)
        self.dir = (root or memory_root()) / self.key

    def _p(self, name: str) -> Path:
        return self.dir / name

    def exists(self) -> bool:
        return self.dir.exists()

    def forget(self) -> bool:
        existed = self.dir.exists()
        shutil.rmtree(self.dir, ignore_errors=True)
        return existed

    # turns
    def turns(self) -> list[dict]:
        p = self._p("turns.jsonl")
        if not p.exists():
            return []
        out = []
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                out.append(json.loads(line))
            except Exception:
                continue
        return out

    def add_turn(self, q: str, a: str) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        with self._p("turns.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"q": q, "a": a, "t": int(time.time())}, ensure_ascii=False) + "\n")

    # facts
    def facts(self) -> dict:
        p = self._p("facts.json")
        try:
            return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
        except Exception:
            return {}

    def update_facts(self, new: dict) -> bool:
        cur = self.facts()
        merged = {**cur, **{k: v for k, v in (new or {}).items() if v}}
        if merged == cur:
            return False
        self.dir.mkdir(parents=True, exist_ok=True)
        self._p("facts.json").write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
        for f in self.dir.glob("knn*.npz"):                           # the kNN datastores are rebuilt from the facts
            f.unlink(missing_ok=True)
        return True


# ---------------------------------------------------------------- model helpers


def hidden_at(model, ids: list[int], layer: int) -> torch.Tensor:
    """Residual stream after `layer` blocks for ids (no cache): (T, d). Only the first `layer` blocks run — cheap keys for the bank."""
    with torch.no_grad():
        x = model.token_embedding(torch.tensor([ids], dtype=torch.long))
        cos, sin = model.rope_cos, model.rope_sin
        for blk in model.layers[:max(1, min(layer, len(model.layers)))]:
            x, _ = blk(x, cos, sin)
    return x[0].float()


def mean_key(model, ids: list[int], layer: int) -> torch.Tensor:
    h = hidden_at(model, ids, layer).mean(0)
    return h / h.norm().clamp_min(1e-8)


class _FinalHidden:
    """Captures final_norm's output (the state lm_head reads) during a forward."""

    def __init__(self, model):
        self.last = None
        self.h = model.final_norm.register_forward_hook(lambda _m, _i, out: setattr(self, "last", out.detach()))

    def close(self):
        self.h.remove()


# ---------------------------------------------------------------- 1. SessionKV


class SessionKV:
    @staticmethod
    def load(mem: UserMemory, fingerprint: str):
        """(prefix ids, past_key_values) or (None, None) when absent, stale (other weights) or expired."""
        p = mem._p("kv.pt")
        if not _flag("SHAM_MEMORY_KV") or not p.exists():
            return None, None
        if time.time() - p.stat().st_mtime > _num("SHAM_MEMORY_TTL_HOURS", 24) * 3600:
            p.unlink(missing_ok=True)
            return None, None
        try:
            d = torch.load(p, map_location="cpu", weights_only=True)
        except Exception:
            p.unlink(missing_ok=True)
            return None, None
        if d.get("fp") != fingerprint:
            p.unlink(missing_ok=True)                                # new weights: an old cache would answer from a model that no longer exists
            return None, None
        return list(d["ids"]), [(k.float(), v.float()) for k, v in d["kv"]]

    @staticmethod
    def save(mem: UserMemory, fingerprint: str, ids: list[int], past) -> None:
        if not _flag("SHAM_MEMORY_KV"):
            return
        mem.dir.mkdir(parents=True, exist_ok=True)
        n = len(ids)
        kv = [(k[:, :, :n].half().contiguous(), v[:, :, :n].half().contiguous()) for k, v in past]
        tmp = mem._p("kv.pt.tmp")
        torch.save({"fp": fingerprint, "ids": torch.tensor(ids, dtype=torch.long), "kv": kv}, tmp)
        tmp.replace(mem._p("kv.pt"))


def common_prefix(a: list[int], b: list[int]) -> int:
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


# ---------------------------------------------------------------- 2. EpisodicBank (over the engineer's TokenBank)


class EpisodicBank:
    def __init__(self, mem: UserMemory, fingerprint: str):
        from sham_longctx import TokenBank
        self.mem, self.fp = mem, fingerprint
        self.bank, self.texts = TokenBank(), []
        meta = mem._p("bank.json")
        if meta.exists() and mem._p("bank.npz").exists():
            try:
                d = json.loads(meta.read_text(encoding="utf-8"))
                if d.get("fp") == fingerprint:                       # keys come from the weights: other weights -> rebuild from text
                    self.bank, self.texts = TokenBank.load(mem._p("bank.npz")), d["texts"]
            except Exception:
                self.bank, self.texts = TokenBank(), []

    def sync(self, model, tokenizer, old_turns: list[dict], layer: int) -> int:
        """Make the bank hold exactly the turns that left the window (append-only; rebuilt if the weights changed). Returns turns added."""
        added = 0
        for t in old_turns[len(self.texts):]:
            text = f"{t['q']} — {t['a']}"
            ids = tokenizer.encode(text)[:96]
            if not ids:
                ids = [3]
            self.bank.add(ids, mean_key(model, ids, layer))
            self.texts.append(text)
            added += 1
        if added:
            self.mem.dir.mkdir(parents=True, exist_ok=True)
            self.bank.save(self.mem._p("bank.npz"))
            self.mem._p("bank.json").write_text(json.dumps({"fp": self.fp, "texts": self.texts}, ensure_ascii=False), encoding="utf-8")
        return added

    def recall(self, model, tokenizer, query: str, layer: int, k: int = 2, min_sim: float = 0.5) -> list[str]:
        if not len(self.bank) or not query.strip():
            return []
        q = mean_key(model, tokenizer.encode(query)[:96] or [3], layer)
        sims = np.stack(self.bank.keys) @ q.numpy()
        order = [int(i) for i in np.argsort(-sims)[:k] if sims[i] >= min_sim]
        return [self.texts[i] for i in order]


# ---------------------------------------------------------------- 3. FactKNN (kNN-LM over the user's facts)


class FactKNN:
    def __init__(self, keys: torch.Tensor, values: torch.Tensor):
        self.keys, self.values = keys, values                         # (N, d) normalised, (N,)

    def __len__(self) -> int:
        return int(self.values.numel())

    @classmethod
    def build(cls, model, tokenizer, mem: UserMemory, fingerprint: str, only: set[str] | None = None) -> "FactKNN | None":
        from sham_decoding import chat_prompt_ids
        p = mem._p("knn.npz")
        if only is not None:
            p = mem._p("knn-" + "-".join(sorted(only)) + ".npz") if only else p
            if not only:
                return None
        if p.exists():
            try:
                z = np.load(p)
                if str(z["fp"]) == fingerprint:
                    return cls(torch.from_numpy(z["keys"]), torch.from_numpy(z["values"]))
            except Exception:
                pass
        facts = mem.facts()
        if not facts:
            return None
        ks, vs = [], []
        cap = _FinalHidden(model)
        try:
            with torch.no_grad():
                for key, v in facts.items():
                    if key not in _FACT_META or (only is not None and key not in only):
                        continue
                    q, a, _l = _FACT_META[key]
                    prompt = chat_prompt_ids(tokenizer.encode(q))
                    ans = tokenizer.encode(a.format(v=v))
                    seq = prompt + ans
                    model(torch.tensor([seq], dtype=torch.long))
                    h = cap.last[0].float()
                    for j in range(len(prompt) - 1, len(seq) - 1):     # state before each answer token -> that token
                        ks.append(h[j] / h[j].norm().clamp_min(1e-8))
                        vs.append(seq[j + 1])
        finally:
            cap.close()
        if not ks:
            return None
        keys, values = torch.stack(ks), torch.tensor(vs, dtype=torch.long)
        mem.dir.mkdir(parents=True, exist_ok=True)
        np.savez(p, fp=np.array(fingerprint), keys=keys.numpy(), values=values.numpy())
        return cls(keys, values)

    def mix(self, logits: torch.Tensor, hidden: torch.Tensor, lam: float, min_sim: float, k: int = 8, temp: float = 0.05) -> torch.Tensor:
        """log((1-λ)·p_model + λ·p_kNN) when the nearest stored state is at least min_sim similar; logits unchanged otherwise."""
        h = hidden / hidden.norm().clamp_min(1e-8)
        sims = self.keys @ h
        top = torch.topk(sims, min(k, sims.numel()))
        if float(top.values[0]) < min_sim:
            return logits
        w = torch.softmax(top.values / temp, dim=-1)
        p_knn = torch.zeros_like(logits).index_add_(0, self.values[top.indices], w)
        p = (1 - lam) * torch.softmax(logits, dim=-1) + lam * p_knn
        return torch.log(p.clamp_min(1e-12))


# ---------------------------------------------------------------- generation with a reusable prefix cache


def generate_with_cache(model, prefix: list[int], suffix: list[int], past, max_new_tokens: int, text_vocab: int, knn: FactKNN | None = None,
                        temperature: float = 0.6, top_k: int = 40, top_p: float = 0.9, greedy: bool = False, style=None,
                        forced: list[int] | None = None, stats: dict | None = None):
    """Answer ids after prefix+suffix. `past` = cache of `prefix` (or None: computed here). Returns (answer ids, cache of prefix).
    forced: score these ids instead of sampling (teacher forcing, for recall tests); stats["logp"] = their summed log-probability (kNN mix included)."""
    from generate import _sample_from_logits
    from model import SpecialTokens
    from sham_decoding import penalize_text_logits
    eos = SpecialTokens.EOS
    lam, min_sim = _num("SHAM_MEMORY_KNN_LAMBDA", 0.5), _num("SHAM_MEMORY_KNN_MIN_SIM", 0.7)
    cap = _FinalHidden(model) if knn is not None and len(knn) else None
    out: list[int] = []
    try:
        with torch.no_grad():
            if past is None and prefix:
                _l, _, past = model(torch.tensor([prefix], dtype=torch.long), use_cache=True)
            prefix_past = [(k.clone(), v.clone()) for k, v in past] if past is not None else None
            feed = suffix
            if forced is not None:
                max_new_tokens = len(forced)
                if stats is not None:
                    stats["logp"] = 0.0
            for step in range(max_new_tokens):
                logits, _, past = model(torch.tensor([feed], dtype=torch.long), past_key_values=past, use_cache=True)
                last = logits[0, -1].float()
                if cap is not None:
                    last = knn.mix(last, cap.last[0, -1].float(), lam, min_sim)
                if forced is not None:
                    nxt = forced[step]
                    if stats is not None:
                        stats["logp"] += float(last.log_softmax(-1)[nxt])
                    out.append(nxt)
                    feed = [nxt]
                    continue
                last = penalize_text_logits(last, out, 1.1, 0.05, 4)
                mask = torch.full_like(last, float("-inf"))
                mask[:text_vocab] = 0.0
                mask[eos] = 0.0
                last = last + mask
                if greedy:
                    nxt = int(last.argmax())
                else:
                    nxt = int(_sample_from_logits(last[None], temperature=temperature, top_k=top_k, top_p=top_p)[0, 0])
                if nxt == eos:
                    break
                out.append(nxt)
                feed = [nxt]
    finally:
        if cap is not None:
            cap.close()
    return out, prefix_past


# ---------------------------------------------------------------- the whole answer path


def _window(turn_ids: list[tuple[list[int], list[int]]], budget: int) -> int:
    """Index of the first turn kept: drop from the oldest, in blocks of half the overflow, so the kept prefix (and its cache) stays stable."""
    total = sum(len(q) + len(a) + 3 for q, a in turn_ids)
    start = 0
    while total > budget and start < len(turn_ids):
        drop = max(1, (len(turn_ids) - start) // 2) if total > budget * 1.5 else 1
        for q, a in turn_ids[start:start + drop]:
            total -= len(q) + len(a) + 3
        start += drop
    return start


def memory_answer(model, tokenizer, user_id: str, prompt: str, max_new_tokens: int = 60, history: list[dict] | None = None,
                  summary: str = "", site_facts: dict | None = None, today=None, greedy: bool = False, record: bool = True,
                  score: str | None = None) -> dict:
    """The memory answer. history: [{"q", "a"}] from the site's database (authoritative when given), else this Studio's own log.
    Returns {"type": "text", "text", "memory": {...stats}} ."""
    from sham_decoding import SHAM_TURN, USER_TURN
    from model import SpecialTokens
    from sham_studio_chat import build_user_text
    t0 = time.time()
    mem = UserMemory(user_id)
    fp = weight_fingerprint(model)
    layer = int(_num("SHAM_MEMORY_KEY_LAYER", 14))
    budget = int(_num("SHAM_MEMORY_WINDOW_TOKENS", 900))
    turns = [t for t in (history if history is not None else mem.turns()) if t.get("q") and t.get("a") is not None]
    new_facts: dict = {}
    for t in turns:                                                   # facts said earlier (the site's history may predate this Studio's log)
        new_facts.update(extract_facts(t["q"]))
    new_facts.update(extract_facts(prompt))
    if site_facts:
        new_facts = {**{k: v for k, v in site_facts.items() if k in _FACT_META}, **new_facts}
    if new_facts:
        mem.update_facts(new_facts)
    facts = mem.facts()
    enc = tokenizer.encode
    turn_ids = [(enc(t["q"])[:192], enc(str(t["a"]))[:192]) for t in turns]
    start = _window(turn_ids, budget)
    recalled: list[str] = []
    if _flag("SHAM_MEMORY_EPISODIC") and start > 0:
        bank = EpisodicBank(mem, fp)
        bank.sync(model, tokenizer, turns[:start], layer)
        recalled = bank.recall(model, tokenizer, prompt, layer, k=2, min_sim=_num("SHAM_MEMORY_EPISODIC_MIN_SIM", 0.5))
    # the memory block: one stable first turn (changes only when facts / summary change, so the cache survives ordinary messages)
    block_lines = [l for l in (facts_line(facts), ("ملخص ما سبق: " + summary.strip()) if summary.strip() else "") if l]
    prefix = [SpecialTokens.BOS]
    if block_lines:
        prefix += [USER_TURN] + enc("\n".join(block_lines))[:256] + [SHAM_TURN] + enc("حسناً، سأتذكّر ذلك.") + [SpecialTokens.EOS]
    for q, a in turn_ids[start:]:
        prefix += [USER_TURN] + q + [SHAM_TURN] + a + [SpecialTokens.EOS]
    cur_text = build_user_text(prompt, today)
    if recalled:
        cur_text = "من محادثاتنا السابقة: " + " | ".join(recalled) + "\n" + cur_text
    suffix = [USER_TURN] + enc(cur_text)[-384:] + [SHAM_TURN]
    limit = model.cfg.max_seq_len - max_new_tokens - 1
    if len(prefix) + len(suffix) > limit:                             # never past the window: keep the newest part
        prefix = [SpecialTokens.BOS] + prefix[-(limit - len(suffix) - 1):]
    cached_ids, past = SessionKV.load(mem, fp)
    reused = 0
    if cached_ids is not None and len(cached_ids) <= len(prefix) and common_prefix(cached_ids, prefix) == len(cached_ids):
        reused = len(cached_ids)
        rest = prefix[reused:]
        if rest:
            with torch.no_grad():
                _l, _, past = model(torch.tensor([rest], dtype=torch.long), past_key_values=past, use_cache=True)
    else:
        past = None
    asked = facts_asked(prompt) & set(facts)
    knn = FactKNN.build(model, tokenizer, mem, fp, only=asked) if _flag("SHAM_MEMORY_KNN") and asked else None
    style = StyleVector.maybe_attach(model, tokenizer, mem, turns)
    try:
        sc: dict = {}
        ans, prefix_past = generate_with_cache(model, prefix, suffix, past, max_new_tokens, tokenizer.vocab_size, knn=knn, greedy=greedy,
                                               forced=tokenizer.encode(score) if score else None, stats=sc)
    finally:
        if style is not None:
            style.detach()
    if prefix_past is not None:
        SessionKV.save(mem, fp, prefix, prefix_past)
    text = tokenizer.decode(ans).strip()
    if record and not score:
        mem.add_turn(prompt, text)
    return {"type": "text", "text": text, "memory": {"facts": len(facts), "window_turns": len(turn_ids) - start, "older_turns": start,
                                                     "recalled": len(recalled), "kv_reused_tokens": reused, "prefix_tokens": len(prefix),
                                                     "knn": len(knn) if knn else 0, "seconds": round(time.time() - t0, 2),
                                                     **({"target_logp": round(sc["logp"], 3)} if score else {})}}


# ---------------------------------------------------------------- later stage, OFF by default: general fact write (gated) and style vector


def write_fact_candidate(model, tokenizer, prompt: str, target: str, layer: int | None = None, steps: int = 25, lr: float = 0.5,
                         out_path: str | Path | None = None) -> dict:
    """ROME-style closed-form rank-1 edit of ONE MLP (Meng et al. 2022; MEMIT 2023 spreads it over layers): k = the MLP's input activation at
    the prompt's last token, v* = the MLP output that makes `target` likely (a vector found with a few steps — no weight is trained), then
    W' = W + (v* - W k) kᵀ / (kᵀ k). Applied to a DEEP COPY; the served model is never touched. The candidate goes to the engineer's gate
    (sham_guard / sham_ci_merge) like any other new weights. Requires SHAM_MEMORY_FACT_WRITE=1. Returns {"applied", "logp_before", "logp_after", "path"}."""
    import copy
    if not _flag("SHAM_MEMORY_FACT_WRITE", "0"):
        return {"applied": False, "reason": "SHAM_MEMORY_FACT_WRITE is off"}
    from sham_decoding import chat_prompt_ids
    cand = copy.deepcopy(model).train(False)
    L = layer if layer is not None else len(cand.layers) // 3
    mlp = cand.layers[L].mlp
    p_ids = chat_prompt_ids(tokenizer.encode(prompt))
    t_ids = tokenizer.encode(target)
    seq = torch.tensor([p_ids + t_ids], dtype=torch.long)
    pos = len(p_ids) - 1

    def target_logp(m, delta=None):
        hook = None
        if delta is not None:
            def add(_m, _i, out):
                out = out.clone()
                out[0, pos] = out[0, pos] + delta
                return out
            hook = m.layers[L].mlp.register_forward_hook(add)
        try:
            lg = m(seq)[0][0].float().log_softmax(-1)
        finally:
            if hook:
                hook.remove()
        return sum(lg[pos + j, t] for j, t in enumerate(t_ids))

    acts = {}
    h = mlp.down_proj.register_forward_hook(lambda _m, inp, out: acts.update(k=inp[0][0, pos].detach().clone(), o=out[0, pos].detach().clone()))
    with torch.no_grad():
        before = float(target_logp(cand))
    h.remove()
    for p in cand.parameters():
        p.requires_grad_(False)
    delta = torch.zeros_like(acts["o"], requires_grad=True)
    opt = torch.optim.Adam([delta], lr=lr)
    for _ in range(steps):
        loss = -target_logp(cand, delta) + 1e-3 * delta.norm() ** 2
        opt.zero_grad()
        loss.backward()
        opt.step()
    k, v_star = acts["k"], (acts["o"] + delta.detach())
    with torch.no_grad():
        W = mlp.down_proj.weight                                      # (d, hidden): out = W k
        W += torch.outer(v_star - W @ k, k) / (k @ k)
        after = float(target_logp(cand))
    res = {"applied": True, "layer": L, "logp_before": round(before, 3), "logp_after": round(after, 3), "model": cand}
    if out_path:
        torch.save({"config": vars(cand.cfg), "model_state_dict": cand.state_dict(), "fact_write": {"prompt": prompt, "target": target, "layer": L}},
                   out_path)
        res["path"] = str(out_path)
    return res


class StyleVector:
    """Per-user activation steering (Turner et al. 2023): v = mean hidden of the user's own messages minus that of neutral text, added at one
    layer with a small scale. OFF unless SHAM_MEMORY_STYLE=1; detach() always removes it."""
    NEUTRAL = ["مرحبا، كيف حالك؟", "ما هي عاصمة فرنسا؟", "اكتب لي جملة قصيرة."]

    def __init__(self, model, vec: torch.Tensor, layer: int, scale: float):
        self.handle = model.layers[layer].register_forward_hook(lambda _m, _i, out: (out[0] + scale * vec, out[1]))

    def detach(self):
        self.handle.remove()

    @classmethod
    def maybe_attach(cls, model, tokenizer, mem: UserMemory, turns: list[dict]):
        if not _flag("SHAM_MEMORY_STYLE", "0") or len(turns) < 3:
            return None
        layer = int(_num("SHAM_MEMORY_STYLE_LAYER", 10))
        user = torch.stack([hidden_at(model, tokenizer.encode(t["q"])[:96] or [3], layer + 1).mean(0) for t in turns[-20:]]).mean(0)
        base = torch.stack([hidden_at(model, tokenizer.encode(s), layer + 1).mean(0) for s in cls.NEUTRAL]).mean(0)
        return cls(model, user - base, layer, _num("SHAM_MEMORY_STYLE_SCALE", 0.1))


# ---------------------------------------------------------------- self-test (tiny random model)

if __name__ == "__main__":
    import tempfile

    from model import ShamSmall, ShamSmallConfig, SpecialTokens

    class Tok:
        vocab_size = 400

        def encode(self, t):
            return [3 + (ord(c) % 390) for c in t]

        def decode(self, ids):
            return "".join(chr(0x0621 + (i % 40)) for i in ids)

    assert extract_facts("مرحبا، اسمي سامر وأنا من حلب وعمري 30") == {"name": "سامر", "city": "حلب", "age": "30"}
    assert extract_facts("ما اسمي؟") == {} and extract_facts("my name is Omar") == {"name": "Omar"}
    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=SpecialTokens.RESULT_END + 8, d_model=32, n_layers=4, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=2048)
    model, tok = ShamSmall(cfg).train(False), Tok()
    with tempfile.TemporaryDirectory() as td:
        os.environ["SHAM_MEMORY_DIR"], os.environ["SHAM_MEMORY_KEY_LAYER"], os.environ["SHAM_MEMORY_WINDOW_TOKENS"] = td, "2", "120"
        r = memory_answer(model, tok, "u1", "اسمي سامر", 6, greedy=True)
        assert r["type"] == "text" and r["memory"]["facts"] == 1
        for i in range(8):
            r = memory_answer(model, tok, "u1", f"سؤال رقم {i}", 4, greedy=True)
        assert r["memory"]["older_turns"] > 0 and r["memory"]["knn"] == 0, r          # not asked about a fact: no kNN
        assert memory_answer(model, tok, "u1", "ما اسمي؟", 2, greedy=True, record=False)["memory"]["knn"] > 0
        assert facts_asked("ما هي عاصمة مصر؟") == set() and facts_asked("شو اسمي؟") == {"name"}
        assert r["memory"]["kv_reused_tokens"] > 0 or r["memory"]["older_turns"] > 0
        # the cache is exactly the uncached answer
        u = UserMemory("u1")
        ids, past = SessionKV.load(u, weight_fingerprint(model))
        assert ids and past[0][0].shape[2] == len(ids)
        a1, _ = generate_with_cache(model, ids, [5, 6, 7], past, 5, tok.vocab_size, greedy=True)
        a2, _ = generate_with_cache(model, ids, [5, 6, 7], None, 5, tok.vocab_size, greedy=True)
        assert a1 == a2, (a1, a2)
        # other weights -> the cache is not used
        with torch.no_grad():
            model.layers[-1].mlp.down_proj.weight.mul_(1.01)
        assert SessionKV.load(u, weight_fingerprint(model)) == (None, None)
        # users never see each other
        r2 = memory_answer(model, tok, "u2", "ما اسمي؟", 4, greedy=True)
        assert r2["memory"]["facts"] == 0 and r2["memory"]["knn"] == 0 and UserMemory("u2").facts() == {}
        # the owner deletes a user's memory from outside (no phrase the model or the bot reacts to)
        assert UserMemory("u1").forget() and not UserMemory("u1").exists()
        # fact write: off by default; on -> candidate only, served model unchanged
        assert not write_fact_candidate(model, tok, "عاصمة سوريا", "دمشق")["applied"]
        os.environ["SHAM_MEMORY_FACT_WRITE"] = "1"
        w0 = model.layers[1].mlp.down_proj.weight.clone()
        fw = write_fact_candidate(model, tok, "عاصمة سوريا", "دمشق", layer=1, steps=30)
        assert fw["applied"] and fw["logp_after"] > fw["logp_before"] and torch.equal(w0, model.layers[1].mlp.down_proj.weight), fw
        # style vector: off by default, removable when on
        x = torch.tensor([[1, 5, 6, 7]])
        base = model(x)[0]
        assert StyleVector.maybe_attach(model, tok, UserMemory("u3"), [{"q": "س"}] * 5) is None
        os.environ["SHAM_MEMORY_STYLE"], os.environ["SHAM_MEMORY_STYLE_LAYER"] = "1", "1"
        sv = StyleVector.maybe_attach(model, tok, UserMemory("u3"), [{"q": "يا هلا والله"}] * 5)
        assert sv is not None and not torch.equal(model(x)[0], base)
        sv.detach()
        assert torch.equal(model(x)[0], base)
    print("sham_memory self-test OK")
