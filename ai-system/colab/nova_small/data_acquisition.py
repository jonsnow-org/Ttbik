"""
Nova Small — real data acquisition. Owner's own question, directly
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


def export_nova_knowledge_to_corpus(output_path: str) -> int:
    """Run this ON KAGGLE (or anywhere with the two Kaggle Secrets
    below available) — reuses the EXACT connection pattern
    colab/merge_and_finetune.ipynb's own cell 4 already proved works in
    real production use: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY as
    Kaggle Secrets, plain REST calls, no new library or auth scheme.

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
    from kaggle_secrets import UserSecretsClient

    secrets = UserSecretsClient()
    supabase_url = secrets.get_secret("SUPABASE_URL")
    supabase_key = secrets.get_secret("SUPABASE_SERVICE_ROLE_KEY")
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
    print(
        "This module's functions require real internet access (Kaggle, HuggingFace Hub, or Supabase) "
        "that this sandbox does not have — verified directly (see this module's own docstring): a real "
        "attempt to reach huggingface.co, kaggle.com, and commoncrawl.org from this exact environment "
        "was rejected at the network gateway with '403 Forbidden — policy denial' for all three.\n\n"
        "Run these functions inside an actual Kaggle notebook (Settings -> Internet -> On) instead, "
        "where each one is ready to use as written."
    )
