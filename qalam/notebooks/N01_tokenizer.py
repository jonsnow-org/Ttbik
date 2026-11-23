# %% [markdown]
# # N01 — المرمّز (Byte-fallback BPE)
# مرمّز نص عربي/إنجليزي/شيفرة بـ8192 رمزًا؛ المعرّفات 0..255 هي البايتات الخام فلا يوجد رمز مجهول أبدًا (أي ملف أو شيفرة أو لغة قابلة للتمثيل).
# المخرج: `artifacts/tokenizer.json`. بيانات: ويكيبيديا (CC-BY-SA-4.0) وشيفرة مستودعنا. لا مخرجات نماذج تجارية.

# %%
from pathlib import Path
from _common import ART, ROOT, SMOKE, code_records, fetch_wikipedia
from qalam.config import base_config
from qalam.data import admit
from qalam.tokenizer import QalamTokenizer

ARTICLES = 60 if SMOKE else 20000          # per language
cfg = base_config()

# %%
ar = fetch_wikipedia("ar", ARTICLES)
en = fetch_wikipedia("en", ARTICLES)
code = code_records([ROOT.parent / "src", ROOT / "src"])
recs = [r for r in ar + en + code if admit(r)[0]]
print(len(ar), "ar,", len(en), "en,", len(code), "code files ->", len(recs), "admitted;", sum(len(r.text) for r in recs) // 1_000_000, "MB of text")

# %%
# the last 10% of each language is held out for the fertility check (never used to learn merges)
def split(rs, frac=0.1):
    k = max(1, int(len(rs) * frac))
    return rs[:-k], rs[-k:]
tr, held = [], []
for group in ([r for r in recs if r.lang == "ar"], [r for r in recs if r.lang == "en"], [r for r in recs if r.lang == "code"]):
    a, b = split(group)
    tr += a
    held += b
tok = QalamTokenizer.train((r.text for r in tr), vocab_size=cfg.text_vocab)
tok.check_contract(cfg)

# %%
fert = {lang: round(tok.fertility([r.text for r in held if r.lang == lang][:20]), 3) for lang in ("ar", "en", "code")}
print("tokens per UTF-8 byte on held-out text (1.0 = bytes only):", fert)
assert all(v < 0.8 for v in fert.values()), fert
for text in ("مرحبا بالعالم", "naïve café 😀", "def f(x):\n    return x\n", "\x00\xff binary-ish"):
    ids = tok.encode(text)
    assert tok.decode(ids) == text
print("round trips ok; byte ids first:", tok.encode("A") == [65])
tok.save(ART / "tokenizer.json")
import json
(ART / "tokenizer_report.json").write_text(json.dumps({"fertility": fert, "articles_per_language": ARTICLES, "vocab": tok.vocab_size}), encoding="utf-8")
