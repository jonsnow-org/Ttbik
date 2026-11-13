"""Plain-Arabic summary of a merge run (owner's order 2026-11-13). No heavy imports: tests and other tools can load it freely."""
import re


_SKILL_AR = {"text": "النص", "chat": "المحادثة", "media": "الوسائط", "image": "الصور", "audio": "الصوت", "general": "النص العام", "code": "البرمجة"}
_SRC_AR = (("chat-arabic-sft", "محادثة عربية موجَّهة"), ("chat", "المحادثة"), ("multimodal", "الوسائط المتعددة"), ("crawl", "ما جمعه الزاحف من الإنترنت"),
           ("research", "البحث"), ("cpu-track", "مسار CPU العام"), ("agent", "الوكيل والأدوات"), ("lightning", "مدرّب Lightning"))


def _skill(k: str) -> str:
    return _SKILL_AR.get(k, k)


def _src_hint(name: str) -> str:
    for key, ar in _SRC_AR:
        if key in name:
            return f" ({ar})"
    return ""


def _pct(a: float, b: float) -> float:
    return (b / a - 1) * 100 if a else 0.0


def _plain_change(a: float, b: float) -> str:
    """Loss a -> b in words: lower loss = better."""
    d = _pct(a, b)
    if abs(d) < 0.05:
        return "بلا تغيير"
    return f"{'تحسّن' if d < 0 else 'تراجع'} {abs(d):.1f}%"


def plain_summary(label: str, step: int, before: dict, after: dict, report: list, published=None) -> str:
    """The merge notice in words (owner's order 2026-11-13: «I do not understand numbers; say what succeeded and by how much»). Built only from the same numbers
    the detailed lines carry: lower loss means a better model, so a fall is an improvement."""
    cur = dict(before)
    acc, rej, broken = [], [], []
    for l in report:
        m = re.match(r"✅ (\S+) \(خطوة ([\d,]+)\): دُمج بنسبة ([\d.]+) — (.*)$", l)
        if m:
            sc = {k: float(v) for k, v in re.findall(r"(\w+)=([\d.]+)", m.group(4))}
            ch = ", ".join(f"{_skill(k)}: {_plain_change(cur[k], sc[k])}" for k in sc if k in cur)
            acc.append(f"• {m.group(1)}{_src_hint(m.group(1))}: قُبل بنسبة {float(m.group(3)) * 100:.0f}% — {ch}")
            cur.update(sc)
            continue
        m = re.match(r"❌ (\S+) \(خطوة ([\d,]+)\): لم يُدمج.*?أقرب محاولة \(نسبة ([\d.]+)\): (.*?) — المنحنى", l)
        if m:
            moves = re.findall(r"(\w+) [\d.]+→[\d.]+ \(([+-][\d.]+)%\)", m.group(4))
            worse = [f"{_skill(k)} {abs(float(v)):.1f}%" for k, v in moves if float(v) > 0.05]
            better = [f"{_skill(k)} {abs(float(v)):.1f}%" for k, v in moves if float(v) < -0.05]
            why = ("ساءت " + " و".join(worse)) if worse else "لم يُحسّن شيئًا"
            if better:
                why += " مقابل تحسّن " + " و".join(better)
            rej.append(f"• {m.group(1)}{_src_hint(m.group(1))}: رُفض — {why} حتى في أخف نسبة")
            continue
        m = re.match(r"📏 (\S+) \(خطوة [\d,]+\) وحده على الميزان: (.*?) \| الأساس", l)
        if m:
            sc = {k: float(v) for k, v in re.findall(r"(\w+)=([\d.]+)", m.group(2))}
            if sc.get("chat", 0) > before.get("chat", 1) * 3 or sc.get("text", 0) > before.get("text", 1) * 2:
                broken.append(m.group(1))
    lines = ["🧩 الدمج بالكلمات", f"الأساس: {label} (خطوة {step:,})"]
    if published:
        tot = "، ".join(f"{_skill(k)}: {_plain_change(before[k], after[k])}" for k in before if k in after)
        lines.append("الحصيلة الكلية على الرأس: " + tot)
    else:
        lines.append("الحصيلة: لا نسخة جديدة نُشرت (الرأس كما هو).")
    lines.append(f"المقبول ({len(acc)}):" + ("" if acc else " لا شيء"))
    lines.extend(acc)
    lines.append(f"المرفوض ({len(rej)}):" + ("" if rej else " لا شيء"))
    lines.extend(rej)
    if broken:
        lines.append("تالفة أو بعيدة جدًا (لا تصلح للدمج): " + "، ".join(broken))
    lines.append("(الخسارة: كلما صغر الرقم كان النموذج أفضل؛ التحسّن = نزول الرقم)")
    return "\n".join(lines)
