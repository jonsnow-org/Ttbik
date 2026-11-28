# %% [markdown]
# # N00 — العقد المجمَّد (Contract)
# يتحقق أن البنية التي سيُدرَّب عليها كل دفتر لاحق هي نفسها المجمَّدة، ويطبع الأحجام والعقد الخاص بالمرمّزات (صورة/صوت/فيديو).
# لا تدريب هنا. أي دفتر لاحق يفشل إن اختلف الـhash.

# %%
import json
import torch
from _common import ART, SMOKE
from qalam import Qalam
from qalam.config import FROZEN_HASH, base_config, config_hash, small_config

# %%
report = {}
for name, cfg in (("small", small_config()), ("base", base_config())):
    with torch.device("meta"):
        m = Qalam(cfg)
    report[name] = {"hash": config_hash(cfg), "frozen": FROZEN_HASH[name], "params": m.count_parameters(), "active_per_token": m.active_parameters_per_token(),
                    "vocab": cfg.vocab_size, "text_vocab": cfg.text_vocab, "max_seq": cfg.max_seq,
                    "codec_contract": {"image_patch": cfg.image_patch, "image_codes": cfg.image_codes, "audio_sample_rate": cfg.audio_sample_rate,
                                       "audio_frame_rate": cfg.audio_frame_rate, "audio_books": cfg.audio_books, "audio_codes": cfg.audio_codes,
                                       "video_stride": cfg.video_stride, "motion_codes": cfg.motion_codes}}
    assert report[name]["hash"] == report[name]["frozen"], f"{name}: the architecture changed — retraining everything is required"
print(json.dumps(report, indent=1))

# %%
from qalam import tools
report["tools"] = {"count": len(tools.REGISTRY), "groups": tools.GROUPS, "ids_available": base_config().tool_codes}
assert report["tools"]["count"] <= base_config().tool_codes
(ART / "contract.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
print("contract ok;", report["small"]["params"], "small /", report["base"]["params"], "base parameters;", report["tools"]["count"], "tools")
