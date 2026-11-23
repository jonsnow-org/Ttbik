# %% [markdown]
# # N03 — تدريب أولي للنص (الحجم الصغير، دورة كاملة)
# يدرّب `small` (38M) على البيانات المعبّأة بخسارة مشتركة: سببية + كتلة انتشار T-LDM + توازن الخبراء، مع **جدول وزن للكاتب** (يبدأ عاليًا لأن الكاتب يتأخر في التعلم ثم ينزل إلى 0.15).
# الخروج: نقطة تدريب ذرّية بسلالة، وتقرير حيرة المحجوز قبل/بعد. هذا الدفتر نفسه يُشغَّل بحجم `base` على المدرّب حين تتوفر حوسبة.

# %%
import json, math, random, time
import torch
from _common import ART, SMOKE
from qalam import Qalam
from qalam.checkpoint import save_checkpoint
from qalam.config import FROZEN_HASH, config_hash, small_config
from qalam.training import joint_loss

cfg = small_config()
assert config_hash(cfg) == FROZEN_HASH["small"]
STEPS = 25 if SMOKE else 20000
BATCH = 6 if SMOKE else 16
torch.manual_seed(0); random.seed(0)
train = torch.load(ART / "packed_train.pt")
held = torch.load(ART / "packed_held.pt")
model = Qalam(cfg)
opt = torch.optim.AdamW(model.parameters(), lr=1e-3 if SMOKE else 3e-4, betas=(0.9, 0.95), weight_decay=0.1)

def tldm_weight(step: int) -> float:
    """3.0 early (the diffusion writer learns late), falling to 0.15 by 30% of training."""
    f = min(1.0, step / max(1, 0.3 * STEPS))
    return 3.0 + (0.15 - 3.0) * f

def lr_at(step: int) -> float:
    warm = max(1, int(0.05 * STEPS))
    base = 1e-3 if SMOKE else 3e-4
    return base * (step + 1) / warm if step < warm else base * (0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * (step - warm) / max(1, STEPS - warm))))

@torch.no_grad()
def held_loss() -> float:
    model.eval()
    ids, seg, lm = held["ids"][:8], held["segments"][:8], held["loss_mask"][:8]
    logits, _ = model(ids[:, :-1], segments=seg[:, :-1])
    per = torch.nn.functional.cross_entropy(logits.reshape(-1, logits.shape[-1]).float(), ids[:, 1:].reshape(-1), reduction="none")
    w = ((seg[:, 1:] >= 0) & (lm[:, 1:] > 0)).reshape(-1).float()
    model.train()
    return float((per * w).sum() / w.sum())

# %%
before = held_loss()
print(f"held-out loss before: {before:.3f} (perplexity {math.exp(before):.0f}; uniform would be {cfg.vocab_size})")
n = train["ids"].shape[0]
log = []
t0 = time.time()
model.train()
for step in range(STEPS):
    for g in opt.param_groups:
        g["lr"] = lr_at(step)
    idx = torch.randint(0, n, (BATCH,))
    ids, seg, lm = train["ids"][idx], train["segments"][idx], train["loss_mask"][idx]
    opt.zero_grad(set_to_none=True)
    loss, info = joint_loss(model, ids, tldm_weight=tldm_weight(step), segments=seg, loss_mask=lm * (seg >= 0))
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    opt.step()
    log.append(info | {"loss": float(loss.detach()), "step": step})
    if step % 5 == 0:
        print(f"step {step:4d} causal {info['causal']:.3f} tldm {info['tldm']:.3f} aux {info['aux']:.2f} cycles {info['cycles']} ({time.time() - t0:.0f}s)")
after = held_loss()
print(f"held-out loss after: {after:.3f} (perplexity {math.exp(after):.0f})")

# %%
assert after < before, "training did not reduce the held-out loss"
sha = save_checkpoint(ART / "ckpt_small_n03.pt", model, STEPS, parent_sha=None, meta={"config_hash": config_hash(cfg), "notebook": "N03", "held_before": before, "held_after": after, "smoke": SMOKE})
(ART / "n03_report.json").write_text(json.dumps({"held_before": before, "held_after": after, "steps": STEPS, "sha256": sha, "seconds": time.time() - t0}), encoding="utf-8")
print("checkpoint", sha[:12])
