"""
أداة «الاسترجاع والإصلاح وإعادة الدمج» لشام — أداة إضافية منفصلة (2026-10-16).

لا تعدّل أي ملف من ملفات المهندس ولا إعداداته ولا نقاطه: تستورد دواله كما هي
(sham_merge.load_source / guarded_merge / batches_loss / KNOWN_SOURCES،
sham_ci_merge.default_gate، train.train، checkpoint، sham_inputs) وتنشر فقط إلى
مجموعتها هي `sham-repair-remerge-checkpoint` (لا تكتب أبداً فوق final_merged.pt).

    1. استرجاع   الأساس = final_merged.pt من sham-merged-checkpoint؛ المصادر = كل مجموعات sham*
                 (اكتشاف تلقائي بنفس قاعدة المهندس KNOWN_SOURCES) ← كل نقطة جديدة مستقبلاً تُعالَج وحدها.
    1ب. إصلاح الأساس  نسخة من final_merged.pt تُدرَّب تدريب الإصلاح نفسه (SHAM_REPAIR_BASE_STEPS، 0 = تعطيل)، وتُعتمد
                 أساساً للدمج فقط إن عبرت بوابة المهندس (_passes) مقابل الأصلي؛ وإلا يبقى الأصلي. لا يُكتب final_merged.pt.
    2. قياس      كل مصدر يمر بمرحلة إصلاح المهندس (load_source → sham_repair) ثم بميزانه (default_gate:
                 نص/محادثة/وسائط)؛ يُتخطّى ما فيه قيم غير منتهية أو خسارة منفجرة (> EXPLODE × الأساس).
    3. إصلاح     تدريب قصير منخفض المعدّل (REPAIR_STEPS، افتراضياً 1000) على خليط مهارات (محادثة عربية
                 + نص للتذكّر)، يُستأنف عبر الجلسات من حالته المنشورة.
    4. دمج       guarded_merge نفسه على الأساس بالميزان نفسه؛ الناتج final_repair.pt في مجموعتنا فقط.

آمنة لإعادة التشغيل في أي وقت: الحالة repair_state.json تحفظ لكل مصدر الخطوة التي عولجت؛ مصدر لم تتغير
خطوته لا يُعاد، ومصدر نشر نسخة أحدث يُعالج من جديد. النقاط الوسيطة تُحفظ بامتداد .ckpt (لا .pt) حتى لا
يلتقطها اكتشاف المهندس بالخطأ؛ الملف الوحيد *.pt في المجموعة هو الناتج النهائي.

متغيرات البيئة: SHAM_REPAIR_STEPS (1000) · SHAM_REPAIR_LR (2e-5) · SHAM_REPAIR_HOURS (11 على CPU)
SHAM_REPAIR_EXPLODE (3.0) · SHAM_REPAIR_MAX_SOURCES (8)
"""

from __future__ import annotations

import json
import math
import os
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))          # كود المهندس (ai-system/colab/sham_small)

import torch  # noqa: E402

OWN = "sham-repair-remerge-checkpoint"
BASE_DS, BASE_FILE = "sham-merged-checkpoint", "final_merged.pt"
FINAL_NAME = "final_repair.pt"
STATE_NAME = "repair_state.json"
WORK = Path(os.environ.get("SHAM_REPAIR_WORK", "/tmp/sham_repair_remerge"))
OUT = Path(os.environ.get("SHAM_REPAIR_OUT", "/kaggle/working/repair_remerge_out"))

REPAIR_STEPS = int(os.environ.get("SHAM_REPAIR_STEPS", "1000"))
REPAIR_LR = float(os.environ.get("SHAM_REPAIR_LR", "2e-5"))
EXPLODE = float(os.environ.get("SHAM_REPAIR_EXPLODE", "3.0"))
MAX_SOURCES = int(os.environ.get("SHAM_REPAIR_MAX_SOURCES", "8"))
BASE_REPAIR_STEPS = int(os.environ.get("SHAM_REPAIR_BASE_STEPS", str(REPAIR_STEPS)))   # 0 = لا إصلاح للأساس
BASE_CK = "base__repaired.ckpt"
GRAD_ACCUM, BATCH = 2, 8
# إصلاح مراقَب بالميزان مع الاحتفاظ بالأفضل والتوقف المبكر (2026-10-16) — SHAM_REPAIR_TRACKED=0 يعيد السلوك القديم
sys.path.insert(0, str(HERE))
from repair_eval import (EVAL_EVERY, SESSION_STEPS, TRACKED, TRACKED_STEPS, WARMUP, lr_for,  # noqa: E402
                         rel_total, tracked_repair)
SKIP_NAMES = {OWN, BASE_DS}


def _ck_name(src: str) -> str:
    return f"cand__{src}.ckpt"


def _finite(model) -> bool:
    return all(bool(torch.isfinite(p).all()) for p in model.parameters())


def discover_sources(fixed=None) -> list:
    """(dataset, pattern, rows) — نفس قائمة المهندس مع الاكتشاف التلقائي لكل sham*."""
    if fixed is not None:
        return list(fixed)
    from sham_merge import KNOWN_SOURCES, MEDIA_ROWS
    out, seen = [], set()
    extra = [("sham-chat-checkpoint", "final_chat.pt", MEDIA_ROWS),
             ("sham-chat-arabic-sft-checkpoint", "final_chat.pt", MEDIA_ROWS)]
    for name, pattern, rows in list(KNOWN_SOURCES) + extra:
        if name in seen or name in SKIP_NAMES:
            continue
        seen.add(name)
        out.append((name, pattern, rows))
    return out


def default_repair_data(model, tokenizer, gate_hold_questions: set, n_batches: int, seed: int) -> list:
    """خليط المهارات للإصلاح: محادثة عربية (قسم التدريب فقط من دوال المهندس، والأسئلة المحجوبة في الميزان
    مستبعدة) + نص ويكيبيديا للتذكّر (text_replay_batches)، ممزوجة بـ interleave."""
    from sham_chat import (_chat_plan, batch_examples, build_chat_example, interleave, load_arabic_dialogues,
                           split_holdout, text_replay_batches)
    max_len = min(1024, model.cfg.max_seq_len)
    groups, weights = [], []
    try:
        dialogues, _ = load_arabic_dialogues({}, 800, plan=_chat_plan(extra=False))      # the gate's own four Arabic sets (its yardstick never moves)
        train_part, _hold = split_holdout(dialogues, seed=7)        # نفس تقسيم الميزان ⇒ لا تسريب
        more, _ = load_arabic_dialogues({"cidar": 5000, "aya_ar": 5000}, 4000, plan=_chat_plan(extra=False))     # the repair mix stays the Arabic sets it was built on
        pairs = [(q, a) for q, a in train_part + more if " ".join(q.split()) not in gate_hold_questions]
        ex = [build_chat_example(tokenizer.encode(q), tokenizer.encode(a), max_len=max_len) for q, a in pairs]
        chat = batch_examples(ex, BATCH, seed=seed)
        groups.append(chat); weights.append(0.6)
        print(f"بيانات الإصلاح — محادثة: {len(chat)} دفعة")
    except Exception as exc:
        print(f"⚠ تعذّرت بيانات المحادثة: {exc}")
    try:
        text = text_replay_batches(tokenizer, min(512, max_len), BATCH, max(1, n_batches // 2), str(WORK / "replay"), seed=seed)
        groups.append(text); weights.append(0.4)
    except Exception as exc:
        print(f"⚠ تعذّر نص التذكّر: {exc}")
    groups = [g for g in groups if g]
    if not groups:
        return []
    mixed = interleave(groups, weights[:len(groups)], seed=seed)
    while len(mixed) < n_batches:                 # دورة ثانية على نفس الخليط إن كان قصيراً
        mixed = mixed + mixed
    return mixed[:n_batches]


def run(fetch=None, publish=None, gate_builder=None, data_builder=default_repair_data, sources=None,
        device: str = "cpu", hours: float | None = None, repair_steps: int = REPAIR_STEPS,
        base_repair_steps: int | None = None) -> dict:
    from checkpoint import load_checkpoint, save_checkpoint
    from sham_merge import _passes, batches_loss, guarded_merge, load_source
    from text_tokenizer import ShamTextTokenizer
    from train import TrainConfig, build_optimizer, train
    import sham_ci_merge

    if fetch is None or publish is None:
        from sham_inputs import fetch_dataset, publish_dataset
        fetch, publish = fetch or fetch_dataset, publish or publish_dataset
    if gate_builder is None:
        sham_ci_merge.WORK = WORK                  # مجلد عمل الميزان (لا يغيّر الملف، متغير في الذاكرة فقط)
        gate_builder = sham_ci_merge.default_gate
    t0 = time.time()
    budget = (hours if hours is not None else float(os.environ.get("SHAM_REPAIR_HOURS", "5" if device.startswith("cuda") else "11"))) * 3600
    reserve = 50 * 60
    shutil.rmtree(WORK, ignore_errors=True); WORK.mkdir(parents=True)
    shutil.rmtree(OUT, ignore_errors=True); OUT.mkdir(parents=True)
    log = []

    def say(s):
        print(s); log.append(s)

    # ---- الحالة السابقة (استئناف)
    own = fetch(OWN)
    state = {"sources": {}, "history": []}
    if own:
        for p in own.rglob(STATE_NAME):
            state = json.loads(p.read_text(encoding="utf-8")); break
    state.setdefault("sources", {}); state.setdefault("history", [])

    # ---- 1) الأساس
    broot = fetch(BASE_DS)
    bhits = sorted(broot.rglob(BASE_FILE)) if broot else []
    assert bhits, f"لا يوجد {BASE_FILE} في {BASE_DS}"
    base_ckpt, base_dir = bhits[0], bhits[0].parent
    model, base_step, _ = load_checkpoint(base_ckpt, map_location=device)
    tokenizer = ShamTextTokenizer.load(str(sorted(base_dir.rglob("sham_small_tokenizer.json"))[0]))
    ref = Path("/kaggle/working")                  # مرحلة إصلاح المهندس تقارن صفوف الوسائط بمرمّزات الأساس هنا
    if ref.exists() and os.access(ref, os.W_OK):
        for f in ("sham_small_tokenizer.json", "image_tokenizer.pt", "audio_tokenizer.pt"):
            for src in base_dir.rglob(f):
                shutil.copy2(src, ref / f); break
    if state.get("base_step") != base_step:        # الأساس تغيّر: كل المعالجات السابقة قيست على أساس آخر
        if state.get("base_step") is not None:
            say(f"الأساس تغيّر ({state.get('base_step')} → {base_step}) — إعادة المعالجة من البداية")
        state = {"sources": {}, "history": state.get("history", []), "base_step": base_step}
    say(f"الأساس: {BASE_DS}/{BASE_FILE} — الخطوة {base_step:,}")

    gate = gate_builder(model, tokenizer, base_dir, device)
    assert gate, "لا ميزان — لا إصلاح ولا دمج بلا ميزان"
    score = lambda m: {k: batches_loss(m, v, device) for k, v in gate.items()}
    base_score = score(model)
    say("ميزان الأساس: " + ", ".join(f"{k}={v:.3f}" for k, v in base_score.items()))
    hold_q = set()
    try:
        from sham_chat import _chat_plan, load_arabic_dialogues, split_holdout
        _, hold = split_holdout(load_arabic_dialogues({}, 800, plan=_chat_plan(extra=False))[0], seed=7)
        hold_q = {" ".join(q.split()) for q, _ in hold}
    except Exception:
        pass

    def out_time():
        return time.time() - t0 > budget - reserve

    def save_state():
        (OUT / STATE_NAME).write_text(json.dumps(state, ensure_ascii=False, default=float), encoding="utf-8")

    def carry(name):                               # نقل النقاط الوسيطة السابقة إلى مجلد النشر (الإصدار الجديد يحلّ محل القديم)
        if own and not (OUT / name).exists():
            for p in own.rglob(name):
                shutil.copy2(p, OUT / name); return True
        return (OUT / name).exists()

    # ---- 1ب) إصلاح الأساس نفسه (أُضيف 2026-10-16 بموافقة المالك): نسخة من final_merged.pt تُدرَّب على الخليط نفسه
    # بالمعدّل المنخفض، وتُعتمد فقط إن عبرت بوابة المهندس (_passes) مقارنة بالأساس الأصلي؛ وإلا يبقى الأصلي.
    brs = repair_steps if base_repair_steps is None else base_repair_steps
    bst = state.setdefault("base_repair", {"done": 0})
    base_pending = False
    if brs > 0 and bst.get("status") not in ("adopted", "kept_original"):
        from checkpoint import load_checkpoint as _lc
        bm = None
        if bst.get("done", 0) > 0 and carry(BASE_CK):
            bm, _, _ = _lc(OUT / BASE_CK, map_location=device)
        if bm is None:
            bm, _, _ = _lc(base_ckpt, map_location=device); bst["done"] = 0
        remaining = brs - int(bst["done"])
        if TRACKED and bst.get("mode") != "tracked":
            bst.update(mode="tracked", done=0); bst.pop("ref", None); bst.pop("best_rel", None)
            bm, _, _ = _lc(base_ckpt, map_location=device)
        if TRACKED:
            remaining = 0
            if not bst.get("finished") and not out_time():
                batches = data_builder(bm, tokenizer, hold_q, min(SESSION_STEPS, TRACKED_STEPS) * GRAD_ACCUM,
                                       seed=base_step + int(bst["done"]))
                if batches:
                    say(f"🔧 الأساس: إصلاح مراقَب بالميزان — معدّل {lr_for(BASE_DS):.0e}")
                    tracked_repair(bm, batches, score, bst, lr=lr_for(BASE_DS), device=device,
                                   seconds=max(60.0, budget - reserve - (time.time() - t0)), say=say,
                                   grad_accum=GRAD_ACCUM, batch_size=BATCH, seq_len=min(1024, bm.cfg.max_seq_len))
                else:
                    say("⚠ إصلاح الأساس: لا بيانات — يبقى الأساس الأصلي"); bst["status"] = "kept_original"
        if remaining > 0 and not out_time():
            batches = data_builder(bm, tokenizer, hold_q, remaining * GRAD_ACCUM, seed=base_step + int(bst["done"]))
            if batches:
                d0 = int(bst["done"])
                cfg = TrainConfig(seq_len=min(1024, bm.cfg.max_seq_len), batch_size=BATCH, grad_accum_steps=GRAD_ACCUM,
                                  lr=REPAIR_LR, warmup_steps=min(50, max(1, brs // 20)), total_steps=brs,
                                  checkpoint_dir=str(WORK / "ck" / "_base"), checkpoint_every=10**9, log_every=50,
                                  max_wall_clock_seconds=max(60.0, budget - reserve - (time.time() - t0)))
                h = train(bm, batches, cfg, device=device, start_step=d0, resume_optimizer=build_optimizer(bm, REPAIR_LR, 0.1))
                bst["done"] = d0 + len(h)
            else:
                say("⚠ إصلاح الأساس: لا بيانات — يبقى الأساس الأصلي"); bst["status"] = "kept_original"
        if bst.get("status") != "kept_original":
            if not _finite(bm):
                bst["status"] = "kept_original"; say("❌ إصلاح الأساس أنتج قيماً غير منتهية — يبقى الأصلي")
            elif (not bst.get("finished")) if TRACKED else (bst["done"] < brs):
                save_checkpoint(OUT / BASE_CK, bm, base_step, extra={"repair_done": bst["done"], "source": BASE_DS})
                base_pending = True; say(f"⏸ إصلاح الأساس {bst['done']}/{brs} — يكمل في التشغيل القادم")
            else:
                sb = score(bm)
                bst["score_after"] = sb
                if _passes(sb, base_score, 0.005):
                    save_checkpoint(OUT / BASE_CK, bm, base_step, extra={"repair_done": bst["done"], "source": BASE_DS})
                    bst["status"] = "adopted"
                    say("✅ الأساس المُصلَح عبر البوابة: " + ", ".join(f"{k} {base_score[k]:.3f}→{sb[k]:.3f}" for k in sb))
                else:
                    bst["status"] = "kept_original"
                    say("❌ الأساس المُصلَح لم يعبر البوابة — يبقى الأصلي: " + ", ".join(f"{k} {base_score[k]:.3f}→{sb[k]:.3f}" for k in sb))
        del bm
        save_state()
    elif bst.get("status") == "adopted":
        carry(BASE_CK)
    if bst.get("status") == "adopted" and (OUT / BASE_CK).exists():
        from checkpoint import load_checkpoint as _lc
        model, _, _ = _lc(OUT / BASE_CK, map_location=device)   # المصادر تُدمج فوق الأساس المُصلَح
        base_score = score(model)
        say("الأساس المعتمد للدمج: المُصلَح — " + ", ".join(f"{k}={v:.3f}" for k, v in base_score.items()))

    # ---- 2+3) لكل مصدر: استرجاع + قياس + إصلاح
    srcs = [] if base_pending else discover_sources(sources)[:MAX_SOURCES]
    say("المصادر: " + ", ".join(n for n, _, _ in srcs))
    for name, pattern, rows in srcs:
        st = state["sources"].get(name, {})
        if out_time():
            say(f"⏸ {name}: انتهى وقت الجلسة — يكمل في التشغيل القادم"); 
            if st.get("status") in ("training", "repaired"): carry(_ck_name(name))
            continue
        root = fetch(name)
        if not root:
            say(f"⏭ {name}: غير متاح"); continue
        loaded, why = load_source(root, pattern, model, tokenizer)
        if loaded is None:
            say(f"⏭ {name}: {why}"); state["sources"][name] = {"status": "skipped", "why": str(why)[:200]}
            shutil.rmtree(root, ignore_errors=True); continue
        cand, src_step = loaded
        shutil.rmtree(root, ignore_errors=True)
        if st.get("src_step") == src_step and st.get("status") in ("repaired", "rejected", "skipped"):
            if st.get("status") == "repaired":
                carry(_ck_name(name))
            say(f"⏭ {name}: الخطوة {src_step:,} عولجت سابقاً ({st['status']})"); continue
        if st.get("src_step") != src_step:
            st = {"src_step": src_step, "done": 0}
        if not _finite(cand):
            st.update(status="skipped", why="قيم غير منتهية"); state["sources"][name] = st
            say(f"❌ {name}: قيم غير منتهية (NaN/Inf) — تُتخطّى"); continue
        s0 = score(cand)
        if any((not math.isfinite(v)) or v > EXPLODE * base_score[k] for k, v in s0.items()):
            st.update(status="skipped", why=f"خسارة منفجرة {s0}"); state["sources"][name] = st
            say(f"❌ {name}: خسارة منفجرة/غير منتهية — " + ", ".join(f"{k}={v:.3f}" for k, v in s0.items())); continue
        st["score_before"] = s0
        # استئناف تدريب سابق لنفس خطوة المصدر
        if st.get("done", 0) > 0 and carry(_ck_name(name)):
            cand, _, _ = load_checkpoint(OUT / _ck_name(name), map_location=device)
        cand.to(device)
        remaining = repair_steps - int(st.get("done", 0))
        if TRACKED and st.get("mode") != "tracked":          # أول جلسة بالوضع المراقَب: يبدأ العدّ من جديد على النقطة الحالية
            st.update(mode="tracked", done=0); st.pop("ref", None); st.pop("best_rel", None)
        if TRACKED:
            remaining = 0                                    # يُعالَج بالفرع المراقَب أدناه (لا train() الطويل القديم)
            if not st.get("finished") and int(st.get("done", 0)) < TRACKED_STEPS:
                batches = data_builder(cand, tokenizer, hold_q, min(SESSION_STEPS, TRACKED_STEPS) * GRAD_ACCUM,
                                       seed=src_step + int(st.get("done", 0)))
                if not batches:
                    say(f"⚠ {name}: لا بيانات إصلاح — يُترك دون تدريب"); st["finished"] = True
                else:
                    say(f"🔧 {name}: إصلاح مراقَب بالميزان — معدّل {lr_for(name):.0e} ثابت بعد إحماء {WARMUP}، قياس كل {EVAL_EVERY} خطوة")
                    tracked_repair(cand, batches, score, st, lr=lr_for(name), device=device,
                                   seconds=max(60.0, budget - reserve - (time.time() - t0)), say=say,
                                   grad_accum=GRAD_ACCUM, batch_size=BATCH, seq_len=min(1024, cand.cfg.max_seq_len))
        if remaining > 0:
            batches = data_builder(cand, tokenizer, hold_q, remaining * GRAD_ACCUM, seed=src_step + int(st.get("done", 0)))
            if not batches:
                say(f"⚠ {name}: لا بيانات إصلاح — يُترك دون تدريب")
            else:
                seconds = max(60.0, budget - reserve - (time.time() - t0))
                done0 = int(st.get("done", 0))
                cfg = TrainConfig(seq_len=min(1024, cand.cfg.max_seq_len), batch_size=BATCH, grad_accum_steps=GRAD_ACCUM,
                                  lr=REPAIR_LR, warmup_steps=min(50, max(1, repair_steps // 20)), total_steps=repair_steps,
                                  checkpoint_dir=str(WORK / "ck" / name), checkpoint_every=10**9, log_every=50,
                                  max_wall_clock_seconds=seconds)
                hist = train(cand, batches, cfg, device=device, start_step=done0,
                             resume_optimizer=build_optimizer(cand, REPAIR_LR, 0.1))
                st["done"] = done0 + len(hist)
                st["train_loss_last"] = [round(x, 4) for x in hist[-10:]]
        if not _finite(cand):
            st.update(status="rejected", why="صار غير منتهٍ بعد التدريب"); state["sources"][name] = st
            say(f"❌ {name}: صار غير منتهٍ بعد الإصلاح — يُرفض"); continue
        save_checkpoint(OUT / _ck_name(name), cand, src_step, extra={"repair_done": st["done"], "source": name})
        if (not st.get("finished")) if TRACKED else (st["done"] < repair_steps):
            st["status"] = "training"; state["sources"][name] = st; save_state()
            say(f"⏸ {name}: إصلاح {st['done']}/{repair_steps} — يكمل في التشغيل القادم"); break
        s1 = score(cand)
        if TRACKED and rel_total(s1, s0) >= len(s0):
            say(f"   {name}: الإصلاح لم يحسّن الميزان عن نقطة المصدر — تُستعمل أفضل نقطة (قد تكون البداية نفسها)")
        st.update(status="repaired", score_after=s1, rows=rows)
        state["sources"][name] = st
        say(f"🔧 {name} (خطوة {src_step:,}): " + ", ".join(f"{k} {s0[k]:.3f}→{s1[k]:.3f}" for k in s1))
        save_state()
        del cand

    # ---- 4) الدمج بطريقة المهندس وميزانه — فقط حين لا يبقى مصدر قيد التدريب
    pending = [n for n, s in state["sources"].items() if s.get("status") == "training"] + (["(الأساس)"] if base_pending else [])
    published, changed = None, False
    if not pending:
        cands = []
        for n, s in state["sources"].items():
            if s.get("status") == "repaired" and (OUT / _ck_name(n)).exists():
                m, _, _ = load_checkpoint(OUT / _ck_name(n), map_location=device)
                rws = [tuple(r) for r in s.get("rows") or [(0, model.cfg.vocab_size)]]
                cands.append((f"{n} (مُصلَح، خطوة {s['src_step']:,})", m, rws))
        if cands:
            lines = guarded_merge(model, cands, score)
            for l in lines: say(l)
            changed = any(l.startswith("✅") for l in lines)
        if bst.get("status") == "adopted":
            changed = True
        after = score(model)
        state["last_merge"] = {"at": time.strftime("%Y-%m-%d %H:%M", time.gmtime()), "before": base_score, "after": after, "changed": changed}
        if changed:
            from sham_tok_id import stamp
            save_checkpoint(OUT / FINAL_NAME, model, base_step, extra={**stamp(tokenizer), "repair_remerge": True})
            state["history"].append({"at": state["last_merge"]["at"], "step": base_step, **{k: round(v, 4) for k, v in after.items()}})
        else:
            say("لا تحسّن على الميزان — لا ناتج نهائي جديد (الأساس يبقى كما هو)")
    else:
        say("⏸ الدمج مؤجّل حتى يكتمل إصلاح: " + ", ".join(pending))
    if changed or (own and carry(FINAL_NAME)):
        tokenizer.save(str(OUT / "sham_small_tokenizer.json"))
        for f in ("image_tokenizer.pt", "audio_tokenizer.pt"):
            for src in base_dir.rglob(f):
                shutil.copy2(src, OUT / f); break
    save_state()
    (OUT / "repair_log.txt").write_text("\n".join(log), encoding="utf-8")
    published = publish(OUT, OWN, f"repair+remerge from {BASE_DS} step {base_step:,}" + (" (merged)" if changed else ""))
    say(f"النشر: {published} ({(time.time() - t0) / 60:.0f} دقيقة)")
    return {"changed": changed, "state": state, "published": published, "model": model, "log": log}


def _selftest():
    """تشغيل جاف على نموذج صغير جداً: لا شبكة ولا كاكل."""
    import tempfile
    from checkpoint import save_checkpoint
    from model import ShamSmall, ShamSmallConfig
    global WORK, OUT
    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=64)
    tok = HERE.parent / "sham_general_tokenizer.json"
    td = Path(tempfile.mkdtemp()); WORK, OUT = td / "work", td / "out"
    good, base, bad = ShamSmall(cfg), ShamSmall(cfg), ShamSmall(cfg)
    with torch.no_grad():
        for (n, p), q in zip(base.named_parameters(), good.parameters()):
            p.copy_(q + 0.5 * torch.randn_like(q))
        bad.layers[0].mlp.up_proj.weight.mul_(1e6)       # «منفجر»
    d = {}
    for name, m, fn in ((BASE_DS, base, BASE_FILE), ("sham-good", good, "final.pt"), ("sham-bad", bad, "final.pt")):
        (td / name).mkdir(); save_checkpoint(td / name / fn, m, 7); shutil.copy(tok, td / name / "sham_small_tokenizer.json"); d[name] = td / name
    ids = torch.randint(0, 2000, (4, 32))
    with torch.no_grad():
        labels = good(ids)[0].argmax(-1)
    gate_builder = lambda m, t, b, dev: {"text": [(ids, labels)]}
    data_builder = lambda m, t, h, n, seed: [(ids, labels)] * n
    pubs = []

    def publish(up, name, msg):
        snap = td / f"pub{len(pubs)}"; shutil.copytree(up, snap); pubs.append((name, sorted(p.name for p in snap.iterdir()))); d[OWN] = snap
        return name
    fetch = lambda n: (shutil.copytree(d[n], td / f"f_{n}_{time.time_ns()}") if n in d else None)
    srcs = [("sham-good", "final*.pt", [(0, 42256)]), ("sham-bad", "final*.pt", [(0, 42256)])]
    # جلسة 1: إصلاح كامل + رفض المنفجر + دمج
    r = run(fetch=fetch, publish=publish, gate_builder=gate_builder, data_builder=data_builder, sources=srcs, hours=2, repair_steps=6)
    st = r["state"]["sources"]
    # المصفوفة المنفجرة تُصلحها مرحلة المهندس (sham_repair) قبل أن تصل إلينا، فيُقبل المصدر بعد إصلاحه
    assert st["sham-good"]["status"] == "repaired" and st["sham-bad"]["status"] in ("repaired", "skipped"), st
    nanm = ShamSmall(cfg)
    with torch.no_grad():
        nanm.layers[0].mlp.up_proj.weight[0, 0] = float("nan")
    assert not _finite(nanm) and _finite(good)
    assert r["changed"] and FINAL_NAME in pubs[-1][1] and STATE_NAME in pubs[-1][1], (r["log"], pubs)
    assert not any(x.endswith(".pt") and x != FINAL_NAME and "tokenizer" not in x for x in pubs[-1][1]), pubs
    # جلسة 2: لا جديد ⇒ لا إعادة معالجة، والناتج السابق يُحمل
    r2 = run(fetch=fetch, publish=publish, gate_builder=gate_builder, data_builder=data_builder, sources=srcs, hours=2, repair_steps=6)
    assert any("عولجت سابقاً" in l for l in r2["log"]) and FINAL_NAME in pubs[-1][1], (r2["log"], pubs)
    assert r["state"]["base_repair"]["status"] in ("adopted", "kept_original"), r["state"]["base_repair"]
    assert not any(x == BASE_FILE for x in pubs[-1][1]), pubs        # لا يُكتب final_merged.pt أبداً
    # إصلاح أساس يسيء على البوابة ⇒ يبقى الأصلي
    d.pop(OWN, None)
    worse = lambda m, t, h, n, seed: [(ids, torch.randint(0, 2000, (4, 32)))] * n
    r3 = run(fetch=fetch, publish=publish, gate_builder=gate_builder, data_builder=worse, sources=[], hours=2, repair_steps=6)
    assert r3["state"]["base_repair"]["status"] == "kept_original" and not r3["changed"], (r3["log"], r3["state"]["base_repair"])
    # إصلاح أساس مقطوع (البيانات تكفي نصف الخطوات) ⇒ يُحفظ .ckpt ويُستأنف في الجلسة التالية، والدمج مؤجّل
    d.pop(OWN, None)
    half = lambda m, t, h, n, seed: [(ids, labels)] * max(2, n // 2)
    r4 = run(fetch=fetch, publish=publish, gate_builder=gate_builder, data_builder=half, sources=[], hours=2, base_repair_steps=4)
    b4 = r4["state"]["base_repair"]
    assert b4["done"] == 2 and "status" not in b4 and BASE_CK in pubs[-1][1] and FINAL_NAME not in pubs[-1][1], (r4["log"], b4, pubs[-1])
    for _ in range(3):      # كل جلسة تكمل من حيث توقفت السابقة (2 → 3 → 4)
        r5 = run(fetch=fetch, publish=publish, gate_builder=gate_builder, data_builder=half, sources=[], hours=2, base_repair_steps=4)
        b5 = r5["state"]["base_repair"]
        assert b5["done"] > b4["done"] or "status" in b5, b5
        b4 = b5
        if "status" in b5:
            break
    assert b5["done"] == 4 and b5["status"] in ("adopted", "kept_original"), (r5["log"], b5)
    print("sham_repair_remerge self-test OK")


if __name__ == "__main__":
    if (len(sys.argv) > 1 and sys.argv[1] == "--selftest") or not (os.environ.get("KAGGLE_USERNAME") or os.environ.get("KAGGLE_API_TOKEN")):
        _selftest()
    else:
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        run(device=dev)

# When this session ends (even on failure), ask the restarter to run instead of waiting for GitHub's lagging cron (2026-10-16).
try:
    import sys as _sys, os as _os
    _sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), ".."))
    import sham_trigger_restarter as _sham_trigger_restarter
    _sham_trigger_restarter.install()
except Exception as _exc:
    print(f"sham_trigger_restarter not installed: {_exc}")
