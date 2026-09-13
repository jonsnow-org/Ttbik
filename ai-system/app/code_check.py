"""
Owner spec, 2026-09-13 ("المساعد الشخصي للمهام الصعبة... كتابة الاكواد
واصلاح الاخطاء"): the Dev Agent used to write a whole file from a model
and open a real PR with ZERO verification of any kind — the first thing
that ever looked at the generated code was Render's own deploy, live,
after the merge. This project already paid that price once for real (a
dependency pin took the service down with
"ModuleNotFoundError: No module named 'websockets.asyncio'"), so "the
model probably got it right" is not a check.

This module is that check, and it is deliberately the opposite kind of
thing from everything else in this project's AI path: pure Python
standard library, zero model calls, zero network, fully deterministic.
A model's opinion that code is fine is worth nothing here; `ast.parse`
either accepts the file or it does not.

Two real confidence tiers, on purpose — a false alarm that blocks a
GOOD change is its own kind of damage, so not every file type gets
treated as equally checkable:

  HARD (ok=False, refuses to ship): .py, .json, .ipynb, and .yml/.yaml
  when PyYAML is importable. These parsers are exact — if they reject
  the content, the file IS broken, with no judgement call involved.

  SOFT (ok=True plus a warning string the caller surfaces in the PR
  body): .ts/.js delimiter balance. Real reasoning for the difference:
  a JS/TS balance scan has to strip strings, template literals,
  comments AND regex literals to be correct, and regex detection is
  genuinely ambiguous in that grammar (`/` is division too). A wrong
  "unbalanced!" verdict would block a perfectly good change, which is
  worse than no check — and the real safety net for that side already
  exists anyway, since those files deploy through Vercel's own build,
  which fails loudly and visibly before anything reaches users. The
  live FastAPI service on Render has no equivalent gate, which is
  exactly why Python is in the HARD tier.

  JSX (.tsx/.jsx) is deliberately NOT in the soft tier — it is left
  unchecked instead. This is not caution for its own sake, it is a
  real measured result: running this scanner across all 237 real files
  in this repo flagged src/app/en/free-tools/image-optimizer/page.tsx,
  which is perfectly valid working code. JSX breaks the JS lexer
  assumptions in two unfixable-here ways — a closing tag `</div>`
  puts `/` exactly where a regex literal would start, and ordinary
  JSX prose ("Don't") puts an apostrophe exactly where a string would
  start. A checker that cries wolf on real working files is worse than
  no checker, so it says "not checked" and means it.

Anything else (.md, .sql, .txt, workflow-adjacent files without a YAML
parser available) returns ok=True with an honest "not checked" note
rather than pretending it was verified.
"""
import ast
import json
import logging

logger = logging.getLogger("nova")

# .tsx/.jsx deliberately absent — see this module's docstring for the
# real false positive that proved JSX cannot be lexed this way.
_JS_SUFFIXES = (".ts", ".js", ".mjs", ".cjs")

# A `/` starting a regex literal can only appear where a VALUE is
# expected, never where an operand just ended — so the previous
# non-space character decides it. This is the standard lexer heuristic,
# and it only ever affects the SOFT tier above (a miss downgrades to a
# warning, never a blocked change). `<` is NOT in this set even though
# a value may follow it: in practice it far more often precedes a `/`
# that closes a tag than one that opens a regex.
_REGEX_ALLOWED_PREV = set("(,=:[!&|?{};+-*%>~^\n")


def validate(path: str, content: str) -> tuple[bool, str]:
    """Returns (ok, message).

    ok=False  -> the file is definitively broken; the caller must NOT
                 open a PR with it.
    ok=True   -> safe to ship. `message` may still be non-empty: either
                 a soft warning worth putting in the PR body, or an
                 honest "this type isn't checked" note. Never treat a
                 non-empty message on ok=True as a failure.
    """
    # No blanket "empty means broken" rule here on purpose: an empty
    # file is genuinely valid for several real types (this project's own
    # ai-system/app/__init__.py is empty, and ast.parse accepts it) —
    # the sweep across this repo flagged exactly that file before this
    # was removed. "The model returned nothing" is a different failure
    # and is already caught by both callers before they ever get here.
    lower = path.lower()

    if lower.endswith(".py"):
        try:
            ast.parse(content)
        except SyntaxError as e:
            return False, f"خطأ نحوي في بايثون: {e.msg} (السطر {e.lineno})"
        return True, ""

    if lower.endswith(".ipynb"):
        try:
            notebook = json.loads(content)
        except Exception as e:
            return False, f"دفتر Jupyter غير صالح (JSON): {e}"
        if not isinstance(notebook.get("cells"), list):
            return False, "دفتر Jupyter بلا قائمة خلايا صالحة (cells)."
        for index, cell in enumerate(notebook["cells"]):
            if not isinstance(cell, dict) or "cell_type" not in cell or "source" not in cell:
                return False, f"الخلية رقم {index} في الدفتر ناقصة البنية (cell_type/source)."
        return True, ""

    if lower.endswith(".json"):
        try:
            json.loads(content)
        except Exception as e:
            return False, f"JSON غير صالح: {e}"
        return True, ""

    if lower.endswith((".yml", ".yaml")):
        try:
            import yaml
        except Exception:
            return True, "ملف YAML — لم يُفحص (مكتبة PyYAML غير متوفرة على هذا الخادم)."
        try:
            yaml.safe_load(content)
        except Exception as e:
            return False, f"YAML غير صالح: {e}"
        return True, ""

    if lower.endswith(_JS_SUFFIXES):
        problem = _unbalanced_delimiters(content)
        if problem:
            return True, f"تنبيه (لم يمنع الإرسال): {problem} — راجع الـPR بعينك قبل الدمج."
        return True, ""

    return True, "نوع ملف لا يملك فحصاً حتمياً هنا — لم يُفحص نحوياً."


def _strip_js_noise(content: str) -> tuple[str, str]:
    """Returns (code_without_noise, unterminated_problem).

    Removes comments, string/template literals and regex literals so
    only real code delimiters are left to count. Written as one explicit
    character scan rather than regexes because the whole point is to
    handle the cases regexes get wrong (escapes, nesting, a quote inside
    a comment, a brace inside a string).

    The second return value exists because of a real gap found while
    testing this against a deliberately truncated copy of this project's
    own src/lib/novaBotLogic.ts: the cut landed inside a string, so the
    scanner swallowed everything after it and the delimiter count came
    out clean — a badly truncated file looked fine. A string or block
    comment still open at EOF is itself strong evidence of exactly that,
    and truncation is the single most likely way a model-generated file
    goes wrong."""
    out = []
    i, n = 0, len(content)
    prev_significant = "\n"
    while i < n:
        ch = content[i]
        nxt = content[i + 1] if i + 1 < n else ""

        if ch == "/" and nxt == "/":
            while i < n and content[i] != "\n":
                i += 1
            continue

        if ch == "/" and nxt == "*":
            start_line = content.count("\n", 0, i) + 1
            i += 2
            while i < n and not (content[i] == "*" and i + 1 < n and content[i + 1] == "/"):
                i += 1
            if i >= n:
                return "".join(out), f"تعليق مفتوح في السطر {start_line} ولم يُغلق حتى نهاية الملف (الملف مبتور؟)"
            i += 2
            continue

        if ch in ("'", '"', "`"):
            quote = ch
            start_line = content.count("\n", 0, i) + 1
            i += 1
            closed = False
            while i < n:
                if content[i] == "\\":
                    i += 2
                    continue
                if content[i] == quote:
                    i += 1
                    closed = True
                    break
                i += 1
            if not closed:
                return "".join(out), f"نص بين علامتي {quote} فُتح في السطر {start_line} ولم يُغلق حتى نهاية الملف (الملف مبتور؟)"
            prev_significant = "x"
            continue

        if ch == "/" and prev_significant in _REGEX_ALLOWED_PREV:
            j = i + 1
            closed = False
            while j < n and content[j] != "\n":
                if content[j] == "\\":
                    j += 2
                    continue
                if content[j] == "/":
                    closed = True
                    break
                j += 1
            if closed:
                i = j + 1
                prev_significant = "x"
                continue

        out.append(ch)
        if not ch.isspace():
            prev_significant = ch
        elif ch == "\n":
            prev_significant = "\n"
        i += 1
    return "".join(out), ""


def _unbalanced_delimiters(content: str) -> str:
    """Returns a human-readable problem description, or "" when the
    delimiters balance. SOFT tier only — see this module's docstring."""
    code, unterminated = _strip_js_noise(content)
    if unterminated:
        return unterminated
    pairs = {")": "(", "]": "[", "}": "{"}
    openers = {"(": ")", "[": "]", "{": "}"}
    stack = []
    line = 1
    for ch in code:
        if ch == "\n":
            line += 1
        elif ch in openers:
            stack.append((ch, line))
        elif ch in pairs:
            if not stack:
                return f"قوس إغلاق '{ch}' بلا فتح مقابل (السطر {line})"
            opener, opened_line = stack.pop()
            if opener != pairs[ch]:
                return f"قوس '{opener}' المفتوح في السطر {opened_line} أُغلق بـ'{ch}' في السطر {line}"
    if stack:
        opener, opened_line = stack[-1]
        return f"قوس '{opener}' مفتوح في السطر {opened_line} ولم يُغلق"
    return ""
