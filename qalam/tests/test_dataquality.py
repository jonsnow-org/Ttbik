import pytest

from qalam import dataquality as D

GOOD_EN = ("The study of markets requires patience and a careful reading of the evidence. Prices move for many reasons, and most of them are not visible to people who only watch a chart. "
           "A trader who keeps a record of every decision can later see which ones were made for good reasons and which were not. This habit is more valuable than any single indicator, "
           "because it turns experience into knowledge that can be tested. When the record shows a pattern, the next step is to ask whether it would still hold on new data that was not used to find it.")
GOOD_AR = ("تعلّم إدارة المخاطر هو أهم ما يحتاجه من يدخل الأسواق المالية، فالأرباح الكبيرة لا تدوم إذا كانت الخسائر غير محدودة. "
           "ينبغي أن يحدد المتداول قبل كل صفقة المبلغ الذي هو مستعد لخسارته، وأن يضع أمر وقف الخسارة في المكان الذي يلغي فكرته إذا تحقق. "
           "وفي كل مرة يراجع فيها سجل صفقاته يتعلم أي قراراته كانت مبنية على سبب وأيها كانت ردة فعل على الخوف أو الطمع، وهذا ما يصنع الفرق بين من يستمر ومن يخرج من السوق بعد أشهر قليلة.")


def test_good_prose_passes_in_both_languages():
    for t, dom in ((GOOD_EN, "english"), (GOOD_AR, "arabic")):
        v = D.assess(t, min_words=30)
        assert v.keep and v.domain == dom and v.score == 1.0, v.reasons


@pytest.mark.parametrize("text,needle", [
    ("word " * 200, "-gram"),
    ("buy now cheap pills best price " * 40, "-gram"),
    ("Lorem ipsum dolor sit amet " + GOOD_EN, "boilerplate"),
    ("Please enable JavaScript. " + GOOD_EN, "boilerplate"),
    ("<div><p>a</p><span>b</span><div>c</div><b>d</b><i>e</i><u>f</u></div> " + GOOD_EN, "HTML"),
    ("short text only", "fewer than"),
    (" ".join(["#$%&@!"] * 120), "no letters"),
    ("\n".join(["- item number %d here with text about things in the world" % (i % 3) for i in range(60)]), "duplicates"),
    (GOOD_AR + " " + "ـ" * 600, "tatweel"),
    ("x" * 5000, "fewer than"),
])
def test_bad_documents_are_rejected_with_a_reason(text, needle):
    v = D.assess(text, min_words=30)
    assert not v.keep and any(needle in r or needle.lower() in r.lower() for r in v.reasons), v.reasons


def test_copy_paste_spam_is_caught_even_when_each_sentence_is_fine():
    spam = (GOOD_EN + " ") * 4
    v = D.assess(spam, min_words=30)
    assert not v.keep and any("repeated" in r for r in v.reasons)


def test_code_has_its_own_rules():
    ok = "import os\n\n\ndef main():\n    print('hi')\n    return os.getcwd()\n\n\nif __name__ == '__main__':\n    main()\n"
    assert D.assess(ok).keep and D.domain_of(ok) == "code"
    minified = "var a=" + "x+" * 700 + "1;function f(){return a;}"
    v = D.assess(minified, domain="code")
    assert not v.keep and any("1000" in r for r in v.reasons)


def test_filter_report_counts_reasons_and_kept_fraction():
    kept, rep = D.filter_corpus([GOOD_EN, GOOD_AR, "word " * 200, "tiny"])
    assert rep["in"] == 4 and rep["kept"] == len(kept) and 0 < rep["kept_fraction"] < 1 and rep["reasons"]
    assert rep["by_domain"].get("english", 0) >= 2


def test_mixture_respects_weights_and_never_repeats_more_than_the_cap():
    plan = D.plan_mixture({"arabic": 1e9, "english": 20e9, "code": 5e9}, {"arabic": 0.4, "english": 0.4, "code": 0.2}, total=10e9, max_epochs=4)
    assert plan["tokens"]["arabic"] == 4e9 and plan["epochs"]["arabic"] == 4.0 and plan["short_by"] == 0
    assert abs(sum(plan["tokens"].values()) - 10e9) < 1
    scarce = D.plan_mixture({"arabic": 0.5e9, "english": 20e9}, {"arabic": 0.6, "english": 0.4}, total=10e9, max_epochs=4)
    assert scarce["tokens"]["arabic"] == 2e9 and scarce["tokens"]["english"] == 8e9           # the Arabic shortfall is made up from English, not by a 12th pass over the Arabic
    short = D.plan_mixture({"arabic": 1e9}, {"arabic": 1.0}, total=10e9, max_epochs=4)
    assert short["short_by"] == 6e9 and "more data" in short["note"]
    with pytest.raises(ValueError):
        D.plan_mixture({}, {"a": 0.5}, 1)


def hist(vals):
    return [{"step": i * 1000, "metrics": {"ppl_ar": v}} for i, v in enumerate(vals)]


def test_governor_continue_plateau_regress_and_met():
    g = D.Governor({"ppl_ar": 0.8})
    assert g.assess(hist([0.30, 0.38, 0.45, 0.52]))["recommendation"] == "continue"
    r = g.assess(hist([0.50, 0.505, 0.506, 0.507, 0.507]))
    assert r["recommendation"] == "plateau" and "DATA" in r["why"] and r["stops_by_itself"] is False
    assert g.assess(hist([0.4, 0.5, 0.55, 0.48]))["recommendation"] == "investigate"
    assert g.assess(hist([0.7, 0.78, 0.83]))["recommendation"] == "candidate_to_stop"
    assert g.assess(hist([0.7]))["recommendation"] == "measure"


def test_governor_uses_the_wilson_lower_bound_for_pass_rates():
    g = D.Governor({"tools": 0.85})
    lucky = [{"step": 1, "metrics": {"tools": (9, 10)}}, {"step": 2, "metrics": {"tools": (10, 10)}}]
    solid = [{"step": 1, "metrics": {"tools": (880, 1000)}}, {"step": 2, "metrics": {"tools": (950, 1000)}}]
    assert g.assess(lucky)["recommendation"] != "candidate_to_stop"                           # 10/10 on ten examples is not 'excellent'
    assert g.assess(solid)["recommendation"] == "candidate_to_stop"
    both = D.Governor({"a": 0.5, "b": 0.5}).assess([{"step": 1, "metrics": {"a": 0.45, "b": 0.6}}, {"step": 2, "metrics": {"a": 0.452, "b": 0.7}}])
    assert both["suites"]["b"]["status"] == "met" and both["suites"]["a"]["status"] == "plateau"
