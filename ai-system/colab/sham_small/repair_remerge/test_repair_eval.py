"""اختبار CPU صغير (بلا شبكة) للإصلاح المراقَب: تتبّع الميزان، الاحتفاظ بالأفضل/التوقف المبكر، والاستئناف عبر الجلسات.
    python repair_remerge/test_repair_eval.py"""
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent)); sys.path.insert(0, str(HERE))
os.environ.setdefault("SHAM_REPAIR_TRACKED", "1")
import torch  # noqa: E402
from model import ShamSmall, ShamSmallConfig  # noqa: E402
import repair_eval as RE  # noqa: E402
from sham_merge import batches_loss  # noqa: E402

torch.manual_seed(0)
cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=64)
ids = torch.randint(0, 300, (4, 32))
teacher = ShamSmall(cfg)
with torch.no_grad():
    good_labels = teacher(ids)[0].argmax(-1)
gate = {"text": [(ids, good_labels)]}
score = lambda m: {k: batches_loss(m, v, "cpu") for k, v in gate.items()}
log = []
say = lambda s: (print(s), log.append(s))
kw = dict(device="cpu", seconds=600, say=say, grad_accum=2, batch_size=4, seq_len=32, eval_every=5, warmup=2)

# 1) بيانات «جيدة» (نفس توزيع الميزان): الميزان ينخفض، والأفضل يُتتبّع، وكل قياس مسجّل مع متوسط التدريب
m = ShamSmall(cfg); e = {}
s_before = score(m)["text"]
RE.tracked_repair(m, [(ids, good_labels)] * 200, score, e, lr=3e-3, session_steps=20, total_steps=40, **kw)
assert len(e["evals"]) == 4 and all("train_mean" in x and "text" in x for x in e["evals"]), e["evals"]
assert e["best"]["text"] < s_before and abs(score(m)["text"] - e["best"]["text"]) < 1e-5, (s_before, e)
assert e["done"] == 20 and not e["finished"], e
print("✓ تتبّع الميزان: ", s_before, "→", e["best"]["text"])

# 2) الاستئناف: جلسة ثانية تبدأ من done=20 وتكمل إلى 40 بنفس المرجع (ref) — عبر JSON كما في repair_state.json
e2 = json.loads(json.dumps(e)); ref0 = dict(e2["ref"])
RE.tracked_repair(m, [(ids, good_labels)] * 200, score, e2, lr=3e-3, session_steps=20, total_steps=40, **kw)
assert e2["ref"] == ref0 and e2["done"] == 40 and e2["finished"] and e2["stop"] == "اكتمل", e2
assert [x["done"] for x in e2["evals"]] == [5, 10, 15, 20, 25, 30, 35, 40], e2["evals"]
print("✓ الاستئناف: 20 → 40 بنفس المرجع")

# 3) بيانات «سيئة» (توزيع مختلف عن الميزان): الميزان يرتفع ⇒ توقف مبكر والرجوع إلى أوزان البداية
m3 = ShamSmall(cfg); m3.load_state_dict(m.state_dict()); e3 = {}
start = score(m3)["text"]
bad = [(ids, torch.randint(0, 300, (4, 32))) for _ in range(400)]
RE.tracked_repair(m3, bad, score, e3, lr=3e-3, session_steps=100, total_steps=100, **kw)
assert e3["finished"] and e3["done"] < 100 and e3["stop"] != "اكتمل", e3
assert abs(score(m3)["text"] - start) < 1e-5 and e3["best_done"] == 0, (start, score(m3), e3)
print(f"✓ التوقف المبكر بعد {e3['done']} خطوة ({e3['stop']}) والرجوع إلى الأفضل")

# 4) خريطة المعدّل لكل مسار مطابقة لمعدّلات المهندس
assert RE.lr_for("sham-multimodal-checkpoint") == 1e-4 and RE.lr_for("sham-chat-checkpoint") == 5e-5
assert RE.lr_for("sham-crawl-checkpoint") == 5e-5

# 5) الأداة كاملة (run) بالوضع المراقَب: جلستان، الأولى تقف عند حد الجلسة وتنشر .ckpt، والثانية تستأنف وتدمج
import sham_repair_remerge as R  # noqa: E402
from checkpoint import save_checkpoint  # noqa: E402
td = Path(tempfile.mkdtemp()); R.WORK, R.OUT = td / "work", td / "out"
tok = HERE.parent / "sham_general_tokenizer.json"
base, src = ShamSmall(cfg), ShamSmall(cfg)
d = {}
for name, mm, fn in ((R.BASE_DS, base, R.BASE_FILE), ("sham-multimodal-checkpoint", src, "final_multimodal.pt")):
    (td / name).mkdir(); save_checkpoint(td / name / fn, mm, 7); shutil.copy(tok, td / name / "sham_small_tokenizer.json"); d[name] = td / name
pubs = []
def publish(up, name, msg):
    snap = td / f"pub{len(pubs)}"; shutil.copytree(up, snap); pubs.append(sorted(p.name for p in snap.iterdir())); d[R.OWN] = snap
    return name
fetch = lambda n: (shutil.copytree(d[n], td / f"f_{n}_{time.time_ns()}") if n in d else None)
gb = lambda m, t, b, dev: {"text": [(ids, good_labels)]}
db = lambda m, t, h, n, seed: [(ids, good_labels)] * n
srcs = [("sham-multimodal-checkpoint", "final*.pt", [(0, 42256)])]
R.SESSION_STEPS = 10; R.TRACKED_STEPS = 20
import repair_eval
repair_eval.SESSION_STEPS = 10; repair_eval.TRACKED_STEPS = 20; repair_eval.EVAL_EVERY = 5
runs = []
for i in range(6):
    r = R.run(fetch=fetch, publish=publish, gate_builder=gb, data_builder=db, sources=srcs, hours=2)
    runs.append(r)
    if r["state"]["sources"].get("sham-multimodal-checkpoint", {}).get("status") == "repaired":
        break
st = runs[-1]["state"]
assert st["base_repair"]["mode"] == "tracked" and st["base_repair"]["status"] in ("adopted", "kept_original"), st["base_repair"]
ss = st["sources"]["sham-multimodal-checkpoint"]
assert ss["status"] == "repaired" and ss["done"] == 20 and len(ss["evals"]) == 4, ss
assert any("⏸" in l for l in runs[0]["log"]), runs[0]["log"]          # الجلسة الأولى أُجّلت (حد خطوات الجلسة)
print(f"✓ run(): {len(runs)} جلسات، الأساس {st['base_repair']['status']}، المصدر done={ss['done']} best@{ss['best_done']}")
print("test_repair_eval OK")
