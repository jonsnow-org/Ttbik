"""Writes eval/arabic_code_tasks.jsonl: coding tasks phrased in Arabic, each with a reference solution and assert-based tests.
The reference solutions are executed when this file runs, so a broken task can never enter the eval set."""
import json
import subprocess
import sys
from pathlib import Path

T = [
    ("ar_001", "اكتب دالة `is_palindrome_ar(s)` تُرجع True إذا كان النص العربي متناظراً بعد حذف المسافات والتشكيل (الحركات U+064B إلى U+0652).",
     "import re\ndef is_palindrome_ar(s):\n    t = re.sub(r'[\\u064B-\\u0652\\s]', '', s)\n    return t == t[::-1]",
     "assert is_palindrome_ar('سلس')\nassert is_palindrome_ar('سَ ل سُ')\nassert not is_palindrome_ar('كتاب')"),
    ("ar_002", "اكتب دالة `to_western_digits(s)` تحوّل الأرقام العربية المشرقية (٠-٩) في النص إلى أرقام غربية (0-9) وتترك باقي النص كما هو.",
     "def to_western_digits(s):\n    return s.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789'))",
     "assert to_western_digits('رقم ١٢٣') == 'رقم 123'\nassert to_western_digits('abc') == 'abc'"),
    ("ar_003", "اكتب دالة `chunk(lst, n)` تقسم القائمة إلى أجزاء طول كل منها n (الجزء الأخير قد يكون أقصر). إذا كان n أقل من 1 ارفع ValueError.",
     "def chunk(lst, n):\n    if n < 1:\n        raise ValueError('n')\n    return [lst[i:i+n] for i in range(0, len(lst), n)]",
     "assert chunk([1,2,3,4,5], 2) == [[1,2],[3,4],[5]]\nassert chunk([], 3) == []\ntry:\n    chunk([1], 0); assert False\nexcept ValueError: pass"),
    ("ar_004", "أصلح الخطأ في الدالة التالية التي يُفترض أن تُرجع متوسط القائمة، و0 إذا كانت فارغة:\n```python\ndef mean(xs):\n    return sum(xs) / len(xs) - 1\n```\nاكتب الدالة المصححة `mean`.",
     "def mean(xs):\n    return sum(xs) / len(xs) if xs else 0",
     "assert mean([2,4]) == 3\nassert mean([]) == 0"),
    ("ar_005", "اكتب دالة `word_freq(text)` تُرجع قاموساً بعدد تكرار كل كلمة في نص عربي، مع تجاهل علامات الترقيم العربية (، ؛ ؟) والإنجليزية.",
     "import re\nfrom collections import Counter\ndef word_freq(text):\n    return dict(Counter(re.findall(r'[^\\s\\.,;:!?،؛؟]+', text)))",
     "assert word_freq('مرحبا، مرحبا يا عالم؟') == {'مرحبا': 2, 'يا': 1, 'عالم': 1}"),
    ("ar_006", "اكتب دالة `parse_duration(s)` تقرأ مدة مثل '1h30m' أو '45s' أو '2h' وتُرجع عدد الثواني. ارفع ValueError للصيغة غير الصحيحة.",
     "import re\ndef parse_duration(s):\n    m = re.fullmatch(r'(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?', s)\n    if not s or not m:\n        raise ValueError(s)\n    h, mi, se = (int(x or 0) for x in m.groups())\n    return h*3600 + mi*60 + se",
     "assert parse_duration('1h30m') == 5400\nassert parse_duration('45s') == 45\nassert parse_duration('2h') == 7200\ntry:\n    parse_duration('abc'); assert False\nexcept ValueError: pass"),
    ("ar_007", "اكتب دالة `merge_intervals(iv)` تدمج الفترات المتداخلة في قائمة من الأزواج [بداية، نهاية] وتُرجعها مرتبة.",
     "def merge_intervals(iv):\n    out = []\n    for a, b in sorted(iv):\n        if out and a <= out[-1][1]:\n            out[-1][1] = max(out[-1][1], b)\n        else:\n            out.append([a, b])\n    return out",
     "assert merge_intervals([[1,3],[2,6],[8,10]]) == [[1,6],[8,10]]\nassert merge_intervals([]) == []\nassert merge_intervals([[5,6],[1,2]]) == [[1,2],[5,6]]"),
    ("ar_008", "اكتب دالة `slugify_ar(title)` تحوّل عنواناً (عربي أو إنجليزي) إلى slug: أحرف صغيرة، المسافات تصبح '-'، تُحذف الرموز غير الحرفية والرقمية، وتُدمج الشرطات المتتالية.",
     "import re\ndef slugify_ar(title):\n    t = re.sub(r'[^\\w\\s-]', '', title.lower(), flags=re.U)\n    return re.sub(r'[\\s_-]+', '-', t).strip('-')",
     "assert slugify_ar('Hello World!') == 'hello-world'\nassert slugify_ar('مرحبا  بالعالم') == 'مرحبا-بالعالم'"),
    ("ar_009", "اكتب دالة `retry(fn, attempts)` تستدعي fn حتى تنجح أو تنفد المحاولات، وتُرجع قيمتها، وإذا فشلت كل المحاولات ترفع آخر استثناء.",
     "def retry(fn, attempts):\n    last = None\n    for _ in range(attempts):\n        try:\n            return fn()\n        except Exception as e:\n            last = e\n    raise last",
     "n = {'c': 0}\ndef f():\n    n['c'] += 1\n    if n['c'] < 3: raise RuntimeError('x')\n    return 'ok'\nassert retry(f, 5) == 'ok'\ntry:\n    retry(lambda: 1/0, 2); assert False\nexcept ZeroDivisionError: pass"),
    ("ar_010", "اكتب دالة `lru_get(cache, key, loader, cap)` حيث cache من نوع OrderedDict: إن وُجد المفتاح انقله للنهاية وأرجع قيمته، وإلا حمّله بـ loader(key) وأضفه واحذف الأقدم إذا تجاوز الحجم cap.",
     "def lru_get(cache, key, loader, cap):\n    if key in cache:\n        cache.move_to_end(key)\n        return cache[key]\n    v = loader(key)\n    cache[key] = v\n    if len(cache) > cap:\n        cache.popitem(last=False)\n    return v",
     "from collections import OrderedDict\nc = OrderedDict()\nfor k in 'abc': lru_get(c, k, str.upper, 2)\nassert list(c) == ['b','c']\nlru_get(c, 'b', str.upper, 2)\nassert list(c) == ['c','b']"),
    ("ar_011", "أصلح الدالة التالية لكي تُرجع أكبر عنصرين مختلفين بترتيب تنازلي (أو أقل إن لم يتوفر):\n```python\ndef top2(xs):\n    return sorted(xs)[:2]\n```",
     "def top2(xs):\n    return sorted(set(xs), reverse=True)[:2]",
     "assert top2([3,1,3,2]) == [3,2]\nassert top2([5]) == [5]\nassert top2([]) == []"),
    ("ar_012", "اكتب دالة `validate_sa_phone(s)` تتحقق من رقم جوال سعودي بصيغة 05XXXXXXXX أو +9665XXXXXXXX (X رقم) وتُرجع True/False.",
     "import re\ndef validate_sa_phone(s):\n    return bool(re.fullmatch(r'(?:05|\\+9665)\\d{8}', s))",
     "assert validate_sa_phone('0512345678')\nassert validate_sa_phone('+966512345678')\nassert not validate_sa_phone('0612345678')\nassert not validate_sa_phone('05123')"),
]

out = Path(__file__).with_name("arabic_code_tasks.jsonl")
bad = 0
with out.open("w") as f:
    for tid, prompt, sol, tests in T:
        r = subprocess.run([sys.executable, "-c", sol + "\n" + tests], capture_output=True, text=True, timeout=20)
        if r.returncode != 0:
            bad += 1
            print("BROKEN", tid, r.stderr[-400:])
            continue
        f.write(json.dumps({"id": tid, "prompt_ar": prompt, "solution": sol, "tests": tests}, ensure_ascii=False) + "\n")
print(f"{len(T) - bad}/{len(T)} tasks written to {out.name}")
sys.exit(1 if bad else 0)
