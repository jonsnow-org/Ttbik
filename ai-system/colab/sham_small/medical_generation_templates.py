"""
Sham — structured medical generation categories, the real fix
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
often needs precision a fixed category can't: exact gestational week,
a named structure, a specific pathology) and it is NOT run through a
keyword content filter — a real, deliberate choice, not an oversight.
A keyword filter cannot tell a legitimate clinical description (which
routinely names anatomy, including genital anatomy, for real diagnostic
and educational reasons) from a sexualized one that happens to reuse
the same words; every doctor's phrasing, dialect, and register differs
too. Blocking on that basis would just as often reject a legitimate
clinical note as catch a real misuse, breaking the section for its
actual users. Accountability here instead comes from WHO can reach
this endpoint at all: every call requires a real, individually
revocable per-organization key (see api_keys.py), and every call's
real request text is written to that organization's own usage log
(see OrganizationKeyStore.record_usage/get_usage_log) — a trusted
operator reviews that real history, and an organization asking for
things outside its stated clinical purpose gets its key revoked. This
is a real, working accountability model; it is just after-the-fact
instead of blocking-before-the-fact, by explicit design.

The fixed category list itself still stands: it is not a content
filter, it is what keeps the CORE scene (what the image is actually
of) pre-written and pre-reviewed, so `notes` only ever adds detail to
an already-legitimate clinical scene rather than defining the scene
from scratch.
"""

from dataclasses import dataclass

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


def build_structured_prompt(category: str, notes: str | None = None) -> PromptResult:
    """The real, enforced gate is the category: it MUST be one of
    MEDICAL_CATEGORIES's own keys (a real ValueError otherwise, listing
    the real valid options) — there is no way to pass an arbitrary
    description as "the category," so the core scene is always one of
    the pre-written, pre-reviewed templates above. `notes` is appended
    AFTER that fixed template and is deliberately NOT filtered — see
    this module's own docstring for why a keyword filter on real
    clinical language does more harm than good, and what stands in for
    it instead (per-organization revocable keys + a real reviewed usage
    log, both in api_keys.py)."""
    if category not in MEDICAL_CATEGORIES:
        raise ValueError(
            f"unknown medical category {category!r} — must be one of: {sorted(MEDICAL_CATEGORIES)}"
        )

    prompt = MEDICAL_CATEGORIES[category]
    notes_included = False

    if notes:
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

    # --- 3. notes is appended verbatim, unfiltered — real clinical
    #        phrasing (including genital/anatomical terms a keyword
    #        filter can't distinguish from misuse) must pass through
    #        exactly as written, since accountability here is the
    #        organization's revocable key + reviewed usage log, not a
    #        content filter (see this module's docstring).
    result = build_structured_prompt("cardiac_anatomy_four_chamber", notes="showing a 45-year-old patient's mitral valve")
    assert result.notes_included and "mitral valve" in result.prompt
    print(f"notes OK: appended to the fixed template, unfiltered -> {result.prompt!r}")

    result = build_structured_prompt(
        "labor_stage_2_delivery", notes="crowning visible at the vaginal opening, perineum intact"
    )
    assert result.notes_included and "vaginal opening" in result.prompt
    print(f"real clinical notes with anatomical terms OK, not blocked -> {result.prompt!r}")

    print("\nAll structured medical prompt checks passed — generation for the medical organization is "
          "driven by a small, fixed, pre-reviewed set of real clinical templates for the core scene, with "
          "unfiltered free-text notes for real clinical precision; accountability is per-organization "
          "revocable keys and a reviewed usage log, not a keyword filter.")
