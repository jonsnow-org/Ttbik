"""
Owner spec, 2026-09-12 ("نريد ان نجعله حر آليا ولكن مقيد بأوامر وقوانين
لايتخطاها... مثلا كان يتجنب نشر كلمات مرور"): the ONE real chokepoint
every piece of knowledge Nova ever stores — and therefore ever
eventually trains its own weights on, via merge_and_finetune.ipynb's
cell 4ب — passes through. Two callers use this exact same function,
never two copies of the same rule:
  - rag.py's _store_knowledge (the existing REACTIVE path: live since
    2026-09-08, fires whenever a real user's question needs a live
    web search).
  - scripts/gather_knowledge.py (the new PROACTIVE path: this project's
    own automatic, scheduled self-feeding — see that script's own
    module docstring).

Deliberately dependency-free (Python stdlib `re` only) so both a heavy
FastAPI process (rag.py, running on Render) and a lightweight,
standalone script (running on a bare GitHub Actions runner with no
project dependencies installed) can import this identically — the same
rule enforced in both places by construction, not by convention or a
second copy someone forgets to update.

Honest limitation, stated plainly rather than hidden: this is a real,
pattern-based filter, not a model asked nicely to "please don't store
secrets" (a model can be wrong, or talked out of it) — but no fixed set
of regexes can catch every possible shape a secret could take. This is
a real, meaningful floor against the common, recognizable cases
(password= lines, API keys, private key blocks, card numbers) — not a
guarantee against every conceivable one.
"""
import re

_SECRET_PATTERNS = [
    # "password: xxxx" / "كلمة السر: xxxx" / "كلمة المرور= xxxx" style lines
    re.compile(r"(?i)\b(password|passwd|pwd|كلمة\s*(?:ال)?سر|كلمة\s*(?:ال)?مرور)\b\s*[:=]\s*\S+"),
    # generic API key / secret / token assignment
    re.compile(r"(?i)\b(api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|bearer)\b\s*[:=]\s*\S+"),
    # AWS access key id (a real, fixed, well-known shape)
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    # PEM private key blocks
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
    # a long hex/base64-looking token immediately following a
    # credential-sounding word — catches many API-key/token shapes the
    # patterns above don't name explicitly (e.g. "ghp_...", "sk-...").
    re.compile(r"(?i)\b(token|secret|key|password)\b[^\n]{0,20}[:=]\s*[A-Za-z0-9_\-]{20,}"),
    # credit-card-shaped digit sequences (13-19 digits, optional
    # spaces/dashes) — real financial data, not a guess at a format.
    re.compile(r"\b(?:\d[ -]?){13,19}\b"),
]

_REDACTED_MARKER = "[تمت إزالة معلومة حساسة محتملة]"
_MIN_USEFUL_LENGTH = 10


def sanitize_for_storage(text: str) -> str | None:
    """Returns text with every matched secret-shaped substring replaced
    by a fixed marker, or None if what remains afterward is too thin to
    be worth storing at all (e.g. the entire input WAS the secret).
    Call this on anything before it is written to Nova's knowledge bank
    (NovaKnowledgeEntry) — reactive or proactive, no exceptions."""
    if not text or not text.strip():
        return None
    cleaned = text
    for pattern in _SECRET_PATTERNS:
        cleaned = pattern.sub(_REDACTED_MARKER, cleaned)
    if len(cleaned.strip()) < _MIN_USEFUL_LENGTH:
        return None
    return cleaned
