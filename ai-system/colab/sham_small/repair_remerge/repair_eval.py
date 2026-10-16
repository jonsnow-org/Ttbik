"""
إصلاح «مُراقَب بالميزان» لأداة الاسترجاع والإصلاح (إضافة 2026-10-16، لا تحذف شيئاً من الأداة الأصلية).

ما يفعله بدل استدعاء train() مرة واحدة لـ1000 خطوة:
  • يستدعي train() نفسه من كود المهندس على دفعات من EVAL_EVERY خطوة، بنفس المُحسِّن طوال الجلسة.
  • قبل البداية وبعد كل دفعة يقيس الميزان نفسه (default_gate: نص/محادثة/وسائط) — نفس تعريف خسارة الميزان.
  • يحتفظ بأفضل أوزان (أقل مجموع نسبي للميزان، بنفس صيغة _passes) ويرجع إليها في النهاية.
  • يتوقف مبكراً إن لم يتحسّن الميزان PATIENCE مرات متتالية، أو إن ساءت أي مهارة > RISE عن بداية الإصلاح.
  • معدّل ثابت بعد إحماء قصير في كل جلسة (min_lr_ratio=1.0 في TrainConfig المهندس)؛ المُحسِّن جديد كل جلسة ⇒ إحماء من جديد.
  • يسجّل خسارة الميزان بجانب خسارة التدريب (متوسط الدفعة، لا آخر دفعة صغيرة) حتى تكون التقارير قابلة للمقارنة.

متغيرات البيئة (كلها قابلة للإرجاع):
  SHAM_REPAIR_TRACKED=0          ⇒ السلوك القديم كما هو (train() واحد، جيب تمام 1000 خطوة، معدّل 2e-5)
  SHAM_REPAIR_EVAL_EVERY (50) · SHAM_REPAIR_PATIENCE (2) · SHAM_REPAIR_RISE (0.02)
  SHAM_REPAIR_SESSION_STEPS (300 على CPU — تنتهي ضمن جلسة واحدة بهامش واسع)
  SHAM_REPAIR_TRACKED_STEPS (300 — مجموع خطوات الإصلاح لكل مصدر في الوضع المراقَب)
  SHAM_REPAIR_WARMUP (30) · SHAM_REPAIR_LR_TRACK (اختياري: يفرض معدلاً واحداً لكل المسارات)
"""

from __future__ import annotations

import copy
import os
import time

TRACKED = os.environ.get("SHAM_REPAIR_TRACKED", "1") != "0"
EVAL_EVERY = int(os.environ.get("SHAM_REPAIR_EVAL_EVERY", "50"))
PATIENCE = int(os.environ.get("SHAM_REPAIR_PATIENCE", "2"))
RISE = float(os.environ.get("SHAM_REPAIR_RISE", "0.02"))
SESSION_STEPS = int(os.environ.get("SHAM_REPAIR_SESSION_STEPS", "300"))
TRACKED_STEPS = int(os.environ.get("SHAM_REPAIR_TRACKED_STEPS", "300"))
WARMUP = int(os.environ.get("SHAM_REPAIR_WARMUP", "30"))

# معدّل الضبط الدقيق الذي يستعمله المهندس نفسه لكل مسار (من دفاتره):
#   مرحلة الوسائط sham_small_training_stage2_multimodal / sham_all_in_one: lr=1e-4
#   مرحلة المحادثة sham_chat_stage / sham_chat_image_in_one: lr=5e-5
#   مسارات التدريب المسبق (3e-4) لا تُستعمل لإصلاح نقطة مدرَّبة ⇒ معدّل المحادثة الأكثر تحفظاً.
TRACK_LR = {"sham-multimodal-checkpoint": 1e-4, "sham-chat-checkpoint": 5e-5, "sham-chat-arabic-sft-checkpoint": 5e-5}
DEFAULT_LR = 5e-5


def lr_for(source: str) -> float:
    forced = os.environ.get("SHAM_REPAIR_LR_TRACK")
    return float(forced) if forced else TRACK_LR.get(source, DEFAULT_LR)


def rel_total(score: dict, ref: dict) -> float:
    """مجموع النسب لكل مهارة مقابل نقطة البداية — نفس صيغة _passes عند المهندس (أقل = أفضل)."""
    return sum(score[k] / ref[k] for k in ref if k in score)


def fmt(score: dict) -> str:
    return ", ".join(f"{k}={v:.3f}" for k, v in score.items())


def tracked_repair(model, batches, score, entry: dict, *, lr: float, device: str, seconds: float, say,
                   grad_accum: int, batch_size: int, seq_len: int, session_steps: int | None = None,
                   eval_every: int | None = None, patience: int | None = None, rise: float | None = None,
                   warmup: int | None = None, total_steps: int | None = None) -> dict:
    """يدرّب model في مكانه ويعيده إلى أفضل نقطة بالميزان. entry = سجل المصدر في repair_state.json (يُحدَّث).
    المفاتيح: done (خطوات مُنجزة تراكمياً)، ref (ميزان بداية الإصلاح، ثابت عبر الجلسات)، best (أفضل ميزان)،
    best_rel، best_done، evals [{done, train, eval...}]، finished (اكتمل أو توقف مبكراً)."""
    from train import TrainConfig, build_optimizer, train

    eval_every = eval_every or EVAL_EVERY
    patience = PATIENCE if patience is None else patience
    rise = RISE if rise is None else rise
    warmup = WARMUP if warmup is None else warmup
    total = total_steps or TRACKED_STEPS
    t0 = time.time()

    s_now = score(model)
    entry.setdefault("ref", s_now)                    # المرجع: الميزان قبل أي خطوة إصلاح (أول جلسة)
    ref = entry["ref"]
    rel_now = rel_total(s_now, ref)
    if "best_rel" not in entry or rel_now < entry["best_rel"] - 1e-9:
        entry.update(best=s_now, best_rel=rel_now, best_done=int(entry.get("done", 0)))
    entry.setdefault("evals", [])
    entry.setdefault("bad", 0)
    say(f"   ميزان بداية الجلسة (خطوة {entry.get('done', 0)}): {fmt(s_now)} | المرجع {fmt(ref)}")
    best_state = copy.deepcopy({k: v.detach().to("cpu") for k, v in model.state_dict().items()})
    best_rel_session = rel_now

    budget_steps = min(session_steps or SESSION_STEPS, total - int(entry.get("done", 0)))
    opt = build_optimizer(model, lr, 0.1)            # مُحسِّن جديد ⇒ إحماء جديد في هذه الجلسة
    local = 0
    cursor = 0
    stop_reason = None
    while local < budget_steps:
        chunk = min(eval_every, budget_steps - local)
        need = chunk * grad_accum
        part = batches[cursor:cursor + need]
        if len(part) < need:
            stop_reason = "نفدت بيانات الجلسة"; 
            if not part:
                break
        cursor += len(part)
        left = seconds - (time.time() - t0)
        if left < 60:
            stop_reason = "انتهى وقت الجلسة"; break
        cfg = TrainConfig(seq_len=seq_len, batch_size=batch_size, grad_accum_steps=grad_accum, lr=lr,
                          min_lr_ratio=1.0, warmup_steps=max(1, warmup), total_steps=local + chunk,
                          checkpoint_dir=os.environ.get("SHAM_REPAIR_WORK", "/tmp/sham_repair_remerge") + "/ck_tracked",
                          checkpoint_every=10**9, log_every=max(1, eval_every // 2), max_wall_clock_seconds=left)
        hist = train(model, part, cfg, device=device, start_step=local, resume_optimizer=opt)
        local += len(hist)
        entry["done"] = int(entry.get("done", 0)) + len(hist)
        s = score(model)
        r = rel_total(s, ref)
        tr = sum(hist) / max(1, len(hist))
        entry["evals"].append({"done": entry["done"], "train_mean": round(tr, 4), **{k: round(v, 4) for k, v in s.items()},
                               "rel": round(r, 5), "lr": lr})
        mark = ""
        if r < entry["best_rel"] - 1e-6:
            entry.update(best=s, best_rel=r, best_done=entry["done"], bad=0)
            best_state = copy.deepcopy({k: v.detach().to("cpu") for k, v in model.state_dict().items()})
            best_rel_session = r; mark = " ★ أفضل"
        else:
            entry["bad"] = int(entry.get("bad", 0)) + 1
        say(f"   خطوة {entry['done']}: تدريب(متوسط)={tr:.3f} | ميزان {fmt(s)} | نسبي {r:.4f}{mark}")
        if any(s[k] > ref[k] * (1 + rise) for k in ref if k in s):
            stop_reason = f"مهارة ساءت > {rise:.0%} عن المرجع"; break
        if entry["bad"] >= patience:
            stop_reason = f"لا تحسّن {patience} قياسات متتالية"; break
        if len(hist) < chunk:
            stop_reason = stop_reason or "انتهى وقت الجلسة"; break

    # الرجوع إلى أفضل أوزان رأيناها في هذه الجلسة (أو أوزان البداية إن لم يتحسن شيء)
    if best_rel_session < rel_total(score(model), ref) - 1e-9:
        model.load_state_dict({k: v.to(next(model.parameters()).device) for k, v in best_state.items()})
    early = stop_reason is not None and stop_reason.startswith(("مهارة", "لا تحسّن"))
    entry["finished"] = bool(early or int(entry["done"]) >= total)
    entry["stop"] = stop_reason or ("اكتمل" if entry["finished"] else "حد خطوات الجلسة")
    say(f"   نهاية الجلسة: {entry['stop']} — الأفضل عند الخطوة {entry.get('best_done')} ({fmt(entry['best'])})")
    return entry
