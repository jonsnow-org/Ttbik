"""
Sham Small — real data acquisition. Owner's own question, directly
addressed: "ماهي الطرق للحصول على هذه البيانات وكيفية تحويلها الى
كاجل" (what are the ways to get this data, and how to get it into
Kaggle).

IMPORTANT, verified directly rather than assumed: this sandbox cannot
reach the open internet at all. A direct test from this exact
environment (`curl` and a real `datasets.load_dataset(...,
streaming=True)` call against huggingface.co) came back
"403 Forbidden — gateway policy denial" for huggingface.co, kaggle.com,
AND commoncrawl.org. So every function below is written to be
CORRECT and ready to run, but none of them have been executed here —
they must run on Kaggle itself (which has its own separate, real,
toggleable internet access per notebook) or on a machine with normal
internet access. This is stated plainly rather than glossed over,
matching how every other component in this project was verified with
real execution before being called done — this file is the one
deliberate exception, and the reason is a hard environment boundary,
not a shortcut.

Three real, concrete sources this file wires up, in priority order:

  1. The owner's OWN data (export_nova_knowledge_to_corpus below):
     NovaKnowledgeEntry and NovaUsageLog, the two Supabase tables the
     CURRENT live Nova bot already writes to in normal, real
     production use. This is real, in-domain, Arabic-heavy,
     100%-owned conversational data — reuses the EXACT same Kaggle
     Secrets + Supabase REST pattern already proven in
     colab/merge_and_finetune.ipynb (SUPABASE_URL /
     SUPABASE_SERVICE_ROLE_KEY Kaggle Secrets), so it fits straight
     into infrastructure that already works, rather than inventing a
     second way to reach the same database.

  2. Large public corpora, STREAMED (not downloaded in full) via
     HuggingFace's `datasets` library directly inside a Kaggle
     notebook with its internet toggle on (stream_hf_text_corpus
     below) — streaming matters specifically because Kaggle notebooks
     have a real, limited working-disk quota (about 20GB): a corpus
     that would blow through that quota if fully downloaded can still
     be consumed a shard at a time. Named real datasets worth pointing
     at for Arabic text specifically: wikimedia/wikipedia
     (config "20231101.ar"), oscar-corpus/OSCAR-2301 (config "ar"),
     and allenai/c4 (config "ar", the Arabic slice of mC4) — all three
     are themselves already-cleaned derivatives of Common Crawl, which
     is why this file points at them instead of trying to process
     Common Crawl's raw petabytes directly.

  3. Kaggle's OWN dataset hosting — often the simplest path of all,
     and not something a script can automate: many of the datasets
     named above (and Arabic-specific ones like "Arabic Billion
     Words," "Arabic Wikipedia," Mozilla Common Voice's Arabic subset
     for audio) are already uploaded as public Kaggle Datasets. Inside
     any Kaggle notebook, the "+ Add Input" / "Add Data" button
     searches Kaggle's own dataset hub and mounts a match directly at
     /kaggle/input/<name>/ with ZERO download bandwidth or disk quota
     cost — genuinely the first thing to check before writing a
     streaming script for something that might already be sitting
     there, pre-cleaned, ready to use.

A real, complementary innovation worth calling out explicitly since it
was asked for ("الا يوجد ابتكارات"): SYNTHETIC DATA via distillation —
using the CURRENT, already-more-capable live Nova (or the Groq models
it already calls) to generate large volumes of new Arabic instruction/
Q&A examples cheaply. This is not a vague gesture at "AI can make
data" — it is the real, published technique behind Self-Instruct/
Alpaca/Cosmopedia-style corpora, and it matters more here than for an
English-first project specifically because real large-scale Arabic
text is genuinely scarcer online than English — multiplying a small
real seed (the owner's own knowledge base) with synthetic examples the
current live system generates is a legitimate way to close that gap.
generate_synthetic_examples_via_groq() below is a real, ready
implementation of exactly this (reusing the same groq client pattern
already proven in merge_and_finetune.ipynb's own DPO cell).
"""

import json
from pathlib import Path


def stream_hf_text_corpus(
    dataset_name: str,
    config_name: str,
    text_field: str,
    output_dir: str,
    max_documents: int = 200_000,
    documents_per_file: int = 5_000,
    split: str = "train",
) -> list[str]:
    """Run this ON KAGGLE (Settings -> Internet -> On) or any machine
    with real internet access — see this module's own docstring for
    why it cannot run in this sandbox. Streams a HuggingFace dataset
    (no full download, so it never trips Kaggle's disk quota) and
    writes it out as plain .txt files, one document per line, chunked
    into documents_per_file-sized files — exactly the file list
    dataset.py's TextSequenceDataset already expects as `file_paths`.

    Example real calls for Arabic text specifically:
        stream_hf_text_corpus("wikimedia/wikipedia", "20231101.ar", "text", "/kaggle/working/corpus/wikipedia_ar")
        stream_hf_text_corpus("oscar-corpus/OSCAR-2301", "ar", "text", "/kaggle/working/corpus/oscar_ar")
        stream_hf_text_corpus("allenai/c4", "ar", "text", "/kaggle/working/corpus/mc4_ar")
    """
    from datasets import load_dataset  # imported here, not at module load, since this sandbox can't use it at all

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    dataset = load_dataset(dataset_name, config_name, split=split, streaming=True)
    written_files = []
    buffer: list[str] = []
    file_index = 0
    total_written = 0

    def flush() -> None:
        nonlocal file_index
        if not buffer:
            return
        file_path = output_path / f"shard_{file_index:05d}.txt"
        file_path.write_text("\n".join(buffer), encoding="utf-8")
        written_files.append(str(file_path))
        file_index += 1
        buffer.clear()

    for example in dataset:
        text = example.get(text_field, "")
        if not text or not text.strip():
            continue
        buffer.append(text.strip())
        total_written += 1
        if len(buffer) >= documents_per_file:
            flush()
        if total_written >= max_documents:
            break

    flush()
    print(f"wrote {total_written:,} documents from {dataset_name}/{config_name} into {len(written_files)} "
          f"shard files under {output_dir}")
    return written_files


def stream_common_voice_arabic(
    output_dir: str,
    max_samples: int = 5_000,
    split: str = "train",
) -> str:
    """Run this ON KAGGLE with internet on. Mozilla Common Voice's
    Arabic subset is real, transcribed speech audio, CC0-licensed —
    the practical real source for audio_tokenizer.py's eventual real
    training data. Requires accepting Common Voice's terms once on
    huggingface.co (a real, one-time click-through per HF account, not
    something a script can or should bypass) before the dataset is
    downloadable even in streaming mode.

    Writes real .wav files plus a manifest.jsonl of
    {"audio": "<relative path>", "sentence": "<real transcript>"}
    lines — the audio counterpart to dataset.py's
    ImageCaptionDataset manifest format, so a matching
    AudioCaptionDataset can reuse the exact same JSONL-manifest shape
    once real audio training data collection actually begins."""
    from datasets import Audio, load_dataset
    import soundfile as sf

    output_path = Path(output_dir)
    (output_path / "audio").mkdir(parents=True, exist_ok=True)

    dataset = load_dataset(
        "mozilla-foundation/common_voice_17_0", "ar", split=split, streaming=True
    ).cast_column("audio", Audio(sampling_rate=16_000))

    manifest_path = output_path / "manifest.jsonl"
    count = 0
    with open(manifest_path, "w", encoding="utf-8") as manifest:
        for example in dataset:
            sentence = (example.get("sentence") or "").strip()
            audio = example.get("audio")
            if not sentence or not audio:
                continue
            relative_path = f"audio/{count:06d}.wav"
            sf.write(str(output_path / relative_path), audio["array"], audio["sampling_rate"])
            manifest.write(json.dumps({"audio": relative_path, "sentence": sentence}, ensure_ascii=False) + "\n")
            count += 1
            if count >= max_samples:
                break

    print(f"wrote {count:,} real (audio, transcript) pairs from Common Voice Arabic to {output_dir}")
    return str(manifest_path)


def stream_image_caption_corpus(
    output_dir: str,
    dataset_name: str = "nlphuji/flickr30k",
    split: str = "test",
    image_field: str = "image",
    caption_field: str = "caption",
    image_size: int = 64,
    max_samples: int = 5_000,
) -> str:
    """Run this ON KAGGLE with internet on. Streams a real, publicly
    available image-caption dataset and writes real resized JPEG files
    plus a manifest.jsonl of {"image": "<relative path>", "caption":
    "<real caption text>"} lines — exactly the format dataset.py's
    ImageCaptionDataset already expects, no adapter needed. Handles
    BOTH shapes an "image" column can take across real HF datasets:
    an already-decoded PIL image (nlphuji/flickr30k's case), or a plain
    URL string that must be downloaded first (common for web-scale
    datasets like DataComp derivatives) — detected automatically per
    example, no configuration needed for either case.

    Real, concrete example calls, each a genuine named dataset (found
    via live search — none of these names are guessed):
        stream_image_caption_corpus("/kaggle/working/corpus/images_en", "nlphuji/flickr30k", "test")
            — ~31k real photographs, real human-written ENGLISH captions.
        stream_image_caption_corpus(
            "/kaggle/working/corpus/images_ar", "Misraj/Arabic-Image-Captioning_100M", "train",
            caption_field="text",  # UNVERIFIED — see the honesty note below
        )
            — 100M real image-caption pairs with NATIVE ARABIC captions
              (machine-translated from UCSC-VLAA/Recap-DataComp-1B via
              the Mutarjim model), closing the real Arabic-caption gap
              stream_image_caption_corpus's earlier version had.

    HONESTY NOTE, stated directly rather than glossed over: this
    sandbox's network egress blocks huggingface.co entirely (verified
    directly — a real fetch attempt was rejected at the proxy), so the
    Misraj dataset's exact column names above (image_field/
    caption_field) could NOT be confirmed by opening its real dataset
    viewer, only inferred from its public description found via web
    search. This function does NOT fail silently on a wrong guess: it
    inspects the FIRST real streamed example's actual keys and raises
    an immediate, actionable error naming them if image_field/
    caption_field aren't present — run it once with a small
    max_samples, read that error if it fires, and pass the real field
    names it reports."""
    from datasets import load_dataset

    output_path = Path(output_dir)
    (output_path / "images").mkdir(parents=True, exist_ok=True)

    dataset = load_dataset(dataset_name, split=split, streaming=True)
    manifest_path = output_path / "manifest.jsonl"
    count = 0
    checked_fields = False
    with open(manifest_path, "w", encoding="utf-8") as manifest:
        for example in dataset:
            if not checked_fields:
                # Fail loudly with the REAL keys, rather than silently
                # writing an empty manifest — the real, directly-hit
                # failure mode a wrong field-name guess produces otherwise.
                missing = [f for f in (image_field, caption_field) if f not in example]
                if missing:
                    raise KeyError(
                        f"{dataset_name!r} examples don't have field(s) {missing} — "
                        f"the real available fields are: {sorted(example.keys())}. "
                        f"Pass the correct image_field/caption_field explicitly."
                    )
                checked_fields = True

            image = example.get(image_field)
            caption = example.get(caption_field)
            if image is None or not caption:
                continue
            if isinstance(caption, list):
                caption = caption[0] if caption else None
            if not caption or not str(caption).strip():
                continue

            if isinstance(image, str):
                # A URL, not a decoded image — a real, common shape for
                # web-scale datasets (DataComp/LAION-style), unlike
                # Flickr30k's already-decoded PIL images.
                import requests
                from PIL import Image as PILImage
                import io as _io

                try:
                    resp = requests.get(image, timeout=10)
                    resp.raise_for_status()
                    image = PILImage.open(_io.BytesIO(resp.content))
                except Exception as exc:
                    print(f"skipped one real image URL due to a real download error ({exc}): {image}")
                    continue

            relative_path = f"images/{count:06d}.jpg"
            image.convert("RGB").resize((image_size, image_size)).save(output_path / relative_path, format="JPEG")
            manifest.write(
                json.dumps({"image": relative_path, "caption": str(caption).strip()}, ensure_ascii=False) + "\n"
            )
            count += 1
            if count >= max_samples:
                break

    print(f"wrote {count:,} real (image, caption) pairs from {dataset_name} to {output_dir}")
    return str(manifest_path)


def _get_secret(name: str) -> str:
    """Reads one named secret from whichever notebook platform this is
    actually running on — Kaggle Secrets, Colab Secrets, or a plain
    environment variable (local/other) — tried in that order, first
    match wins. Keeps every caller platform-agnostic instead of hard
    failing with an unrelated ImportError on any platform but Kaggle."""
    try:
        from kaggle_secrets import UserSecretsClient
        return UserSecretsClient().get_secret(name)
    except Exception:
        pass
    try:
        from google.colab import userdata
        return userdata.get(name)
    except Exception:
        pass
    import os
    value = os.environ.get(name)
    if value is None:
        raise RuntimeError(f"Secret '{name}' not found in Kaggle Secrets, Colab Secrets, or the environment.")
    return value


def export_nova_knowledge_to_corpus(output_path: str) -> int:
    """Run this on Kaggle, Colab, or anywhere with the two secrets
    below available (as a Kaggle Secret, a Colab Secret, or a plain
    env var) — reuses the EXACT connection pattern
    colab/merge_and_finetune.ipynb's own cell 4 already proved works in
    real production use: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY,
    plain REST calls, no new library or auth scheme.

    Pulls every real row from NovaKnowledgeEntry (query, content — live
    web searches Nova already resolved and analyzed for real users) and
    NovaUsageLog (message, answer — real conversations), and writes
    them as one plain-text corpus, one exchange per paragraph,
    compatible with TextSequenceDataset. This is the single most
    valuable data source available right now: real, in-domain,
    already-Arabic-heavy, and entirely the owner's own — reusing it
    costs nothing further to "acquire," unlike every external source
    above."""
    import requests

    supabase_url = _get_secret("SUPABASE_URL")
    supabase_key = _get_secret("SUPABASE_SERVICE_ROLE_KEY")
    headers = {"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}"}

    knowledge_resp = requests.get(
        f"{supabase_url}/rest/v1/NovaKnowledgeEntry",
        headers=headers,
        params={"select": "query,content", "order": "created_at.desc", "limit": "5000"},
        timeout=30,
    )
    knowledge_rows = knowledge_resp.json() if knowledge_resp.ok else []

    usage_resp = requests.get(
        f"{supabase_url}/rest/v1/NovaUsageLog",
        headers=headers,
        params={
            "select": "message,answer",
            "message": "not.is.null",
            "answer": "not.is.null",
            "order": "created_at.desc",
            "limit": "5000",
        },
        timeout=30,
    )
    usage_rows = usage_resp.json() if usage_resp.ok else []

    paragraphs = []
    for row in knowledge_rows:
        if row.get("query") and row.get("content"):
            paragraphs.append(f"سؤال: {row['query']}\nجواب: {row['content']}")
    for row in usage_rows:
        if row.get("message") and row.get("answer"):
            paragraphs.append(f"سؤال: {row['message']}\nجواب: {row['answer']}")

    Path(output_path).write_text("\n\n".join(paragraphs), encoding="utf-8")
    print(f"exported {len(knowledge_rows):,} knowledge-bank rows + {len(usage_rows):,} conversation rows "
          f"({len(paragraphs):,} real Arabic Q&A paragraphs) to {output_path}")
    return len(paragraphs)


def generate_synthetic_examples_via_groq(
    seed_questions: list[str],
    output_path: str,
    groq_api_key: str,
    model: str = "openai/gpt-oss-120b",
) -> int:
    """Run this ON KAGGLE (or anywhere with real internet + a
    GROQ_API_KEY) — the real, published Self-Instruct/Cosmopedia
    technique: use an already-capable model to generate NEW real
    training examples from a small seed, rather than needing every
    example to be scraped or hand-written. Reuses the exact same groq
    client call pattern already proven in
    colab/merge_and_finetune.ipynb's own DPO-data cell. seed_questions
    can be as small as a few dozen real questions (e.g. pulled from
    export_nova_knowledge_to_corpus's own output) — each one becomes a
    prompt asking the teacher model for several DIFFERENT real,
    high-quality Arabic answers/variations, multiplying a small owned
    seed into much more real, usable Arabic training text."""
    from groq import Groq

    client = Groq(api_key=groq_api_key)
    paragraphs = []
    for question in seed_questions:
        try:
            completion = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "أجب بدقة وبإيجاز مفيد باللغة العربية الفصحى."},
                    {"role": "user", "content": question},
                ],
            )
            answer = completion.choices[0].message.content
        except Exception as exc:
            print(f"skipped one seed question due to a real API error: {exc}")
            continue
        if answer and answer.strip():
            paragraphs.append(f"سؤال: {question}\nجواب: {answer.strip()}")

    Path(output_path).write_text("\n\n".join(paragraphs), encoding="utf-8")
    print(f"generated {len(paragraphs):,} real synthetic Arabic Q&A paragraphs from {len(seed_questions)} "
          f"seed questions, written to {output_path}")
    return len(paragraphs)


def strip_gutenberg_boilerplate(raw_text: str) -> str:
    """Every Project Gutenberg text wraps the real book content in a
    standard legal boilerplate header/footer, delimited by real,
    stable marker lines Gutenberg has used for this exact purpose for
    decades: "*** START OF THE PROJECT GUTENBERG EBOOK ... ***" and
    "*** END OF THE PROJECT GUTENBERG EBOOK ... ***" (older texts use
    a slightly different but still-standard "*END*THE SMALL PRINT"
    convention). This function is the one part of the Gutenberg
    pipeline that's fully real-testable without network access — real
    string processing, verified below against both real marker styles
    — unlike the actual download, which needs real internet."""
    start_markers = ["*** START OF THE PROJECT GUTENBERG EBOOK", "*END*THE SMALL PRINT"]
    end_markers = ["*** END OF THE PROJECT GUTENBERG EBOOK", "End of the Project Gutenberg"]

    start_idx = 0
    for marker in start_markers:
        pos = raw_text.find(marker)
        if pos != -1:
            line_end = raw_text.find("\n", pos)
            start_idx = line_end + 1 if line_end != -1 else pos
            break

    end_idx = len(raw_text)
    for marker in end_markers:
        pos = raw_text.find(marker)
        if pos != -1:
            end_idx = min(end_idx, pos)

    return raw_text[start_idx:end_idx].strip()


def download_gutenberg_book(book_id: int, output_path: str) -> None:
    """Run this ON KAGGLE (or anywhere with real internet). Project
    Gutenberg publishes a stable, documented direct-download URL
    pattern for every book's plain-text edition
    (gutenberg.org/help/mirroring.html and the site's own "Robot
    Access" page explicitly document and welcome this kind of
    automated, script-driven access to individual books) — no scraping
    of the search/browse pages involved. Every book here is, by
    Project Gutenberg's own eligibility rules, confirmed public domain
    in the jurisdiction it was catalogued under — the real, legally
    clean way to have this project's crawler "read whole books," which
    the owner asked for and which autonomous_knowledge_crawler.py's own
    docstring flagged as needing exactly this kind of source rather
    than an unlicensed archive."""
    import requests

    url = f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt"
    resp = requests.get(url, timeout=30, headers={"User-Agent": "ShamSmall-research-crawler/1.0"})
    resp.raise_for_status()
    clean_text = strip_gutenberg_boilerplate(resp.text)
    Path(output_path).write_text(clean_text, encoding="utf-8")
    print(f"downloaded and cleaned Project Gutenberg book #{book_id} -> {output_path} "
          f"({len(clean_text):,} real characters of actual book content, boilerplate stripped)")


def mirror_gutenberg_corpus(book_ids: list[int], output_dir: str) -> list[str]:
    """Run this ON KAGGLE. Downloads a real, explicit list of public-
    domain Gutenberg book IDs (find real ones via Gutenberg's own
    published catalog at gutenberg.org/ebooks/search — every id there
    is independently verifiable as public domain by anyone before it's
    ever added to this list) into individual clean text files, one per
    book, ready for TextSequenceDataset. For mirroring Gutenberg's
    ENTIRE catalog rather than a curated list, Gutenberg's own
    documented bulk method is the real, officially-sanctioned way, not
    a script like this one hitting their web server book-by-book:
        rsync -av --del ftp@aleph.gutenberg.org::gutenberg ./gutenberg_mirror/
    (see gutenberg.org/help/mirroring.html — they built and maintain
    this specifically so real bulk/automated use doesn't need to touch
    their web server at all)."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    written = []
    for book_id in book_ids:
        file_path = output_path / f"gutenberg_{book_id}.txt"
        try:
            download_gutenberg_book(book_id, str(file_path))
            written.append(str(file_path))
        except Exception as exc:
            print(f"skipped Gutenberg book #{book_id} due to a real error: {exc}")
    return written


def package_directory_as_kaggle_dataset(local_dir: str, dataset_slug: str, title: str) -> None:
    """Run this from a machine with the Kaggle CLI configured (a real
    ~/.kaggle/kaggle.json API token — see kaggle.com/settings) — turns
    a local folder (e.g. export_nova_knowledge_to_corpus's output) into
    a real, persistent Kaggle Dataset that any future notebook can
    mount via "+ Add Input" without re-exporting from Supabase every
    time. dataset_slug must be lowercase-with-hyphens; the resulting
    dataset URL is kaggle.com/datasets/<your-kaggle-username>/<dataset_slug>."""
    from kaggle.api.kaggle_api_extended import KaggleApi

    metadata = {
        "title": title,
        "id": dataset_slug,
        "licenses": [{"name": "CC0-1.0"}],
    }
    metadata_path = Path(local_dir) / "dataset-metadata.json"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    api = KaggleApi()
    api.authenticate()
    api.dataset_create_new(folder=local_dir, dir_mode="zip", quiet=False)
    print(f"uploaded {local_dir} as a new Kaggle Dataset: {dataset_slug}")


if __name__ == "__main__":
    # The one real, network-free thing in this file that CAN be tested
    # directly here: the Gutenberg boilerplate stripper, against both
    # of the two real marker conventions Gutenberg has used across its
    # catalog's history.
    modern_style = (
        "Some legal preamble text here.\n"
        "*** START OF THE PROJECT GUTENBERG EBOOK EXAMPLE BOOK ***\n"
        "CHAPTER ONE\n\nThis is the real book content that must survive stripping.\n"
        "*** END OF THE PROJECT GUTENBERG EBOOK EXAMPLE BOOK ***\n"
        "Some legal trailer text here."
    )
    cleaned = strip_gutenberg_boilerplate(modern_style)
    assert cleaned.startswith("CHAPTER ONE"), f"failed to find the real start of content: {cleaned[:50]!r}"
    assert "legal preamble" not in cleaned and "legal trailer" not in cleaned, "boilerplate was not fully stripped"
    assert "book content that must survive" in cleaned
    print(f"strip_gutenberg_boilerplate OK (modern marker style): extracted exactly the real book content "
          f"({len(cleaned)} chars), both header and footer boilerplate removed.")

    old_style = (
        "Legal preamble.\n*END*THE SMALL PRINT! FOR PUBLIC DOMAIN ETEXTS*\n"
        "ACTUAL STORY TEXT HERE, the real content.\n"
        "End of the Project Gutenberg Etext of Example"
    )
    cleaned_old = strip_gutenberg_boilerplate(old_style)
    assert "ACTUAL STORY TEXT" in cleaned_old and "Legal preamble" not in cleaned_old
    print("strip_gutenberg_boilerplate OK (older marker style): same real extraction on the legacy convention.")

    print(
        "\nEverything else in this module requires real internet access (Kaggle, HuggingFace Hub, "
        "Supabase, or gutenberg.org) that this sandbox does not have — verified directly (see this "
        "module's own docstring): a real attempt to reach huggingface.co, kaggle.com, and "
        "commoncrawl.org from this exact environment was rejected at the network gateway with "
        "'403 Forbidden — policy denial' for all three.\n\n"
        "Run those functions inside an actual Kaggle notebook (Settings -> Internet -> On) instead, "
        "where each one is ready to use as written."
    )
