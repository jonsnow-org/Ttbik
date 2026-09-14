"""
Nova Small — structured medical generation categories, the real fix
for a problem the owner correctly identified: free text describing a
real clinical event (e.g. childbirth) can use the same anatomical
vocabulary a sexualized description would use, and a keyword filter
alone cannot reliably tell those apart — that distinction needs
judgment a string match doesn't have.

The real fix is structural, not a smarter filter: instead of accepting
arbitrary free text as the thing that drives generation, an
organization picks from a FIXED, pre-written set of real clinical
categories (see MEDICAL_CATEGORIES below) — each one's actual
description was written and reviewed ONCE, at design time, by us, not
submitted per-request by a caller. There is no way to submit a
category that isn't in this list; build_structured_prompt() raises a
real error for anything else. This shrinks "could this specific
wording be read as sexualized" from an unbounded, per-request question
into a small, one-time review of a short fixed list.

An optional free-text `notes` field still exists (real clinical use
sometimes needs one more specific than a fixed category — "27 weeks
gestation" or a specific named structure), and it still goes through
the same ContentSafetyFilter as everywhere else in this project — but
it is deliberately the SMALLER part of the final prompt, appended to,
never replacing, the fixed vetted template. This reduces the ambiguity
surface a great deal; it does not claim to eliminate it to zero for
that notes field, and that residual, smaller risk is stated here
honestly rather than hidden.
"""

from dataclasses import dataclass

from dataset import ContentSafetyFilter

# A real, fixed, reviewed-once set of legitimate clinical/educational
# categories. Adding a new one is a real code change reviewed by a
# trusted operator — never something an organization can submit as
# free text at request time.
MEDICAL_CATEGORIES: dict[str, str] = {
    "labor_stage_1_early": (
        "A clinical illustration of the first stage of labor (early phase): "
        "the cervix beginning to dilate and efface, uterine contractions shown "
        "in cross-section diagram style, for medical/midwifery education."
    ),
    "labor_stage_2_delivery": (
        "A clinical illustration of the second stage of labor (delivery): "
        "the fetus descending through the birth canal during active pushing, "
        "shown in standard obstetric teaching diagram style."
    ),
    "labor_stage_3_placenta": (
        "A clinical illustration of the third stage of labor: placental "
        "separation and delivery, shown in standard obstetric teaching diagram style."
    ),
    "cesarean_section_incision": (
        "A clinical, diagram-style illustration of a cesarean section surgical "
        "procedure showing the incision site and layers, for surgical training."
    ),
    "cardiac_anatomy_four_chamber": (
        "A clinical anatomical diagram of the four chambers of the human heart "
        "and major vessels, standard cardiology teaching style."
    ),
    "respiratory_system_lungs": (
        "A clinical anatomical diagram of the human respiratory system: "
        "trachea, bronchi, and lungs, standard pulmonology teaching style."
    ),
    "digestive_system_overview": (
        "A clinical anatomical diagram of the human digestive system from "
        "esophagus to colon, standard gastroenterology teaching style."
    ),
    "musculoskeletal_joint_anatomy": (
        "A clinical anatomical diagram of a major joint (e.g. knee or shoulder) "
        "showing bone, cartilage, and ligament structures, standard orthopedic teaching style."
    ),
}


@dataclass
class PromptResult:
    prompt: str
    category: str
    notes_included: bool


def build_structured_prompt(
    category: str, notes: str | None = None, safety_filter: ContentSafetyFilter | None = None
) -> PromptResult:
    """The real gate: category MUST be one of MEDICAL_CATEGORIES's own
    keys (a real ValueError otherwise, listing the real valid options)
    — there is no way to pass an arbitrary description as "the
    category." notes, if given, is appended AFTER the fixed template
    and still runs through the real ContentSafetyFilter, exactly like
    every other free-text field in this project — a real, smaller
    residual surface, not a way around the fixed template."""
    if category not in MEDICAL_CATEGORIES:
        raise ValueError(
            f"unknown medical category {category!r} — must be one of: {sorted(MEDICAL_CATEGORIES)}"
        )

    safety_filter = safety_filter or ContentSafetyFilter()
    prompt = MEDICAL_CATEGORIES[category]
    notes_included = False

    if notes:
        verdict = safety_filter.check_text(notes)
        if not verdict.is_safe:
            raise ValueError(f"notes rejected by content safety filter: {verdict.reason}")
        prompt = f"{prompt} Additional clinical notes: {notes.strip()}"
        notes_included = True

    return PromptResult(prompt=prompt, category=category, notes_included=notes_included)


if __name__ == "__main__":
    # --- 1. Every real category builds a real, non-empty prompt ------
    for category in MEDICAL_CATEGORIES:
        result = build_structured_prompt(category)
        assert result.prompt and len(result.prompt) > 20
        assert result.category == category
        assert not result.notes_included
    print(f"all {len(MEDICAL_CATEGORIES)} real fixed categories build valid prompts with no notes.")

    # --- 2. An unknown category is rejected outright, not guessed at -
    try:
        build_structured_prompt("anything_a_caller_makes_up")
        raise AssertionError("an unknown category should have raised ValueError")
    except ValueError as exc:
        assert "unknown medical category" in str(exc)
    print("unknown category OK: rejected outright — there is no way to submit an arbitrary description "
          "as a category.")

    # --- 3. Real notes: safe notes are appended; unsafe notes are rejected
    result = build_structured_prompt("cardiac_anatomy_four_chamber", notes="showing a 45-year-old patient's mitral valve")
    assert result.notes_included and "mitral valve" in result.prompt
    print(f"safe notes OK: appended to the fixed template -> {result.prompt!r}")

    try:
        build_structured_prompt("cardiac_anatomy_four_chamber", notes="explicit sexual content")
        raise AssertionError("unsafe notes should have raised ValueError")
    except ValueError as exc:
        assert "content safety filter" in str(exc)
    print("unsafe notes OK: rejected by the same real ContentSafetyFilter used everywhere else in this project.")

    print("\nAll structured medical prompt checks passed — generation for the medical organization is "
          "driven by a small, fixed, pre-reviewed set of real clinical templates, not open-ended free text.")
