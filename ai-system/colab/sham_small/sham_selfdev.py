"""
One place that shows what every self-development method did this session
("🧬 التطوير الذاتي هذه الجلسة"). Each method records its own outcome here
(worked / accepted / rejected / asleep, with the numbers), and the chat
stage's final report — the one sent to Telegram — ends with the summary,
so the owner sees in one block which methods ran and whether they helped.

Methods that report here:
  دمج المعرفة (sham_merge)        كل مصدر: دُمج بنسبة كذا / رُفض
  الإصلاح قبل الدمج (sham_repair) ما أُصلح في كل مصدر، أو لماذا رُفض
  المكافأة الذاتية (sham_reward)   قُبلت / رُفضت، وخسارة التحقق قبل → بعد
  الاستدلال المتحقَّق (sham_grpo)   نائم (ونسبة الإصابة) / درّب / رُفض
  التصحيح الذاتي (sham_correct)    خسارة الإجابة بلا مسودة ↔ بعد مسودة معطوبة
  الربط التبايني (sham_link_contrast) عدد الدفعات ومتوسط الخسارة
"""

from __future__ import annotations

RECORD: list[tuple[str, str]] = []


def record(method: str, outcome: str) -> None:
    RECORD.append((method, " ".join(str(outcome).split())))


def summary() -> str:
    if not RECORD:
        return ""
    lines = ["🧬 التطوير الذاتي هذه الجلسة:"]
    for method, outcome in RECORD:
        lines.append(f"  • {method}: {outcome}")
    return "\n".join(lines)


if __name__ == "__main__":
    assert summary() == ""
    record("المكافأة الذاتية", "✅ قُبلت — 3 أزواج، خسارة التحقق 4.97 → 4.95")
    record("الاستدلال المتحقَّق", "نائم — إصابة 0%")
    s = summary()
    assert s.startswith("🧬") and s.count("•") == 2, s
    print(s)
    print("sham_selfdev self-test OK")
