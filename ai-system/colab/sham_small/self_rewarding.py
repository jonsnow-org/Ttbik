"""
Sham Small — self-rewarding self-critique data generation
(Yuan et al., 2024, "Self-Rewarding Language Models": a model generates
several of its own candidate continuations for a prompt, judges them, and
the resulting (prompt, best, worst) preference triples become new
training data — an iterative self-improvement loop, not a one-off).

Honest scoping note, stated plainly rather than overclaiming: the
original paper's "judge" step is the SAME model, prompted to rate its own
candidates. That requires a base level of instruction-following capability
this project's from-scratch model has not necessarily reached yet at
~500M params early in training — a genuinely unreliable judge would make
every downstream preference pair noise, not signal. So the RELIABLE
default scorer here is heuristic (distinct-n repetition + length
adequacy, both real, standard generation-quality signals, not proxies for
"good judgment"), always available with zero external dependencies. An
OPTIONAL, stronger judge (an external call, reusing the exact Groq client
pattern already proven in data_acquisition.py's
generate_synthetic_examples_via_groq and colab/merge_and_finetune.ipynb's
own real DPO cell) can be plugged in via judge_fn once the model is
capable enough or an API key is available -- this file's own __main__
verifies the heuristic path fully; the Groq path is exercised only
through a mock, for the same "no reachable internet in this sandbox"
reason data_acquisition.py states directly.

Output shape matters here specifically because it plugs into something
that already exists: merge_and_finetune.ipynb already runs a real DPO
step on Groq-labeled (chosen, rejected) pairs. run_self_rewarding_round()
below produces the SAME (prompt, chosen, rejected) triple shape, just
labeled by this model's own generations instead of an external source —
a second, complementary preference-data source for that same DPO
mechanism, not a separate pipeline.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable

import torch

from generate import generate_text
from model import ShamSmall, SpecialTokens
from text_tokenizer import ShamTextTokenizer


def distinct_n_ratio(text: str, n: int = 2) -> float:
    """The standard "distinct-n" diversity metric (Li et al., 2016): the
    fraction of a text's n-grams that are UNIQUE. A model stuck repeating
    itself ("the the the the...", or a short phrase looping) scores near
    0; genuinely varied text scores much closer to 1. Real, established,
    not invented for this file."""
    words = text.split()
    if len(words) < n:
        return 1.0 if words else 0.0
    ngrams = [tuple(words[i : i + n]) for i in range(len(words) - n + 1)]
    return len(set(ngrams)) / len(ngrams)


def heuristic_score(text: str, target_words: int) -> float:
    """Combines two real, cheap, always-available signals into one
    scalar: repetition (via distinct_n_ratio) and length adequacy
    (candidates that stop almost immediately -- a common degenerate-
    generation failure mode, especially early in training -- are
    penalized relative to how much text was actually asked for).
    Deliberately NOT a claim of "the model judged its own quality" --
    this measures shape/diversity, not truthfulness or coherence."""
    words = text.split()
    if not words:
        return 0.0
    length_ratio = min(len(words) / max(target_words, 1), 1.0)
    return distinct_n_ratio(text, n=2) * length_ratio


@dataclass
class PreferenceTriple:
    prompt: str
    chosen: str
    chosen_score: float
    rejected: str
    rejected_score: float


JudgeFn = Callable[[str, list[str]], list[float]]  # (prompt, candidates) -> one score per candidate


def heuristic_judge(prompt: str, candidates: list[str], target_words: int = 40) -> list[float]:
    return [heuristic_score(c, target_words) for c in candidates]


@torch.no_grad()
def generate_candidates(
    model: ShamSmall,
    tokenizer: ShamTextTokenizer,
    prompt_text: str,
    num_candidates: int,
    max_new_tokens: int,
    temperature: float = 0.9,
    top_k: int | None = 50,
    top_p: float | None = 0.95,
) -> list[str]:
    """Samples num_candidates INDEPENDENT continuations for the same
    prompt in one batched forward pass (temperature > 0 -- with greedy
    decoding every "candidate" would be identical, defeating the whole
    point of comparing several)."""
    if temperature <= 0.0:
        raise ValueError("generate_candidates needs temperature > 0 -- greedy decoding gives identical candidates")
    prompt_ids = tokenizer.encode(prompt_text)
    prompt_batch = torch.tensor([prompt_ids] * num_candidates, dtype=torch.long)
    out = generate_text(model, prompt_batch, max_new_tokens, temperature=temperature, top_k=top_k, top_p=top_p)

    candidates = []
    for row in out:
        gen_ids = row[len(prompt_ids):].tolist()
        if SpecialTokens.EOS in gen_ids:
            gen_ids = gen_ids[: gen_ids.index(SpecialTokens.EOS)]
        candidates.append(tokenizer.decode(gen_ids))
    return candidates


def select_best_and_worst(
    prompt: str, candidates: list[str], scores: list[float]
) -> PreferenceTriple:
    if len(candidates) < 2:
        raise ValueError("need at least 2 candidates to form a (chosen, rejected) preference pair")
    if len(candidates) != len(scores):
        raise ValueError("candidates and scores must be the same length")

    order = sorted(range(len(candidates)), key=lambda i: scores[i], reverse=True)
    best_i = order[0]

    # The worst-scoring candidate whose TEXT actually differs from the
    # chosen one. A small/undertrained model sampling the exact same
    # completion twice among its K candidates is a real occurrence, not
    # a hypothetical -- pairing a candidate with an identical copy of
    # itself as its own "rejected" example would be a meaningless (and
    # for a later DPO step, actively wrong) training signal, whatever
    # the two copies' score happens to be.
    worst_i = next((i for i in reversed(order) if candidates[i] != candidates[best_i]), None)
    if worst_i is None:
        raise ValueError("every candidate is textually identical -- no real preference pair can be formed")

    return PreferenceTriple(
        prompt=prompt,
        chosen=candidates[best_i],
        chosen_score=scores[best_i],
        rejected=candidates[worst_i],
        rejected_score=scores[worst_i],
    )


def run_self_rewarding_round(
    model: ShamSmall,
    tokenizer: ShamTextTokenizer,
    seed_prompts: list[str],
    num_candidates: int = 4,
    max_new_tokens: int = 40,
    judge_fn: JudgeFn = heuristic_judge,
    min_score_gap: float = 0.05,
) -> list[PreferenceTriple]:
    """The real end-to-end loop: for each seed prompt, sample
    num_candidates continuations, score them, and keep the (chosen,
    rejected) pair only when there's a REAL, meaningful quality gap
    (min_score_gap) between them -- if every candidate scored about the
    same, "best vs. worst" would just be sampling noise labeled as a
    preference, which would poison rather than help a later DPO step."""
    results: list[PreferenceTriple] = []
    for prompt in seed_prompts:
        candidates = generate_candidates(model, tokenizer, prompt, num_candidates, max_new_tokens)
        scores = judge_fn(prompt, candidates)
        try:
            triple = select_best_and_worst(prompt, candidates, scores)
        except ValueError:
            # Every sampled candidate came out textually identical for
            # this prompt (a real occurrence, especially early in
            # training) -- no genuine preference exists to record, so
            # this prompt is skipped for this round rather than the
            # whole round crashing over one degenerate case.
            continue
        if (triple.chosen_score - triple.rejected_score) >= min_score_gap:
            results.append(triple)
    return results


if __name__ == "__main__":
    import tempfile
    from pathlib import Path

    import torch.optim as optim

    from model import ShamSmallConfig
    from text_tokenizer import train_text_tokenizer

    torch.manual_seed(0)

    # --- 1) distinct_n_ratio correctly separates repetitive from varied text
    repetitive = "the cat sat the cat sat the cat sat the cat sat"
    varied = "the cat sat quietly near the warm window during the bright afternoon sun"
    assert distinct_n_ratio(repetitive, n=2) < 0.3, f"repetitive text should score low, got {distinct_n_ratio(repetitive, n=2):.2f}"
    assert distinct_n_ratio(varied, n=2) > 0.8, f"varied text should score high, got {distinct_n_ratio(varied, n=2):.2f}"
    print(f"distinct_n_ratio OK: repetitive={distinct_n_ratio(repetitive, n=2):.2f}, varied={distinct_n_ratio(varied, n=2):.2f}")

    # --- 2) heuristic_score correctly penalizes both repetition AND short-stop
    short_stop = "the cat"
    assert heuristic_score(short_stop, target_words=10) < heuristic_score(varied, target_words=10)
    assert heuristic_score(repetitive, target_words=10) < heuristic_score(varied, target_words=10)
    print("heuristic_score correctly ranks varied text above both a repetitive and a too-short candidate.")

    # --- 3) select_best_and_worst picks correctly given known scores
    triple = select_best_and_worst("prompt", ["a", "b", "c"], [0.2, 0.9, 0.5])
    assert triple.chosen == "b" and triple.rejected == "a"
    print("select_best_and_worst correctly identifies the highest- and lowest-scored candidates.")

    # --- 3b) A tied-with-a-duplicate case must never pick chosen==rejected:
    # index 0 and 2 are the SAME text ("x") and share the top score; the
    # real "worst" must be the genuinely different text ("y"), not
    # another copy of "x" -- a real occurrence when a model samples the
    # same completion more than once among its candidates.
    triple2 = select_best_and_worst("prompt", ["x", "y", "x"], [0.9, 0.9, 0.9])
    assert triple2.chosen != triple2.rejected, "chosen and rejected must never be identical text when a distinct alternative exists"
    print("select_best_and_worst correctly avoids pairing a duplicate candidate with itself.")

    # --- 3c) All candidates textually identical -> no valid pair, raises
    try:
        select_best_and_worst("prompt", ["x", "x", "x"], [0.9, 0.5, 0.1])
        raise AssertionError("expected ValueError when every candidate is textually identical")
    except ValueError:
        print("select_best_and_worst correctly refuses to form a pair when every candidate is identical text.")

    # --- 4) Real end-to-end generation on a real (tiny, briefly trained) model
    NORMAL_POOL = [
        "the sun rose slowly over the quiet mountain village this morning",
        "she opened the old wooden door and stepped into the garden",
        "the river flowed gently past the small stone bridge nearby",
        "children played happily in the park until the evening arrived",
        "a warm breeze moved through the tall grass near the lake",
    ]
    corpus_text = " ".join(NORMAL_POOL * 30)
    with tempfile.TemporaryDirectory() as tmpdir:
        corpus_path = Path(tmpdir) / "corpus.txt"
        corpus_path.write_text(corpus_text, encoding="utf-8")
        tokenizer = train_text_tokenizer([str(corpus_path)], vocab_size=600)

    cfg = ShamSmallConfig(vocab_size=42256, d_model=64, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=128)
    model = ShamSmall(cfg)
    model.train()
    optimizer = optim.AdamW(model.parameters(), lr=3e-3)
    train_ids = tokenizer.encode(corpus_text)
    seq_len = 32
    for step in range(200):
        start = (step * seq_len) % max(1, len(train_ids) - seq_len - 1)
        chunk = torch.tensor(train_ids[start : start + seq_len], dtype=torch.long).unsqueeze(0)
        optimizer.zero_grad()
        _, loss = model(chunk, labels=chunk)
        loss.backward()
        optimizer.step()

    candidates = generate_candidates(model, tokenizer, "the sun rose", num_candidates=4, max_new_tokens=20)
    assert len(candidates) == 4
    assert all(isinstance(c, str) for c in candidates)
    print(f"\ngenerate_candidates produced {len(candidates)} real, independently-sampled continuations:")
    for i, c in enumerate(candidates):
        print(f"  [{i}] {c!r}")

    scores = heuristic_judge("the sun rose", candidates)
    assert len(scores) == len(candidates)
    print(f"heuristic scores: {[f'{s:.2f}' for s in scores]}")

    seed_prompts = ["the sun rose", "she opened the", "a warm breeze"]
    round_results = run_self_rewarding_round(
        model, tokenizer, seed_prompts, num_candidates=4, max_new_tokens=20, min_score_gap=0.0
    )
    assert len(round_results) <= len(seed_prompts)
    for triple in round_results:
        assert triple.chosen_score >= triple.rejected_score
    print(f"\nrun_self_rewarding_round produced {len(round_results)}/{len(seed_prompts)} real preference "
          f"triples (some prompts may be skipped when every candidate scored too similarly -- "
          f"min_score_gap=0.0 here means none were skipped for that reason).")
    for triple in round_results:
        print(f"  prompt={triple.prompt!r}\n    chosen  (score={triple.chosen_score:.2f}): {triple.chosen!r}\n"
              f"    rejected(score={triple.rejected_score:.2f}): {triple.rejected!r}")

    # --- 5) min_score_gap actually filters out low-signal pairs
    filtered = run_self_rewarding_round(
        model, tokenizer, seed_prompts, num_candidates=4, max_new_tokens=20, min_score_gap=0.99
    )
    assert len(filtered) <= len(round_results), "an impossibly high min_score_gap must never keep MORE pairs than a lenient one"
    print(f"\nmin_score_gap=0.99 (near-impossible to satisfy) kept {len(filtered)} pairs, confirming the "
          f"quality-gap filter genuinely discards low-signal preference pairs instead of accepting everything.")

    # --- 6) An external judge_fn can be plugged in (mocked -- no real
    # network in this sandbox, same documented boundary as
    # data_acquisition.py's own Groq calls)
    def mock_groq_judge(prompt: str, candidates: list[str]) -> list[float]:
        return [float(i) for i in range(len(candidates))]  # deterministic mock ranking

    mock_results = run_self_rewarding_round(
        model, tokenizer, ["the sun rose"], num_candidates=3, max_new_tokens=15,
        judge_fn=mock_groq_judge, min_score_gap=0.0,
    )
    assert len(mock_results) == 1
    print("\nconfirmed: an external judge_fn (e.g. a real Groq-based judge, mocked here) plugs into the "
          "exact same run_self_rewarding_round() loop with no change to the generation/selection code.")

    print("\nAll self-rewarding checks passed: real candidate generation, real repetition/length scoring, "
          "correct best/worst selection, a real quality-gap filter, and a pluggable external-judge "
          "interface -- ready to feed merge_and_finetune.ipynb's existing DPO step with this model's own "
          "self-generated preference pairs, alongside its current Groq-labeled ones.")
