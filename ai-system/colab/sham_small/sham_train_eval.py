"""
Held-out check for plain-text training sessions (stage 1, Track A, ...).

Why: the session reports said "average loss of the first 10 steps / the last 10 steps" — each number
is ONE micro-batch of four windows, so it swings by ±1.5 on its own (the reports showed 4.05 → 1.82 and
3.93 → 4.34 for sessions of the same kind). Worse, when a session re-reads the same few million tokens
many times, the last steps get LOW losses because the text has been memorised — the opposite of learning.
Nothing in those reports could tell the two apart.

What this does (installed once by sham_inputs; no notebook cell changes): the first HOLDOUT_BATCHES
micro-batches of a session are taken out and never trained on — also when the notebook's endless batch
iterator brings the same window round again (they are recognised by content). The model is measured on them
before and after the session; the report then shows the held-out loss and the gap to the training loss.
Only sessions whose batches are plain token tensors are touched (chat / stage 2 use tuples and have their
own yardsticks).
"""

from __future__ import annotations

import hashlib
import itertools
import os

import torch

HOLDOUT_BATCHES = 8
TOLERANCE = 0.003      # the end of a session may be this much (relative) worse than the best weights seen before they are restored
RESULT: dict = {}   # filled by every session: before / after / train_tail / n_tokens


def _key(batch: torch.Tensor) -> str:
    return hashlib.sha1(batch.detach().cpu().contiguous().numpy().tobytes()).hexdigest()[:16]


@torch.no_grad()
def _loss(model, batches, device) -> float:
    was_training = model.training
    model.eval()
    total = tokens = 0
    for b in batches:
        ids = b.to(device)
        _, loss = model(ids, labels=ids)
        total += float(loss) * ids.numel()
        tokens += ids.numel()
    if was_training:
        model.train()
    return total / max(tokens, 1)


def install() -> None:
    import train as _train

    if getattr(_train.train, "_sham_eval", False):
        return
    original = _train.train

    def train_with_eval(model, batches, cfg, *args, **kwargs):
        device = kwargs.get("device") or (args[0] if args else "cpu")
        it = iter(batches)
        held = list(itertools.islice(it, HOLDOUT_BATCHES))
        if len(held) < HOLDOUT_BATCHES or not all(isinstance(b, torch.Tensor) for b in held):
            return original(model, itertools.chain(held, it), cfg, *args, **kwargs)
        banned = {_key(b) for b in held}
        rest = (b for b in it if not (isinstance(b, torch.Tensor) and _key(b) in banned))
        model.to(device)
        before = _loss(model, held, device)
        # REGRESSION GUARD (2026-10-10): the reports showed Track A ending a session WORSE on unseen text (+0.056, +0.270,
        # +0.062) and still publishing "the last weights". Every EVAL_EVERY micro-batches the weights are scored on the held-out
        # windows; the best ones seen (the starting weights included) are kept on the CPU, and if the session ends worse than
        # the best they are put back. Nothing is written for the model: it only chooses between weights Sham itself produced.
        every = int(os.environ.get("SHAM_EVAL_EVERY", 0)) or (400 if str(device).startswith("cuda") else 100)
        guard = {"best": before, "snap": None, "at": 0, "n": 0, "curve": []}   # snap None = the starting weights are the best

        def _snapshot():
            return {k: v.detach().to("cpu", copy=True) for k, v in model.state_dict().items()}

        start_weights = _snapshot()

        def guarded(it):
            for b in it:
                guard["n"] += 1
                if guard["n"] % every == 0:
                    cur = _loss(model, held, device)
                    guard["curve"].append((guard["n"], round(cur, 4)))
                    if cur < guard["best"] * (1 - 1e-4):
                        guard.update(best=cur, snap=_snapshot(), at=guard["n"])
                yield b

        history = original(model, guarded(rest), cfg, *args, **kwargs)
        after = _loss(model, held, device)
        restored = False
        if after > guard["best"] * (1 + TOLERANCE):
            model.load_state_dict(guard["snap"] if guard["snap"] is not None else start_weights)
            restored, final = True, after
            after = _loss(model, held, device)
        RESULT.update(guard=dict(restored=restored, best=guard["best"], best_at=guard["at"], final=after if not restored else final,
                                 evals=guard["curve"][-12:]))
        del start_weights
        tail = history[-50:]
        RESULT.update(before=before, after=after, train_tail=(sum(tail) / len(tail)) if tail else None,
                      tokens=sum(b.numel() for b in held))
        try:
            from sham_selfdev import record
            record("نص لم يُدرَّب عليه (كل الجلسة)", f"{before:.3f} → {after:.3f} على {RESULT['tokens']:,} رمزاً")
        except Exception:
            pass
        print(f"📏 نص لم يُدرَّب عليه: {before:.3f} → {after:.3f} | خسارة التدريب (آخر 50 خطوة): "
              f"{RESULT['train_tail'] if RESULT['train_tail'] is None else round(RESULT['train_tail'], 3)}")
        return history

    train_with_eval._sham_eval = True
    _train.train = train_with_eval


def report_lines() -> list[str]:
    """For telegram_report.format_training_report."""
    if "after" not in RESULT:
        return []
    lines = [f"📏 على نص لم يُدرَّب عليه: قبل {RESULT['before']:.3f} → بعد {RESULT['after']:.3f} "
             f"({RESULT['after'] - RESULT['before']:+.3f})"]
    g = RESULT.get("guard")
    if g:
        if g["restored"]:
            where = f"بعد {g['best_at']} دفعة" if g["best_at"] else "أوزان بداية الجلسة"
            lines.append(f"🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي ({g['final']:.3f}) فاستُعيدت أفضل أوزان وُجدت ({where}، {g['best']:.3f}) "
                         "ولم تُنشر الأوزان الأسوأ.")
        else:
            lines.append(f"🛡 الحارس: نهاية الجلسة هي الأفضل أو ضمن الهامش (أفضل {g['best']:.3f}) — لا استعادة.")
    tail = RESULT.get("train_tail")
    if tail is not None:
        lines.append(f"خسارة التدريب في آخر 50 خطوة: {tail:.3f}")
        if RESULT["after"] - tail > 1.0:
            lines.append("⚠ الخسارة على بيانات التدريب أقل بكثير من غير المرئية: الجلسة أعادت قراءة نفس النص "
                         "مراراً فحفظته ولم تتعلم منه — راجعي حجم البيانات الجديدة في هذه الجلسة.")
    try:
        import sham_text_stream
        st = sham_text_stream._ACTIVE["stream"]
        if st is not None:
            lines.append(f"🌊 خط النص المتدفق: {st.stats['windows']:,} نافذة جديدة (كل نافذة مرة واحدة) من "
                         f"{sum(1 for v in st.per_source.values() if v)} مصدراً | انتظار التدريب للبيانات {st.stats['waited']:.0f}ث")
    except Exception:
        pass
    return lines


if __name__ == "__main__":
    import train as T
    from model import ShamSmall, ShamSmallConfig

    torch.manual_seed(0)
    cfg_m = ShamSmallConfig(vocab_size=500, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=16)
    model = ShamSmall(cfg_m)
    windows = [torch.randint(0, 500, (2, 16)) for _ in range(12)]

    def endless():  # the stage-1 pattern: the same windows, again and again
        while True:
            yield from windows

    seen = []

    def spy(model_, batches_, cfg_, *a, **k):
        for b in itertools.islice(batches_, 40):
            seen.append(_key(b))
        return [0.0] * 10

    T.train = spy
    install()
    T.train(model, endless(), T.TrainConfig(seq_len=16, batch_size=2, total_steps=10, warmup_steps=1), device="cpu")
    held = {_key(b) for b in windows[:HOLDOUT_BATCHES]}
    assert seen and not (set(seen) & held), "a held-out window reached training"
    assert {_key(b) for b in windows[HOLDOUT_BATCHES:]} <= set(seen), "the rest must still be trained on"
    assert RESULT["before"] > 0 and "after" in RESULT
    assert any("نص لم يُدرَّب" in l for l in report_lines())
    # the guard: a session whose training RUINS the held-out loss ends on the best weights, not the last
    torch.manual_seed(1)
    m2 = ShamSmall(cfg_m)
    w2 = [torch.randint(0, 500, (2, 16)) for _ in range(40)]
    T.train = original_train = None
    import importlib
    importlib.reload(T)

    def ruin(model_, batches_, cfg_, *a, **k):          # a "training" that destroys the model after a few steps
        for i, _b in enumerate(batches_):
            if i == 60:
                with torch.no_grad():
                    for p_ in model_.parameters():
                        p_.add_(torch.randn_like(p_) * 0.5)
            if i >= 80:
                break
        return [1.0] * 80

    T.train = ruin
    install()
    os.environ["SHAM_EVAL_EVERY"] = "10"
    ref_before = {k: v.clone() for k, v in m2.state_dict().items()}
    RESULT.clear()
    T.train(m2, iter(w2 * 4), T.TrainConfig(seq_len=16, batch_size=2, total_steps=80, warmup_steps=1), device="cpu")
    g = RESULT["guard"]
    assert g["restored"], g
    assert all(torch.equal(v, m2.state_dict()[k]) for k, v in ref_before.items()), "the starting weights must come back"
    assert any("الحارس" in l and "استُعيدت" in l for l in report_lines())
    # and a normal improving session is left alone
    os.environ.pop("SHAM_EVAL_EVERY", None)
    # tuple batches (chat / stage 2): untouched
    calls = []
    T.train = lambda m, b, c, *a, **k: calls.append(list(b)) or []
    RESULT.clear()
    install_again = T.train  # a fresh, unwrapped function
    T.train._sham_eval = False
    install()
    mix = [(torch.zeros(1, 4, dtype=torch.long), torch.zeros(1, 4, dtype=torch.long)) for _ in range(12)]
    T.train(model, iter(mix), None, device="cpu")
    assert len(calls[0]) == 12 and not RESULT, "tuple batches must pass through untouched"
    print("sham_train_eval self-test OK")
