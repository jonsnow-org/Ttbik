# %% [markdown]
# # N02 — البيانات: القبول، إزالة التكرار، فحص التسرّب، التعبئة
# كل سجل له مصدر ورخصة وتصنيف أصل؛ ما هو مخرج نموذج تجاري أو فيه بريد/مفتاح/رقم بطاقة يُرفض. المحجوز لا يشترك مع التدريب بأي نافذة من 8 كلمات.
# المخرج: `artifacts/packed_train.pt` و`packed_held.pt` (صفوف طولها seq+1، مع `segments` و`loss_mask`).

# %%
import hashlib
import torch
from _common import ART, ROOT, SMOKE, code_records, fetch_wikipedia
from qalam.config import small_config
from qalam.data import admit, dedup, leak_report, pack
from qalam.tokenizer import QalamTokenizer

ARTICLES = 60 if SMOKE else 20000
SEQ = 256 if SMOKE else 2048
cfg = small_config()
tok = QalamTokenizer.load(ART / "tokenizer.json")
tok.check_contract(cfg)

# %%
raw = fetch_wikipedia("ar", ARTICLES) + fetch_wikipedia("en", ARTICLES) + code_records([ROOT.parent / "src", ROOT / "src"])
rejected = {}
ok = []
for r in raw:
    good, why = admit(r)
    if good:
        ok.append(r)
    else:
        rejected[why] = rejected.get(why, 0) + 1
kept, removed = dedup(ok)
print(len(raw), "raw ->", len(ok), "admitted ->", len(kept), "after dedup (", removed, "duplicates ); rejected:", rejected)

# %%
# held-out by document hash (stable): about 5% of documents, then REMOVE from training any training document that shares an 8-word window with them
def is_held(r) -> bool:
    return int(hashlib.sha256(r.source.encode()).hexdigest(), 16) % 20 == 0
held = [r for r in kept if is_held(r)]
train = [r for r in kept if not is_held(r)]
rep = leak_report(train, held)
held = [r for i, r in enumerate(held) if i not in set(rep["leaked"])]
rep2 = leak_report(train, held)
print("held-out", len(held), "documents; leaked and dropped:", len(rep["leaked"]), "-> leaks now:", len(rep2["leaked"]))
assert rep2["leaked"] == [] and held and train

# %%
def to_docs(rs):
    return [tok.encode(r.text) for r in rs]
ptrain = pack(cfg, to_docs(train), SEQ)
pheld = pack(cfg, to_docs(held), SEQ)
tokens = int((ptrain["segments"] >= 0).sum())
print("train rows", tuple(ptrain["ids"].shape), "=", tokens, "tokens;", "held rows", tuple(pheld["ids"].shape))
torch.save(ptrain, ART / "packed_train.pt")
torch.save(pheld, ART / "packed_held.pt")
import json
(ART / "data_report.json").write_text(json.dumps({"raw": len(raw), "admitted": len(ok), "after_dedup": len(kept), "rejected": rejected, "train_docs": len(train), "held_docs": len(held),
                                                    "leaks": len(rep2["leaked"]), "train_tokens": tokens, "seq": SEQ}), encoding="utf-8")
