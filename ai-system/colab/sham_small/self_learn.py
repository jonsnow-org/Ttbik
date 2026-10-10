"""
Sham — live self-learning loop (search → answer → one weight step → new ckpt).

Additive to serve.py / sham_chat / sham_decoding / web_access patterns.
Never overwrites final_chat.pt; gated by SHAM_SELF_LEARN=1.
"""

from __future__ import annotations

import os
import shutil
import threading
from dataclasses import dataclass
from pathlib import Path

import torch

from checkpoint import save_checkpoint
from sham_chat import IGNORE, build_chat_example
from sham_decoding import SHAM_TURN, USER_TURN, chat_prompt_ids, web_search_text
from model import ShamSmall, SpecialTokens
from text_tokenizer import ShamTextTokenizer
from train import build_optimizer

_learn_lock = threading.Lock()


@dataclass
class SearchHit:
    title: str
    body: str
    href: str = ""


def self_learn_enabled() -> bool:
    return os.environ.get("SHAM_SELF_LEARN", "").strip() == "1"


def _default_save_path(served_checkpoint: str | None) -> Path:
    explicit = os.environ.get("SHAM_SELF_LEARN_SAVE_PATH", "").strip()
    if explicit:
        return Path(explicit)
    if served_checkpoint:
        return Path(served_checkpoint).resolve().parent / "final_chat_self.pt"
    return Path("final_chat_self.pt")


def assert_safe_save_path(path: Path) -> None:
    """Refuse silent overwrite of the canonical chat checkpoint names."""
    name = path.name.lower()
    forbidden = {"final_chat.pt", "final.pt"}
    if name in forbidden:
        raise ValueError(
            f"رفض حفظ التعلّم الذاتي فوق {path.name} — استخدم final_chat_self.pt أو مسار SHAM_SELF_LEARN_SAVE_PATH."
        )
    served = os.environ.get("SHAM_SMALL_CHECKPOINT_PATH", "").strip()
    if served and path.resolve() == Path(served).resolve():
        raise ValueError(
            f"رفض الكتابة فوق نقطة الخدمة نفسها ({served}) — اختر مساراً جديداً لـ SHAM_SELF_LEARN_SAVE_PATH."
        )


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
        print(f"self_learn.search_hits failed ({exc}); falling back to web_search_text")
        snippet = web_search_text(query, max_results=max_results, max_chars=800)
        if snippet:
            hits.append(SearchHit(title=query, body=snippet, href=""))
    return hits


def format_sources_context(hits: list[SearchHit], max_chars: int = 900) -> str:
    if not hits:
        return ""
    parts = []
    for i, h in enumerate(hits, 1):
        line = f"[{i}] {h.title}: {h.body}".strip()
        parts.append(line)
    text = "\n".join(parts)
    return text[:max_chars]


def build_grounded_user_prompt(question: str, sources: str) -> str:
    if sources:
        return (
            f"سؤال المستخدم: {question}\n\n"
            f"مقتطفات من البحث (اعتمد عليها في الإجابة دون اختلاق):\n{sources}\n\n"
            f"أجب بالعربية بإيجاز ووضوح."
        )
    return question


def grounded_target_answer(question: str, hits: list[SearchHit], generated: str) -> str:
    """Trusted supervision target from search snippets."""
    bodies = [h.body for h in hits if h.body][:3]
    joined = " ".join(bodies)
    if len(joined) > 400:
        joined = joined[:400].rsplit(" ", 1)[0] + "…"
    base = joined or (hits[0].title if hits else "")
    gen = (generated or "").strip()
    if gen and len(gen) < 200 and not gen.isspace():
        return f"{base}\n(إجابة شام: {gen[:120]})"
    return base or f"معلومات متاحة عن: {question}"


def freeze_for_light_step(model: ShamSmall, n_unfreeze: int) -> list[str]:
    """Freeze all params; unfreeze last n transformer layers + final_norm + lm_head."""
    for p in model.parameters():
        p.requires_grad = False
    names: list[str] = []
    n_layers = len(model.layers)
    start = max(0, n_layers - max(0, n_unfreeze))
    for i in range(start, n_layers):
        for name, p in model.layers[i].named_parameters():
            p.requires_grad = True
            names.append(f"layers.{i}.{name}")
    for mod_name, mod in (("final_norm", model.final_norm), ("lm_head", model.lm_head)):
        for name, p in mod.named_parameters():
            p.requires_grad = True
            names.append(f"{mod_name}.{name}")
    return names


def one_step(
    model: ShamSmall,
    tokenizer: ShamTextTokenizer,
    question: str,
    answer: str,
    *,
    lr: float | None = None,
    max_seq: int | None = None,
    n_unfreeze: int | None = None,
    device: str = "cpu",
) -> dict:
    """One forward/backward/optimizer step on a single chat turn."""
    lr = float(lr if lr is not None else os.environ.get("SHAM_SELF_LEARN_LR", "1e-5"))
    max_seq = int(max_seq if max_seq is not None else os.environ.get("SHAM_SELF_LEARN_MAX_SEQ", "256"))
    n_unfreeze = int(
        n_unfreeze if n_unfreeze is not None else os.environ.get("SHAM_SELF_LEARN_UNFREEZE_LAYERS", "2")
    )

    user_ids = tokenizer.encode(question)
    answer_ids = tokenizer.encode(answer)
    ids, labels = build_chat_example(user_ids, answer_ids, max_len=max_seq)
    if len(ids) < 4:
        raise ValueError("مثال التعلّم قصير جداً بعد الترميز")

    trainable = freeze_for_light_step(model, n_unfreeze)
    if not any(p.requires_grad for p in model.parameters()):
        raise RuntimeError("لا معاملات قابلة للتدريب بعد التجميد")

    model.train()
    opt = build_optimizer(model, lr=lr, weight_decay=0.01)
    input_ids = torch.tensor([ids], dtype=torch.long, device=device)
    label_ids = torch.tensor([labels], dtype=torch.long, device=device)
    model.to(device)

    _, loss = model(input_ids, labels=label_ids)
    if loss is None or not torch.isfinite(loss):
        model.eval()
        raise RuntimeError(f"خسارة غير صالحة: {loss}")
    loss_val = float(loss.item())
    opt.zero_grad(set_to_none=True)
    loss.backward()
    torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
    opt.step()
    opt.zero_grad(set_to_none=True)
    for p in model.parameters():
        p.requires_grad = False
    model.eval()
    return {
        "loss": loss_val,
        "seq_len": len(ids),
        "trainable_tensors": len(trainable),
        "lr": lr,
        "n_unfreeze": n_unfreeze,
    }


def save_self_checkpoint(
    model: ShamSmall,
    step: int,
    save_path: Path,
    tokenizer: ShamTextTokenizer | None = None,
    tokenizer_src: str | Path | None = None,
    extra: dict | None = None,
) -> dict:
    assert_safe_save_path(save_path)
    save_path.parent.mkdir(parents=True, exist_ok=True)
    meta = {"self_learn": True, **(extra or {})}
    save_checkpoint(save_path, model, step=step, optimizer=None, extra=meta)

    tok_dst = save_path.parent / "sham_small_tokenizer.json"
    if tokenizer_src and Path(tokenizer_src).exists():
        if Path(tokenizer_src).resolve() != tok_dst.resolve():
            shutil.copy2(tokenizer_src, tok_dst)
    elif tokenizer is not None and hasattr(tokenizer, "save"):
        tokenizer.save(str(tok_dst))
    return {"path": str(save_path), "tokenizer_path": str(tok_dst) if tok_dst.exists() else None, "step": step}


def learn_from_turn(
    model: ShamSmall,
    tokenizer: ShamTextTokenizer,
    question: str,
    answer: str,
    *,
    current_step: int,
    served_checkpoint: str | None = None,
    tokenizer_path: str | None = None,
    device: str = "cpu",
) -> dict:
    """Full gated learn: one step + save new ckpt."""
    if not self_learn_enabled():
        return {"learned": False, "reason": "SHAM_SELF_LEARN is not 1"}

    save_path = _default_save_path(served_checkpoint)
    assert_safe_save_path(save_path)

    with _learn_lock:
        metrics = one_step(model, tokenizer, question, answer, device=device)
        new_step = int(current_step) + 1
        saved = save_self_checkpoint(
            model,
            step=new_step,
            save_path=save_path,
            tokenizer=tokenizer,
            tokenizer_src=tokenizer_path,
            extra={"source_question": question[:200], "loss": metrics["loss"]},
        )
    return {"learned": True, "metrics": metrics, "checkpoint": saved, "step": new_step}


def ask_web_generate(
    model: ShamSmall,
    tokenizer: ShamTextTokenizer,
    question: str,
    *,
    max_new_tokens: int = 60,
    use_chat_wrap: bool = True,
) -> tuple[str, list[SearchHit], str]:
    """Search → build context → generate. Returns (answer, hits, sources_text)."""
    from generate import generate_tokens

    hits = search_hits(question)
    sources = format_sources_context(hits)
    user_prompt = build_grounded_user_prompt(question, sources)
    prompt_ids = tokenizer.encode(user_prompt)
    if use_chat_wrap:
        try:
            wrapped = chat_prompt_ids(prompt_ids[-384:])
        except Exception:
            wrapped = [SpecialTokens.BOS] + prompt_ids[-384:]
    else:
        wrapped = [SpecialTokens.BOS] + prompt_ids[-384:]

    ids = torch.tensor([wrapped], dtype=torch.long)
    out = generate_tokens(
        model,
        ids,
        max_new_tokens=max_new_tokens,
        temperature=0.6,
        top_k=40,
        top_p=0.9,
        eos_id=SpecialTokens.EOS,
        allowed_ranges=[(0, tokenizer.vocab_size)] * max_new_tokens,
    )
    gen_ids = [i for i in out[0, ids.shape[1] :].tolist() if i != SpecialTokens.EOS and i < tokenizer.vocab_size]
    answer = tokenizer.decode(gen_ids)
    return answer, hits, sources


if __name__ == "__main__":
    import tempfile

    from model import ShamSmallConfig, TOTAL_VOCAB_SIZE
    from text_tokenizer import train_text_tokenizer

    torch.manual_seed(0)
    cfg = ShamSmallConfig(
        vocab_size=TOTAL_VOCAB_SIZE, d_model=64, n_layers=4, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=128
    )
    model = ShamSmall(cfg)
    with tempfile.TemporaryDirectory() as td:
        corpus = Path(td) / "c.txt"
        corpus.write_text("مرحباً هذا اختبار تعلّم ذاتي لشام. " * 80, encoding="utf-8")
        tok = train_text_tokenizer([str(corpus)], vocab_size=800)
        os.environ["SHAM_SELF_LEARN"] = "1"
        os.environ["SHAM_SELF_LEARN_SAVE_PATH"] = str(Path(td) / "final_chat_self.pt")
        os.environ["SHAM_SELF_LEARN_UNFREEZE_LAYERS"] = "1"
        os.environ["SHAM_SELF_LEARN_MAX_SEQ"] = "64"
        os.environ["SHAM_SELF_LEARN_LR"] = "1e-3"

        try:
            assert_safe_save_path(Path(td) / "final_chat.pt")
            raise SystemExit("should have refused final_chat.pt")
        except ValueError:
            print("safety: refuse final_chat.pt OK")

        q, a = "ما هو شام؟", "شام نموذج ذكاء اصطناعي ملكية كاملة."
        result = learn_from_turn(model, tok, q, a, current_step=100, served_checkpoint=None)
        assert result["learned"], result
        assert Path(result["checkpoint"]["path"]).exists()
        assert result["step"] == 101
        print(f"tiny smoke OK: loss={result['metrics']['loss']:.4f} step={result['step']}")
        ctx = format_sources_context([SearchHit("ت", "نص تجريبي", "https://example.com")])
        assert "نص تجريبي" in ctx
        print("self_learn self-test passed")
