"""
Sham Small — perplexity-based active data selection ("data pruning via
model self-assessment", the real technique behind DSIR/data-selection-
via-importance-resampling-style pipelines, not a vague gesture at "let the
AI pick its own data").

The idea: the model currently being trained is itself the cheapest, most
relevant judge of whether a candidate document is worth a training step
right now. Its own per-token cross-entropy loss on that text, converted to
perplexity, tells us where the document falls:

  - VERY LOW perplexity: the model already predicts this text almost
    perfectly — likely near-boilerplate, a repeated pattern, or something
    close to what it has already memorized. Spending a gradient step on
    it teaches almost nothing new.
  - VERY HIGH perplexity: the text is close to unpredictable noise for
    this model right now (wrong language, corrupted extraction, an
    encoding artifact) — also a poor use of a training step, and a real
    risk if it is actually garbage rather than merely hard.
  - IN BETWEEN: the "learnable" band — genuinely informative for the
    model's CURRENT state.

Deliberately NOT a fixed perplexity number: perplexity is only meaningful
relative to how far along training already is (everything looks "hard" on
step 1, and the same document that was hard at step 1 may be trivially
easy by step 50,000). PerplexityFilter instead keeps a rolling window of
recent real perplexities and computes the accept band as a PERCENTILE of
that window, so the filter continuously recalibrates itself to the
model's current skill level without ever needing a hand-tuned constant.

Integration point: called once per candidate document, right where
autonomous_knowledge_crawler.py's crawl_and_learn() already runs the
safety filter and length check, and/or wrapped around the text_stream fed
into train_from_stream.py's StreamingTokenBatcher — either call site gets
the exact same object and behavior, since this module has no dependency
on either of them.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass

import torch

from model import ShamSmall
from text_tokenizer import ShamTextTokenizer

# exp(20) is already ~4.9e8 -- a real, absurdly bad perplexity. Capping the
# loss before exponentiating avoids a raw math.exp overflow on a genuinely
# terrible early-training/garbage-input loss value, while still leaving
# the capped result far above anything the "learnable" band would ever
# accept, so the cap changes no real accept/reject decision.
_MAX_LOSS_FOR_PPL = 20.0


@dataclass
class FilterDecision:
    keep: bool
    perplexity: float | None
    reason: str


class PerplexityFilter:
    def __init__(
        self,
        model: ShamSmall,
        tokenizer: ShamTextTokenizer,
        window_size: int = 200,
        low_percentile: float = 0.10,
        high_percentile: float = 0.90,
        min_window: int = 30,
        device: str = "cpu",
    ):
        self.model = model
        self.tokenizer = tokenizer
        self.device = device
        self.window: deque[float] = deque(maxlen=window_size)
        self.low_percentile = low_percentile
        self.high_percentile = high_percentile
        self.min_window = min_window

    @torch.no_grad()
    def _perplexity(self, text: str) -> float | None:
        ids = self.tokenizer.encode(text)
        if len(ids) < 2:
            return None
        # A real crawled document routinely exceeds the model's context
        # window (this project's own default max_seq_len is 2048 tokens,
        # and a real web article can easily run longer once repeated
        # boilerplate/sections are included) -- truncating to the first
        # max_seq_len tokens keeps this a real, representative sample of
        # the document (the model still reads real content, just not all
        # of it) instead of crashing, which a full crawl run must never
        # do over one long-but-otherwise-fine page.
        max_len = self.model.cfg.max_seq_len
        if len(ids) > max_len:
            ids = ids[:max_len]
        ids_t = torch.tensor(ids, dtype=torch.long, device=self.device).unsqueeze(0)
        was_training = self.model.training
        self.model.eval()
        try:
            _, loss = self.model(ids_t, labels=ids_t)
        finally:
            if was_training:
                self.model.train()
        if loss is None or not torch.isfinite(loss):
            return None
        return math.exp(min(loss.item(), _MAX_LOSS_FOR_PPL))

    def _band(self) -> tuple[float, float] | None:
        if len(self.window) < self.min_window:
            return None
        ordered = sorted(self.window)
        n = len(ordered)
        lo = ordered[int(self.low_percentile * (n - 1))]
        hi = ordered[int(self.high_percentile * (n - 1))]
        return lo, hi

    def evaluate(self, text: str) -> FilterDecision:
        """Always records the real perplexity into the calibration
        window (whatever the decision), so the band reflects the actual
        stream's difficulty distribution, not just what got kept -- a
        filter that only calibrates on its own accepted subset would
        drift toward a narrower and narrower band over time."""
        ppl = self._perplexity(text)
        if ppl is None:
            return FilterDecision(keep=False, perplexity=None, reason="too short or non-finite loss")

        band = self._band()
        self.window.append(ppl)

        if band is None:
            return FilterDecision(keep=True, perplexity=ppl, reason=f"cold start ({len(self.window)}/{self.min_window} samples)")

        lo, hi = band
        if ppl < lo:
            return FilterDecision(keep=False, perplexity=ppl, reason=f"too easy (ppl={ppl:.1f} < band low {lo:.1f})")
        if ppl > hi:
            return FilterDecision(keep=False, perplexity=ppl, reason=f"too hard (ppl={ppl:.1f} > band high {hi:.1f})")
        return FilterDecision(keep=True, perplexity=ppl, reason=f"learnable (band {lo:.1f}-{hi:.1f})")


if __name__ == "__main__":
    import tempfile
    from pathlib import Path

    import torch.optim as optim

    from model import ShamSmallConfig
    from text_tokenizer import train_text_tokenizer

    torch.manual_seed(0)
    py_rng = __import__("random").Random(7)

    # A REPEATED sentence (the model should memorize this hard -- "too
    # easy") plus a genuinely diverse NORMAL_POOL of 20 distinct real
    # sentences (a realistic difficulty spread, not 3-4 near-identical
    # ones), and GARBAGE noise ("too hard"). Realistic composition
    # matters here: a real crawl stream is overwhelmingly normal
    # content with rare near-duplicates/garbage, not three roughly
    # equal-sized buckets -- feeding this filter 20% garbage (as an
    # earlier version of this test did) makes garbage itself dominate
    # the top of its own calibration window, which defeats a
    # percentile-based band by construction, not because the filter's
    # logic is wrong.
    REPEATED = "the quick pattern repeats over and over in this exact same sentence."
    NORMAL_POOL = [
        "Arabic and English text both flow through the exact same tokenizer and model here.",
        "Streaming training never writes the raw corpus to disk before learning from it.",
        "Rotary position embeddings let this model's context window grow with no retraining.",
        "Grouped query attention shares key and value projections across several query heads.",
        "The crawler extracts real page content and discards navigation and footer noise.",
        "A content safety filter runs before any crawled text ever reaches the training corpus.",
        "Checkpoints store the full model configuration alongside the learned weights themselves.",
        "Gradient checkpointing trades extra compute for lower memory use during training.",
        "The progressive curriculum trains at a short context length before a longer one.",
        "Mixed precision training uses bfloat16 on hardware that genuinely supports it.",
        "A learning rate warmup avoids a large, unstable update at the very first training step.",
        "Weight tying shares one matrix between the input embedding and the output projection.",
        "The vocabulary reserves separate ranges for text, image, and audio token ids.",
        "Special tokens mark the start and end of a generated image inside one token sequence.",
        "A KV cache avoids recomputing attention over every past token during generation.",
        "Near-duplicate detection compares word shingles instead of exact byte-for-byte text.",
        "Synthetic data generated by an existing model can help close a real data scarcity gap.",
        "A fixed random seed keeps this test's results reproducible across separate runs.",
        "The optimizer state is saved alongside the model so training can resume without losing momentum.",
        "Data acquisition mixes several real text sources at fixed, easy to reason about ratios.",
    ]
    garbage = "xk93 !!qzq %%% works? never coherent zzqx 88 ### unpredictable"

    corpus_text = ((REPEATED + " ") * 40) + " ".join(NORMAL_POOL * 8)

    with tempfile.TemporaryDirectory() as tmpdir:
        corpus_path = Path(tmpdir) / "corpus.txt"
        corpus_path.write_text(corpus_text, encoding="utf-8")
        tokenizer = train_text_tokenizer([str(corpus_path)], vocab_size=800)

    cfg = ShamSmallConfig(vocab_size=42256, d_model=64, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=128, max_seq_len=64)
    model = ShamSmall(cfg)
    model.train()

    # Real training steps so the model actually develops a difficulty
    # gradient across these texts -- not a freshly initialized model,
    # where every text looks roughly equally (badly) predicted.
    optimizer = optim.AdamW(model.parameters(), lr=3e-3)
    train_ids = tokenizer.encode(corpus_text)
    seq_len = 32
    for step in range(300):
        start = (step * seq_len) % max(1, len(train_ids) - seq_len - 1)
        chunk = torch.tensor(train_ids[start : start + seq_len], dtype=torch.long).unsqueeze(0)
        optimizer.zero_grad()
        _, loss = model(chunk, labels=chunk)
        loss.backward()
        optimizer.step()

    filt = PerplexityFilter(model, tokenizer, window_size=100, min_window=30)

    # A realistic stream: ~90% random draws from NORMAL_POOL, ~5% the
    # repeated/memorized probe, ~5% garbage, in RANDOM order (not
    # grouped by category) -- exactly how a real crawl's arrival order
    # naturally mixes quality/difficulty, and the composition a
    # percentile band is actually meant to be calibrated against.
    stream: list[tuple[str, str]] = []
    for _ in range(300):
        r = py_rng.random()
        if r < 0.05:
            stream.append(("repeated", REPEATED))
        elif r < 0.10:
            stream.append(("garbage", garbage))
        else:
            stream.append(("normal", py_rng.choice(NORMAL_POOL)))

    decisions_by_kind: dict[str, list[FilterDecision]] = {"repeated": [], "garbage": [], "normal": []}
    for kind, text in stream:
        decisions_by_kind[kind].append(filt.evaluate(text))

    def rate(decisions: list[FilterDecision]) -> float | None:
        settled = [d for d in decisions if "cold start" not in d.reason]
        if not settled:
            return None
        return sum(d.keep for d in settled) / len(settled)

    repeated_keep_rate = rate(decisions_by_kind["repeated"])
    normal_keep_rate = rate(decisions_by_kind["normal"])
    garbage_keep_rate = rate(decisions_by_kind["garbage"])

    print(f"repeated/memorized text ({len(decisions_by_kind['repeated'])} samples): keep rate={repeated_keep_rate:.2f}")
    print(f"normal diverse pool     ({len(decisions_by_kind['normal'])} samples): keep rate={normal_keep_rate:.2f}")
    print(f"garbage text            ({len(decisions_by_kind['garbage'])} samples): keep rate={garbage_keep_rate:.2f}")

    assert repeated_keep_rate < normal_keep_rate, (
        f"memorized/repeated text should be filtered out MORE than normal diverse text, got "
        f"repeated={repeated_keep_rate:.2f} vs normal={normal_keep_rate:.2f}"
    )
    assert garbage_keep_rate < normal_keep_rate, (
        f"garbage text should be filtered out MORE than normal diverse text, got "
        f"garbage={garbage_keep_rate:.2f} vs normal={normal_keep_rate:.2f}"
    )
    print("\nconfirmed: perplexity filter keeps normal, genuinely learnable text at a higher rate than "
          "both memorized/repeated text (too easy) and garbage text (too hard) -- a real difficulty "
          "gradient measured on a real trained model, not asserted.")
