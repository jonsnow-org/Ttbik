# repair_remerge — أداة الاسترجاع والإصلاح وإعادة الدمج (إضافية، 2026-10-16)

- `sham_repair_remerge.py` — الأداة (تستورد دوال المهندس: sham_merge، sham_ci_merge.default_gate، train، checkpoint، sham_inputs).
- `sham_repair_remerge.ipynb` + `kernel-metadata.json` — دفتر كاكل `jonsnowjonsnow/sham-repair-remerge` (CPU).
- الناتج: `sham-repair-remerge-checkpoint/final_repair.pt` فقط (لا تكتب فوق final_merged.pt).
- اختبار جاف: `python sham_repair_remerge.py --selftest`.
- الإعدادات: SHAM_REPAIR_STEPS، SHAM_REPAIR_LR، SHAM_REPAIR_HOURS، SHAM_REPAIR_EXPLODE، SHAM_REPAIR_MAX_SOURCES.
