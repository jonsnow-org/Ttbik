"""
Sham v2 training (the lineage whose body is a transplanted chat-tuned donor and whose text vocabulary is the donor's own: SHAM_TEXT_VOCAB).

What a session does, in order (the Kaggle notebook kaggle_notebooks/sham_v2/sham_v2_train.ipynb is thin glue around these functions, so the logic is testable here on a tiny model):
  1. prepare_model():  resume from this lineage's own dataset (sham-v2-checkpoint) or build the native model from the donor (the transplant, in memory).
  2. freeze_for_media(): the donor body stays frozen; media/special embedding rows and low-rank adapters on attention/MLP projections train.
  3. batches: media pairs (the stage-2 collectors, notebook cells) + tool/code/ask examples (sham_tools_data.qwen3_tool_examples, the layout the engine sends)
     + Arabic chat (streamed instruction sets) so the language does not fade.
  4. train() (train.py: fp16 + GradScaler on GPU, wall-clock limit, checkpoints) and measure_tools(): a fixed set of tool cases answered through the SAME guarded
     generation the Studio uses, scored on name + required arguments.
  5. save and publish (notebook cells), with the tokenizer stamp so serve.py accepts it.
GPU when the quota allows, else CPU: train() and the restarter handle the device; nothing here depends on it.
"""
from __future__ import annotations

import json
import math
import os
import random
import time
from pathlib import Path

import torch

DEFAULT_DONOR = os.environ.get("SHAM_V2_DONOR", "Qwen/Qwen3-1.7B")
TEXT_VOCAB_DEFAULT = 151936


def setup_env(text_vocab: int = TEXT_VOCAB_DEFAULT) -> None:
    """Must run BEFORE model.py is imported anywhere (the vocabulary layout is read at import)."""
    os.environ.setdefault("SHAM_TEXT_VOCAB", str(text_vocab))


def prepare_model(donor: str, own_checkpoint: Path | None, device: str):
    """(model, step). Resume from the lineage's own checkpoint when there is one, else the in-memory transplant from the donor."""
    from checkpoint import load_checkpoint
    if own_checkpoint is not None and Path(own_checkpoint).is_file():
        model, step, _ = load_checkpoint(own_checkpoint, map_location="cpu")
        print(f"resumed from {own_checkpoint} (step {step})", flush=True)
    else:
        from sham_transplant import LazyDonor, native_model
        model = native_model(LazyDonor(donor), chat_format="qwen3")
        step = 0
        print(f"built the native model from the donor (step 0, {sum(p.numel() for p in model.parameters()) / 1e9:.2f}B parameters)", flush=True)
    rank = max(0, int(os.environ.get("SHAM_V2_ADAPTER_RANK", "8")))
    if rank:
        wrapped = model.enable_adapters(rank, float(os.environ.get("SHAM_V2_ADAPTER_ALPHA", "16")))
        print(f"enabled {wrapped} trainable low-rank adapters; donor base projections remain frozen", flush=True)
    return model.to(device), step


def freeze_for_media(model, text_vocab: int | None = None) -> int:
    """Freeze everything but the media/special rows of the token table. Returns how many rows are trainable."""
    tv = text_vocab or int(os.environ.get("SHAM_TEXT_VOCAB", TEXT_VOCAB_DEFAULT))
    for p in model.parameters():
        p.requires_grad_(False)
    w = model.token_embedding.weight
    w.requires_grad_(True)
    keep = torch.zeros(w.shape[0], 1, dtype=w.dtype, device=w.device)
    keep[tv:] = 1.0
    w.register_hook(lambda g: g * keep.to(g.device, g.dtype))
    for name, param in model.named_parameters():
        if name.endswith(".adapter_down") or name.endswith(".adapter_up"):
            param.requires_grad_(True)
    return int(w.shape[0] - tv)


def media_optimizer(model, lr: float = 2e-4):
    """AdamW over media rows and low-rank adapters only; donor base projections stay frozen."""
    trainable = [p for p in model.parameters() if p.requires_grad]
    if not trainable:
        raise RuntimeError("Sham v2 training has no trainable parameters")
    return torch.optim.AdamW(trainable, lr=lr, weight_decay=0.0, betas=(0.9, 0.95))


def identity_grounding_pairs() -> list[tuple[str, str]]:
    """Small factual SFT examples for Sham v2's app identity; training data only, never an inference-time fixed reply."""
    return [
        ("من أنت؟", "أنا شام v2، مساعد مستقل داخل تطبيق شام. نوفا مساعد منفصل وليس اسمي."),
        ("هل أنت نوفا؟", "لا، أنا شام v2. نوفا نموذج آخر يعمل بمسار منفصل."),
        ("أنت شام أم نوفا؟", "أنا شام v2، ولست نوفا. لكل نموذج مساره الخاص داخل التطبيق."),
        ("ما الفرق بينك وبين نوفا؟", "نحن نموذجان مختلفان في التطبيق؛ لكل واحد مسار واستدعاء مستقل. اسمي شام v2."),
        ("هل أنت شام القديم؟", "أنا إصدار شام v2، أما شام القديم فهو مسار آخر منفصل."),
        ("ما اسم النموذج الذي تتحدث من خلاله؟", "أنا أعمل بصفتي شام v2، ولا أتحدث باسم نوفا."),
    ]


def tool_batches(tokenizer, n: int, batch_size: int, seed: int, system: str | None = None, max_len: int = 1100):
    """Padded (ids, labels) batches of tool / code / ask examples in the engine's own layout."""
    from sham_chat import batch_examples
    from sham_tools_data import qwen3_tool_examples
    ex = qwen3_tool_examples(tokenizer, random.Random(seed), n, system or "", max_len=max_len)
    return batch_examples(ex, batch_size)


def arabic_pairs_to_batches(tokenizer, pairs: list[tuple[str, str]], batch_size: int, system: str | None = None, max_len: int = 900):
    """(question, answer) pairs -> Qwen3-layout chat batches (loss on the answer only)."""
    from sham_chat import batch_examples
    end = tokenizer.encode("<|im_end|>")[-1]
    ex = []
    for q, a in pairs:
        p = tokenizer.encode(f"<|im_start|>user\n{q}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n")
        t = tokenizer.encode(a) + [end]
        if len(p) + len(t) <= max_len:
            ex.append((p + t, [-100] * len(p) + t))
    return batch_examples(ex, batch_size)


def _parse_call(text: str):
    import re
    m = re.search(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", text, re.S)
    if not m:
        return None
    try:
        o = json.loads(m.group(1))
        return str(o.get("name", "")), (o.get("arguments") or {})
    except ValueError:
        return None


@torch.no_grad()
def measure_tools(model, tokenizer, n_cases: int = 24, seed: int = 4242, max_new: int = 90) -> dict:
    """A fixed set of tool cases (own seed, never trained on: training uses other seeds), answered through the Studio's guarded generation.
    valid = a well-formed call; right = the first call has the expected tool and every expected argument name."""
    from sham_studio_chat import qwen3_chat
    from sham_tools_data import any_spec, tool_block, TOOL_SPECS
    rng = random.Random(seed)
    model.train(False)
    valid = right = asked = 0
    rows = []
    for _ in range(n_cases):
        user, steps, _ans = any_spec(rng)
        name, args, _res = steps[0]
        names = list(dict.fromkeys([name] + rng.sample([t for t in TOOL_SPECS if t != name], 4)))
        rng.shuffle(names)
        prompt = f"{tool_block(names)}\n\nالمستخدم: {user}\nشام:"
        out = qwen3_chat(model, tokenizer, prompt, max_new)
        call = _parse_call(out)
        ok = call is not None
        good = bool(ok and call[0] == name and set(args) <= set(call[1]))
        valid += ok
        right += good
        asked += bool(ok and call[0] == "ask_user")
        rows.append({"user": user[:60], "expected": name, "got": call[0] if ok else None, "right": good})
    return {"cases": n_cases, "valid": valid, "right": right, "asked": asked, "rows": rows}


def run_session(model, step: int, batches: list, device: str, hours: float, lr: float = 2e-4, ckpt_dir: str = "/kaggle/working/checkpoints") -> tuple[list[float], int]:
    """Train the media table on `batches` for at most `hours`. Returns (losses, final step)."""
    from train import TrainConfig, train
    opt = media_optimizer(model, lr)
    accum = 4
    total = max(len(batches) // accum, 1)
    cfg = TrainConfig(seq_len=model.cfg.max_seq_len, batch_size=1, grad_accum_steps=accum, lr=lr, warmup_steps=max(5, total // 50), total_steps=step + total,
                      checkpoint_dir=ckpt_dir, checkpoint_every=100, log_every=10, max_wall_clock_seconds=hours * 3600)
    losses = train(model, batches, cfg, device=device, start_step=step, resume_optimizer=opt)
    return losses, step + len(losses)


# ---------------------------------------------------------------- Sham v1's other data, in the Qwen3 layout (parity with v1's chat stage: general text + code, worked reasoning, reading evidence)
def text_mix_batches(tokenizer, documents: int = 400, batch_size: int = 2, window: int = 384, seed: int = 0, files: list[str] | None = None):
    """General text + multi-language code from v1's own mixture (sham_text_mix.stream_mix), as plain language-model windows (loss on every token)."""
    from sham_chat import batch_examples
    if files is None:
        import sham_text_mix
        files = sham_text_mix.stream_mix("/tmp/sham_v2_textmix", max_documents=documents, seed=seed, documents_per_file=documents)
    ex = []
    for f in files:
        if not str(f).endswith(".txt"):
            continue
        ids = tokenizer.encode(Path(f).read_text(encoding="utf-8"))
        for i in range(0, max(0, len(ids) - window + 1), window):
            w = ids[i:i + window]
            ex.append((w, list(w)))
    return batch_examples(ex, batch_size, seed=seed)


def reasoning_pairs(n: int, seed: int) -> list[tuple[str, str]]:
    """Worked problems (v1's sham_reasoning_data): (question, step-by-step solution ending with the final answer)."""
    import sham_reasoning_data as R
    rng = random.Random(seed)
    out, seen = [], set()
    while len(out) < n and len(seen) < n * 20:
        p = R.make_problem(rng)
        if p["question"] not in seen:
            seen.add(p["question"])
            out.append((p["question"], p["solution"]))
    return out


def rag_pairs(articles: list[tuple[str, str]], n: int, seed: int, n_results: int = 3, p_no_answer: float = 0.15, evidence_chars: int = 420) -> list[tuple[str, str]]:
    """Reading evidence (v1's sham_rag_data): the passages a library returned are IN the user turn; the answer is the hidden word, or an honest 'not in the references'."""
    import sham_rag_data as G
    from sham_kb import KnowledgeBase
    rng = random.Random(seed)
    arts = [(t, x) for t, x in articles if x and len(x) > 200]
    if len(arts) < 4:
        return []
    kb = KnowledgeBase().build(x for _, x in arts)
    out, tries = [], 0
    while len(out) < n and tries < n * 6:
        tries += 1
        pick = G._blank_question(arts[rng.randrange(len(arts))][1], rng)
        if pick is None:
            continue
        blank_s, hidden, sentence = pick
        res = kb.search(sentence.replace(hidden, " "), n_results)
        if not res:
            continue
        gold = [r for r in res if hidden in r[2] and sentence[:40] in r[2]]
        abstain = rng.random() < p_no_answer
        if abstain:
            res = [r for r in res if r not in gold]
            if not res:
                continue
        elif not gold:
            continue
        else:
            rng.shuffle(res)
        evidence = "\n".join(f"[{i + 1}] {r[2][:evidence_chars]}" for i, r in enumerate(res))
        out.append((f"المراجع:\n{evidence}\n\n" + rng.choice(G.ASK).format(s=blank_s), rng.choice(G.NO_ANSWER) if abstain else hidden))
    return out


# ---------------------------------------------------------------- the merge gate (the same rule Sham v1 lives by: nothing replaces the served checkpoint unless it is measured not worse)
HELDOUT_FALLBACK = (
    "دمشق عاصمة سوريا وهي من أقدم المدن المأهولة في العالم. تقع على نهر بردى وتتميز بأسواقها القديمة وجامعها الأموي. "
    "يتعلم الطالب القراءة والكتابة في المدرسة، ثم ينتقل إلى الجامعة ليختار تخصصه. الماء يغلي عند مئة درجة مئوية على مستوى سطح البحر. "
    "كتب الشاعر قصيدة عن الوطن والغربة، وقرأها أمام جمهور كبير في المسرح. البرمجة هي كتابة تعليمات يفهمها الحاسوب لحل مسألة ما. "
    "في فصل الشتاء تهطل الأمطار وتخضر الأرض، وفي الصيف ترتفع الحرارة ويقصد الناس البحر. " * 6
)


def heldout_text(documents: int = 60) -> str:
    """A FIXED Arabic/mixed text sample (seed 4242, never trained on) for the gate; an offline built-in sample when the text mix cannot be streamed."""
    try:
        import sham_text_mix
        files = sham_text_mix.stream_mix("/tmp/sham_v2_heldout", max_documents=documents, seed=4242, documents_per_file=documents)
        text = "\n".join(Path(f).read_text(encoding="utf-8") for f in files if f.endswith(".txt"))
        if len(text) > 2000:
            return text
    except Exception as exc:  # noqa: BLE001 - a missing network must not stop a training session
        print(f"held-out text: built-in sample ({type(exc).__name__})", flush=True)
    return HELDOUT_FALLBACK


@torch.no_grad()
def heldout_loss(model, tokenizer, device: str, text: str | None = None) -> float:
    """Mean next-token loss of `model` on the fixed held-out text (sham_base_select.text_loss: the same yardstick v1's base selection uses)."""
    from sham_base_select import text_loss
    return float(text_loss(model, tokenizer, text or heldout_text(), device))


def gate(loss_before: float, loss_after: float, tools_before: dict | None = None, tools_after: dict | None = None,
         loss_tolerance: float = 1.03, tool_floor: float = 0.9) -> dict:
    """Decide whether a trained checkpoint may be PUBLISHED over the served one. Refused when the held-out loss is not finite or worse than before by more than
    `loss_tolerance` (3 %), or when the correct-tool-call count on the same fixed cases fell below `tool_floor` of what it was. Returns {ok, reasons, ...}."""
    import math
    reasons = []
    if not (math.isfinite(loss_after) and math.isfinite(loss_before)):
        reasons.append("held-out loss is not finite")
    elif loss_after > loss_before * loss_tolerance:
        reasons.append(f"held-out loss rose {loss_before:.4f} -> {loss_after:.4f} (more than {int((loss_tolerance - 1) * 100)} %)")
    if tools_before and tools_after and tools_before.get("cases") == tools_after.get("cases") and tools_before.get("right", 0) > 0:
        if tools_after.get("right", 0) < tools_before["right"] * tool_floor:
            reasons.append(f"correct tool calls fell {tools_before['right']} -> {tools_after.get('right', 0)} of {tools_before['cases']}")
    return {"ok": not reasons, "reasons": reasons, "loss_before": loss_before, "loss_after": loss_after}


if __name__ == "__main__":
    import tempfile

    setup_env(300)                                              # a tiny text vocabulary for the self-test (set before model.py is imported)
    from checkpoint import load_checkpoint, save_checkpoint
    from model import ShamSmall, ShamSmallConfig, SpecialTokens

    class Tok:
        vocab_size = 300

        def encode(self, t):
            return [3 + (ord(c) % 280) for c in t] if t != "<|im_end|>" else [299]

        def decode(self, ids):
            return "".join(chr(0x0621 + (i % 40)) for i in ids)

    tv = 300
    # max_seq_len matches the real Sham v2 context (sham_transplant.py: 2048), not an arbitrary
    # toy value: a real 5-tool prompt is ~1200 chars, so a smaller window made measure_tools
    # raise "prompt + thinking + answer exceeds model context" and the self-test never reached it.
    cfg = ShamSmallConfig(vocab_size=tv + 8192 + 2048 + 16, d_model=32, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=64, max_seq_len=2048)
    model = ShamSmall(cfg)
    model.enable_adapters(4)
    n = freeze_for_media(model, tv)
    assert n == 8192 + 2048 + 16, n
    assert sum(p.requires_grad for p in model.parameters()) > 1
    w0 = model.token_embedding.weight.detach().clone()
    adapter0 = {name: p.detach().clone() for name, p in model.named_parameters() if name.endswith(".adapter_down") or name.endswith(".adapter_up")}
    from sham_chat import batch_examples
    end_id = Tok().encode("<|im_end|>")[-1]
    media_id = tv + 1
    media_batch = batch_examples([([3, media_id, end_id], [-100, media_id, end_id])], 1)
    # This toy tokenizer is one id per character, while the real one is ~3 chars per id. qwen3_tool_examples'
    # max_len is a real-token budget, so the toy cases need a char-scale window (~1100 * 3). Passing the
    # default straight through produced zero tool batches here and the loss assertions below failed; 1600
    # keeps the padded toy sequences under the 2048 context too.
    batches = media_batch + tool_batches(Tok(), 12, 2, seed=1, max_len=1600)
    assert len(identity_grounding_pairs()) >= 6 and all(q and a for q, a in identity_grounding_pairs())
    assert batches and all(isinstance(b, tuple) and len(b) == 2 for b in batches)
    with tempfile.TemporaryDirectory() as d:
        losses, final = run_session(model, 0, batches[:4], "cpu", 0.05, ckpt_dir=d)
        assert losses and all(torch.isfinite(torch.tensor(l)) for l in losses)
        w1 = model.token_embedding.weight.detach()
        assert torch.equal(w0[:tv], w1[:tv]), "a donor text row changed"
        assert not torch.equal(w0[tv:], w1[tv:]), "the media rows did not train"
        assert any(not torch.equal(adapter0[name], p.detach()) for name, p in model.named_parameters() if name in adapter0), "language/tool adapters did not train"
        save_checkpoint(Path(d) / "x.pt", model, final)
        m2, s2, _ = load_checkpoint(Path(d) / "x.pt", map_location="cpu")
        assert s2 == final and torch.equal(m2.token_embedding.weight, model.token_embedding.weight)
    mt = measure_tools(model, Tok(), n_cases=2, max_new=6)
    assert mt["cases"] == 2 and len(mt["rows"]) == 2 and 0 <= mt["right"] <= mt["valid"] <= 2
    ar = arabic_pairs_to_batches(Tok(), [("ما هي عاصمة سوريا؟", "دمشق."), ("كيف حالك؟", "بخير، شكراً.")], 2)
    assert ar
    rp = reasoning_pairs(5, 1)
    assert len(rp) == 5 and all(q and a for q, a in rp)
    arts = [(f"t{i}", " ".join(f"في عام {1900 + i * 7 + j} حدث أمر مهم رقم {j} في المدينة الكبيرة رقم {i} وتحدث الناس عنه كثيرا." for j in range(12))) for i in range(8)]
    gp = rag_pairs(arts, 4, 1)
    assert gp and all("المراجع:" in q and a for q, a in gp), gp[:1]
    import tempfile as _tf
    with _tf.TemporaryDirectory() as _d:
        (Path(_d) / "a.txt").write_text("نص عربي طويل " * 400, encoding="utf-8")
        assert text_mix_batches(Tok(), batch_size=2, window=64, files=[str(Path(_d) / "a.txt")])
    hl = heldout_loss(model, Tok(), "cpu", text="ab" * 400)
    assert math.isfinite(hl), hl
    assert gate(2.0, 2.0)["ok"] and gate(2.0, 2.05)["ok"] and not gate(2.0, 2.2)["ok"] and not gate(2.0, float("nan"))["ok"]
    assert not gate(2.0, 1.9, {"cases": 10, "right": 8}, {"cases": 10, "right": 5})["ok"] and gate(2.0, 1.9, {"cases": 10, "right": 8}, {"cases": 10, "right": 8})["ok"]
    assert heldout_text.__doc__ and len(HELDOUT_FALLBACK) > 2000
    print("sham_v2_train self-test OK: media rows and low-rank adapters train; donor base remains frozen; role-based tool/Arabic batches and checkpoint round-trip.")
