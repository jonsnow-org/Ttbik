"""
Worked-solution problems for step-by-step reasoning ("التفكير المتسلسل") — teaching DATA, never answer rules.

Why: the verifiable-reward stage (sham_grpo) sleeps because Sham solves 0% of even "17 + 25" — it was never shown HOW.
A model this size does not discover column addition from web text; the published remedy (Nye et al. 2021 "scratchpads",
Wei et al. 2022 chain-of-thought) is to train on solutions that WRITE the intermediate steps, so the next token is always an
easy step instead of the final number in one jump. This module generates such solutions, fresh and never repeated:

    س: كم يساوي 47 + 38؟
    ج: نجمع الآحاد: 7 + 8 = 15، نكتب 5 ونحمل 1. نجمع العشرات: 4 + 3 + 1 = 8. الناتج: 85

Everything is checked exactly: each problem carries its true answer (computed from the same numbers), and the tests recompute
every solution independently. Nothing here answers anything at inference time: it is a curriculum the model trains on, and the
checkers only SCORE its own attempts. It stays OFF unless a session asks for it (SHAM_REASONING_SHARE > 0), so the owner's
rule "no answers by rules" is untouched by default.

Kinds: add / sub / mul / div, next-in-sequence, compare, two-step word problems, ordering (transitive logic), parity.
Languages: Arabic and English (the tokenizer is general; more languages are a template away).
"""

from __future__ import annotations

import random
import re

MARK_AR, MARK_EN = "الناتج:", "Answer:"
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
NAMES_AR = ["أحمد", "سعد", "خالد", "ليلى", "مريم", "يوسف", "نور", "هدى", "عمر", "سلمى", "فيصل", "رنا"]
NAMES_EN = ["Sam", "Lina", "Omar", "Maya", "Noor", "Ali", "Rita", "Zaid", "Hana", "Karim"]
ITEMS_AR = [("كتاباً", "الكتب"), ("قلماً", "الأقلام"), ("تفاحة", "التفاح"), ("بطاقة", "البطاقات"), ("حجراً", "الحجارة")]
ITEMS_EN = ["books", "pens", "apples", "cards", "stones"]


def _digits(n: int) -> list[int]:
    return [int(c) for c in str(n)]


def _add_steps(a: int, b: int, ar: bool) -> str:
    """Column addition written one column at a time, with the carry."""
    da, db = _digits(a)[::-1], _digits(b)[::-1]
    names_ar = ["الآحاد", "العشرات", "المئات", "الآلاف"]
    names_en = ["ones", "tens", "hundreds", "thousands"]
    carry, parts = 0, []
    for i in range(max(len(da), len(db))):
        x = da[i] if i < len(da) else 0
        y = db[i] if i < len(db) else 0
        s = x + y + carry
        expr = f"{x} + {y}" + (f" + {carry}" if carry else "")
        col = (names_ar if ar else names_en)[i]
        if s >= 10:
            if ar:
                parts.append(f"نجمع {col}: {expr} = {s}، نكتب {s % 10} ونحمل {s // 10}.")
            else:
                parts.append(f"Add the {col}: {expr} = {s}, write {s % 10} and carry {s // 10}.")
            carry = s // 10
        else:
            parts.append((f"نجمع {col}: {expr} = {s}." if ar else f"Add the {col}: {expr} = {s}."))
            carry = 0
    if carry:
        parts.append(f"يبقى الحمل {carry} فنكتبه." if ar else f"The leftover carry {carry} is written down.")
    return " ".join(parts)


def _final(ar: bool, value) -> str:
    return f"{MARK_AR if ar else MARK_EN} {value}"


def make_problem(rng: random.Random, ar: bool | None = None) -> dict:
    """{"question", "solution", "truth", "kind", "lang"} — the solution already ends with the final answer."""
    ar = (rng.random() < 0.75) if ar is None else ar
    kind = rng.choice(("add", "add", "sub", "mul", "mul", "div", "next", "cmp", "word", "word", "order", "parity", "seq"))
    q = s = ""
    truth: str | int = 0
    if kind == "add":
        a, b = rng.randint(2, 999), rng.randint(2, 999)
        truth = a + b
        q = f"كم يساوي {a} + {b}؟" if ar else f"What is {a} + {b}?"
        s = _add_steps(a, b, ar) + " " + _final(ar, truth)
    elif kind == "sub":
        a, b = rng.randint(20, 999), rng.randint(2, 999)
        a, b = max(a, b), min(a, b)
        truth = a - b
        t, o = (b // 10) * 10, b % 10
        if t and o:
            mid = a - t
            s = (f"{a} - {b} = ({a} - {t}) - {o} = {mid} - {o} = {truth}." if ar else
                 f"{a} - {b} = ({a} - {t}) - {o} = {mid} - {o} = {truth}.")
        else:
            s = f"{a} - {b} = {truth}."
        s += " " + _final(ar, truth)
        q = f"كم يساوي {a} - {b}؟" if ar else f"What is {a} - {b}?"
    elif kind == "mul":
        a = rng.randint(2, 99)
        b = rng.randint(2, 12) if rng.random() < 0.6 else rng.randint(11, 29)
        truth = a * b
        if b < 10:
            t, o = (a // 10) * 10, a % 10
            s = f"{a} × {b} = ({t} × {b}) + ({o} × {b}) = {t * b} + {o * b} = {truth}."
        else:
            t, o = (b // 10) * 10, b % 10
            s = f"{a} × {b} = ({a} × {t}) + ({a} × {o}) = {a * t} + {a * o} = {truth}."
        s += " " + _final(ar, truth)
        q = f"كم يساوي {a} × {b}؟" if ar else f"What is {a} × {b}?"
    elif kind == "div":
        b, truth = rng.randint(2, 12), rng.randint(2, 99)
        a = b * truth
        tens = (truth // 10) * 10
        rest = a - b * tens
        if tens:
            s = (f"{b} × {tens} = {b * tens}، والباقي {a} - {b * tens} = {rest}، و{b} × {truth % 10} = {rest}." if ar else
                 f"{b} × {tens} = {b * tens}, the rest is {a} - {b * tens} = {rest}, and {b} × {truth % 10} = {rest}.")
        else:
            s = f"{b} × {truth} = {a}."
        s += " " + _final(ar, truth)
        q = f"كم يساوي {a} ÷ {b}؟" if ar else f"What is {a} ÷ {b}?"
    elif kind == "next":
        n = rng.randint(1, 9999)
        truth = n + 1
        q = f"ما العدد الذي يلي {n}؟" if ar else f"What number comes right after {n}?"
        s = (f"العدد التالي هو {n} + 1 = {truth}." if ar else f"The next number is {n} + 1 = {truth}.") + " " + _final(ar, truth)
    elif kind == "cmp":
        a, b = rng.randint(2, 999), rng.randint(2, 999)
        if a == b:
            b += 1
        truth = max(a, b)
        q = f"أيهما أكبر: {a} أم {b}؟" if ar else f"Which is larger: {a} or {b}?"
        la, lb = len(str(a)), len(str(b))
        if la != lb:
            s = (f"{a} فيه {la} منازل و{b} فيه {lb}، والأكثر منازل أكبر." if ar else
                 f"{a} has {la} digits and {b} has {lb}; more digits means larger.")
        else:
            i = next(i for i in range(la) if str(a)[i] != str(b)[i])
            s = (f"نقارن من اليسار: أول رقمين مختلفين {str(a)[i]} و{str(b)[i]}، فالأكبر هو {truth}." if ar else
                 f"Compare from the left: the first different digits are {str(a)[i]} and {str(b)[i]}, so the larger is {truth}.")
        s += " " + _final(ar, truth)
    elif kind == "word":
        sub = rng.choice(("buy", "share", "total"))
        name = rng.choice(NAMES_AR if ar else NAMES_EN)
        if sub == "buy":
            a, b, c = rng.randint(5, 60), rng.randint(2, 40), rng.randint(1, 30)
            c = min(c, a + b - 1)
            truth = a + b - c
            if ar:
                _, plural = rng.choice(ITEMS_AR)
                q = f"لدى {name} {a} من {plural}، اشترى {b} أخرى ثم أعطى {c} لصديقه. كم بقي معه؟"
                s = f"{a} + {b} = {a + b}. ثم {a + b} - {c} = {truth}. {_final(True, truth)}"
            else:
                it = rng.choice(ITEMS_EN)
                q = f"{name} has {a} {it}, buys {b} more, then gives {c} to a friend. How many are left?"
                s = f"{a} + {b} = {a + b}. Then {a + b} - {c} = {truth}. {_final(False, truth)}"
        elif sub == "share":
            k, per = rng.randint(2, 9), rng.randint(2, 20)
            total = k * per
            truth = per
            if ar:
                _, plural = rng.choice(ITEMS_AR)
                q = f"وزّع {name} {total} من {plural} بالتساوي على {k} أشخاص. كم نصيب كل شخص؟"
                s = f"{total} ÷ {k} = {per}، لأن {k} × {per} = {total}. {_final(True, truth)}"
            else:
                it = rng.choice(ITEMS_EN)
                q = f"{name} shares {total} {it} equally among {k} people. How many does each get?"
                s = f"{total} ÷ {k} = {per}, because {k} × {per} = {total}. {_final(False, truth)}"
        else:
            k, per, extra = rng.randint(2, 9), rng.randint(3, 25), rng.randint(1, 30)
            truth = k * per + extra
            if ar:
                _, plural = rng.choice(ITEMS_AR)
                q = f"اشترى {name} {k} علب، في كل علبة {per} من {plural}، وأضاف {extra} أخرى. كم المجموع؟"
                s = f"{k} × {per} = {k * per}. ثم {k * per} + {extra} = {truth}. {_final(True, truth)}"
            else:
                it = rng.choice(ITEMS_EN)
                q = f"{name} buys {k} boxes with {per} {it} in each, and adds {extra} more. What is the total?"
                s = f"{k} × {per} = {k * per}. Then {k * per} + {extra} = {truth}. {_final(False, truth)}"
    elif kind == "order":
        pool = NAMES_AR if ar else NAMES_EN
        x, y, z = rng.sample(pool, 3)
        ask_longest = rng.random() < 0.5
        q = (f"{x} أطول من {y}، و{y} أطول من {z}. من الأطول؟" if ar else f"{x} is taller than {y}, and {y} is taller than {z}. Who is the tallest?")
        truth = x
        if not ask_longest:
            q = (f"{x} أطول من {y}، و{y} أطول من {z}. من الأقصر؟" if ar else f"{x} is taller than {y}, and {y} is taller than {z}. Who is the shortest?")
            truth = z
        s = f"{x} > {y} > {z}. " + _final(ar, truth)
    elif kind == "parity":
        n = rng.randint(1, 9999)
        truth = ("زوجي" if ar else "even") if n % 2 == 0 else ("فردي" if ar else "odd")
        q = f"هل العدد {n} زوجي أم فردي؟" if ar else f"Is {n} even or odd?"
        s = (f"ننظر إلى آخر رقم: {n % 10}. " if ar else f"Look at the last digit: {n % 10}. ") + _final(ar, truth)
    else:  # seq
        start, d, n = rng.randint(1, 50), rng.randint(2, 12), 4
        seq = [start + d * i for i in range(n)]
        truth = start + d * n
        shown = "، ".join(map(str, seq)) if ar else ", ".join(map(str, seq))
        q = f"ما العدد التالي في المتتالية: {shown}؟" if ar else f"What comes next in the sequence: {shown}?"
        s = (f"الفرق بين كل عددين {seq[1]} - {seq[0]} = {d}، فالتالي {seq[-1]} + {d} = {truth}. " if ar else
             f"The step is {seq[1]} - {seq[0]} = {d}, so the next is {seq[-1]} + {d} = {truth}. ") + _final(ar, truth)
    return {"question": q, "solution": s, "truth": str(truth), "kind": kind, "lang": "ar" if ar else "en"}


def check_final(text: str, truth: str) -> bool:
    """Right if the answer after the LAST «الناتج:» / «Answer:» marker is the truth. Without a marker: the first number
    written (the old GRPO rule), so existing callers keep working."""
    t = text.translate(_AR_DIGITS)
    idx = max(t.rfind(MARK_AR), t.rfind(MARK_EN))
    if idx >= 0:
        tail = t[idx:].split(":", 1)[1].strip()
        if str(truth).isdigit():
            nums = re.findall(r"\d+", tail)
            return bool(nums) and nums[0] == str(truth)
        return tail.startswith(str(truth)) or str(truth) in tail.split(".")[0]
    nums = re.findall(r"\d+", t)
    return bool(nums) and nums[0] == str(truth)


def reasoning_examples(encode, n: int, seed: int = 0, max_len: int = 384) -> list:
    """n chat-format examples (ids, labels) with labels only on the solution — the shape sham_chat uses."""
    from sham_chat import build_chat_example
    rng = random.Random(seed)
    out, seen = [], set()
    while len(out) < n and len(seen) < n * 20:
        p = make_problem(rng)
        if p["question"] in seen:
            continue
        seen.add(p["question"])
        out.append(build_chat_example(encode(p["question"]), encode(p["solution"]), max_len=max_len))
    return out


def share() -> float:
    import os
    try:
        return max(0.0, min(0.5, float(os.environ.get("SHAM_REASONING_SHARE", "0"))))
    except ValueError:
        return 0.0


if __name__ == "__main__":
    rng = random.Random(7)
    kinds, langs, seen = {}, {"ar": 0, "en": 0}, set()
    for _ in range(4000):
        p = make_problem(rng)
        kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
        langs[p["lang"]] += 1
        seen.add(p["question"])
        # the solution must end with the true answer, and the checker must accept it and reject a wrong one
        assert check_final(p["solution"], p["truth"]), p
        assert not check_final(p["solution"], p["truth"] + "9"), p
        # arithmetic is recomputed independently from the question text
        m = re.search(r"(\d+) ([+\-×÷]) (\d+)", p["question"])
        if m and p["kind"] in ("add", "sub", "mul", "div"):
            a, op, b = int(m.group(1)), m.group(2), int(m.group(3))
            want = {"+": a + b, "-": a - b, "×": a * b, "÷": a // b}[op]
            assert str(want) == p["truth"], p
            if op == "÷":
                assert a % b == 0
    assert set(kinds) == {"add", "sub", "mul", "div", "next", "cmp", "word", "order", "parity", "seq"}, kinds
    assert langs["ar"] > 2500 and langs["en"] > 600, langs
    assert len(seen) > 3500, "problems must be varied, not repeated"
    # the GRPO rule still works for plain answers
    assert check_final("42", "42") and not check_final("41", "42")
    # the first-number trap: a scratchpad full of numbers is judged by its FINAL answer only
    assert check_final("17 + 25 = 42. الناتج: ٤٢", "42") and not check_final("42 ... الناتج: 41", "42")
    print("sham_reasoning_data self-test OK:", kinds)
