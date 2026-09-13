"""Grammar In The Arabic Language – Structured Overview for Nova AI"""

from __future__ import annotations
import re
from typing import Dict, List, Optional, Tuple

# Static representation of key Arabic grammar rules.
# Source: Studio Arabiya’s online guide “Grammar In The Arabic Language” (Sep 27 2024)
GRAMMAR_RULES: Dict[str, Dict[str, str]] = {
    "المفردات": {
        "الإعراب": "الكلمة تتخذ إعراباً حسب موقعها في الجملة: رفع، نصب، جر، جزم.",
        "الأنواع": "اسم، فعل، حرف.",
    },
    "الأسماء": {
        "النوع": "مذكر، مؤنث.",
        "العدد": "مفرد، مثنى، جمع (مذكر سالم، مؤنث سالم، جمع تكسير).",
        "الإضافة": "الإضافة تُظهر علاقة الملكية أو التخصيص بين اسمين.",
    },
    "الأفعال": {
        "الأزمنة": "الماضي، المضارع، الأمر.",
        "الصيغ": "صيغ ثلاثية، رباعية، خماسية، سداسية، سباعية.",
        "الضمائر": "ضمائر الفاعل والموصوف (أنا، أنتَ، هو، هي، نحن، أنتم، هم).",
    },
    "الحروف": {
        "حروف الجر": "من، إلى، على، في، عن، ... تُجرّ المجرور.",
        "حروف العطف": "و، ف، ثم، أو، أم، ... تربط بين الكلمات أو الجمل.",
    },
    "الجملة": {
        "أنواع الجملة": "جملة اسمية (مبتدأ+خبر) وجملة فعلية (فعل+فاعل).",
        "التعريف والتنكير": "استخدام اللام التعريفية و(ـ) النكرة.",
        "الأحوال": "حال، صفة، ظرف.",
    },
    "التنوين": {
        "أنواعه": "تنوين الفتح (ً), تنوين الضم (ٌ), تنوين الكسر (ٍ).",
        "قواعده": "يُكتب على الحرف الأخير من الكلمة غير المعرفة.",
    },
    "الإملاء": {
        "الألف المقصورة": "تكتب ياءً عندما تكون في آخر الكلمة وتُنطق كـ(ى).",
        "الهمزة": "همزة القطع، همزة الوصل، همزة القطع المتطرفة.",
    },
}

# Simple regex patterns for basic validation (not exhaustive).
PATTERNS: Dict[str, re.Pattern] = {
    "noun": re.compile(r"^[\u0621-\u064A]+$"),
    "verb_past": re.compile(r"^[\u0621-\u064A]+ت$"),
    "verb_present": re.compile(r"^[\u0621-\u064A]+(ُ|َ|ِ)$"),
    "question_particle": re.compile(r"^(هل|ما|متى|أين|كيف|لماذا)\b"),
}


def get_rule(category: str, subcategory: Optional[str] = None) -> Optional[str]:
    """
    Retrieve a grammar rule description.
    :param category: Main category key (e.g., "الأفعال").
    :param subcategory: Optional sub‑category key (e.g., "الأزمنة").
    :return: Rule description or None if not found.
    """
    cat = GRAMMAR_RULES.get(category)
    if not cat:
        return None
    if subcategory:
        return cat.get(subcategory)
    # Return concatenated rules for the whole category.
    return "\n".join(f"{k}: {v}" for k, v in cat.items())


def list_categories() -> List[str]:
    """Return a list of all top‑level grammar categories."""
    return list(GRAMMAR_RULES.keys())


def list_subcategories(category: str) -> List[str]:
    """Return a list of sub‑categories for a given category."""
    return list(GRAMMAR_RULES.get(category, {}).keys())


def validate_word(word: str) -> Tuple[bool, List[str]]:
    """
    Perform a lightweight validation of an Arabic word.
    :param word: The word to validate.
    :return: (is_valid, list_of_failed_patterns)
    """
    failed: List[str] = []
    for name, pattern in PATTERNS.items():
        if not pattern.fullmatch(word):
            failed.append(name)
    return (len(failed) == 0, failed)


def simple_sentence_analysis(sentence: str) -> Dict[str, List[str]]:
    """
    Very basic analysis splitting a sentence into words and checking each word.
    Returns a dict with keys 'valid' and 'invalid' containing word lists.
    """
    words = re.findall(r"[\u0621-\u064A]+", sentence)
    valid, invalid = [], []
    for w in words:
        is_ok, _ = validate_word(w)
        (valid if is_ok else invalid).append(w)
    return {"valid": valid, "invalid": invalid}


class GrammarGuide:
    """Encapsulates access to the static Arabic grammar guide."""

    def __init__(self) -> None:
        self.rules = GRAMMAR_RULES

    def get(self, category: str, subcategory: Optional[str] = None) -> Optional[str]:
        return get_rule(category, subcategory)

    def categories(self) -> List[str]:
        return list_categories()

    def subcategories(self, category: str) -> List[str]:
        return list_subcategories(category)

    def validate(self, word: str) -> Tuple[bool, List[str]]:
        return validate_word(word)

    def analyze(self, sentence: str) -> Dict[str, List[str]]:
        return simple_sentence_analysis(sentence)
