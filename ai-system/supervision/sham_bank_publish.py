"""
Build Sham's central knowledge bank from everything the crawlers and notebooks published, and put it where the Studio can read it (owner 2026-11-09).

  1. every text corpus of the account whose name starts with `sham-crawl-` and ends with `-corpus` (the GitHub collector's, the Kaggle crawl notebooks', self-learn ...), plus the
     `text/**/*.txt` of each (documents are separated by blank lines);
  2. sham_bank.build(): dedupe, drop what is not prose, chunk, compress, index (BM25 CSR) and embed every passage with the small encoder (sham_encoder_np);
  3. push the folder to the private ModelScope model repo `novaai2026/sham-bank` ONLY when its sha changed. The v1 Studio fetches it (app.py `_bank_refresh`) and answers `bank_search`
     for Sham, Sham v2 and Nova. Nothing is ever deleted from the corpora.

    python3 sham_bank_publish.py --selftest        offline: a fake corpus folder, build, search, the unchanged-sha skip
    python3 sham_bank_publish.py                   real run (Kaggle + ModelScope credentials in the environment)
    python3 sham_bank_publish.py --no-push         real corpora, build only
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SHAM = HERE.parent / "colab" / "sham_small"
sys.path.insert(0, str(SHAM))
BANK_ID = os.environ.get("SHAM_BANK_REPO", "novaai2026/sham-bank")
ENCODER = SHAM / "data" / "knowledge_encoder.json"
MAX_PASSAGES = int(os.environ.get("SHAM_BANK_MAX_PASSAGES", "450000"))        # bounds the Studio's memory and the build time


def corpus_documents(roots: list[tuple[str, Path]]):
    """(source, document) for every blank-line separated document of every text file under each root."""
    for name, root in roots:
        for f in sorted(root.rglob("*.txt")):
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for doc in text.split("\n\n"):
                doc = doc.strip()
                if doc:
                    yield name, doc


def fetch_roots() -> list[tuple[str, Path]]:
    from sham_inputs import crawl_dataset_names, fetch_dataset
    names = sorted(set(crawl_dataset_names()["corpora"]) | {"sham-crawl-corpus"})
    roots = []
    for n in names:
        try:
            root = fetch_dataset(n)
        except Exception as exc:  # noqa: BLE001
            print(f"  ⚠ {n}: {type(exc).__name__}")
            continue
        if root:
            roots.append((n, Path(root)))
            print(f"  • {n}")
    return roots


def remote_sha(api, model_id: str) -> str:
    try:
        from modelscope.hub.file_download import model_file_download
        p = model_file_download(model_id, "bank_manifest.json", cache_dir=tempfile.mkdtemp())
        return str(json.loads(Path(p).read_text(encoding="utf-8")).get("sha", ""))
    except Exception:
        return ""


def push(out: Path, manifest: dict) -> str:
    token = os.environ.get("MODELSCOPE_TOKEN", "")
    if not token:
        return "⏭ no ModelScope token: built but not pushed"
    from modelscope.hub.api import HubApi
    api = HubApi()
    api.login(token)
    if remote_sha(api, BANK_ID) == manifest["sha"]:
        return "⏭ the bank on ModelScope is already this one (same sha): nothing pushed"
    (out / "configuration.json").write_text(json.dumps({"framework": "numpy", "task": "retrieval"}), encoding="utf-8")
    from modelscope.hub.constants import Visibility
    api.push_model(model_id=BANK_ID, model_dir=str(out), visibility=Visibility.PRIVATE, license="apache-2.0", chinese_name="Sham knowledge bank",
                   commit_message=f"bank {manifest['sha'][:12]} {manifest['passages']} passages")
    return f"✅ pushed {BANK_ID}: {manifest['passages']:,} passages, {manifest['bytes'] / 1e6:.0f} MB, sha {manifest['sha'][:12]}"


def run(roots: list[tuple[str, Path]], out: Path, do_push: bool) -> dict:
    import sham_bank
    shutil.rmtree(out, ignore_errors=True)
    manifest = sham_bank.build(corpus_documents(roots), out, encoder_json=ENCODER if ENCODER.exists() else None, max_chunks=MAX_PASSAGES)
    print(f"bank: {manifest['passages']:,} passages from {manifest['documents']:,} documents | sources {', '.join(manifest['sources'])} | {manifest['bytes'] / 1e6:.0f} MB | encoder {manifest['encoder']}")
    manifest["push"] = push(out, manifest) if do_push else "⏭ --no-push"
    print(manifest["push"])
    return manifest


def _selftest() -> None:
    import sham_bank
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        a, b = td / "sham-crawl-gh-collect-corpus" / "text", td / "sham-crawl-x-corpus" / "text"
        a.mkdir(parents=True)
        b.mkdir(parents=True)
        (a / "1.txt").write_text(("عاصمة فرنسا هي باريس وتقع على نهر السين وفيها متاحف كثيرة وجسور قديمة. " * 5) + "\n\n" + ("The capital of Japan is Tokyo, a large city with many trains and people. " * 5), encoding="utf-8")
        (b / "2.txt").write_text(("عاصمة فرنسا هي باريس وتقع على نهر السين وفيها متاحف كثيرة وجسور قديمة. " * 5) + "\n\n" + "12 34 56 78 " * 80 + "\n\n" + ("Python is a language made by Guido van Rossum in 1991 for readable code. " * 5), encoding="utf-8")
        roots = [("gh", td / "sham-crawl-gh-collect-corpus"), ("x", td / "sham-crawl-x-corpus")]
        m = run(roots, td / "out", do_push=False)
        assert m["duplicates"] == 1 and m["not_prose"] == 1 and m["passages"] >= 3, m
        bank = sham_bank.Bank(td / "out")
        assert "Guido" in bank.search("who made Python", 1)[0]["text"]
        assert "Tokyo" in bank.search("capital of Japan", 1)[0]["text"]
        assert m["push"].startswith("⏭")
    os.environ.pop("MODELSCOPE_TOKEN", None)
    assert push(Path("/nonexistent"), {"sha": "x"}).startswith("⏭ no ModelScope token")
    print("sham_bank_publish self-test OK (corpora -> bank -> search; no token = no push)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--no-push", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        _selftest()
        return 0
    roots = fetch_roots()
    if not roots:
        print("no crawl corpora could be fetched: nothing to build")
        return 0
    run(roots, Path(os.environ.get("SHAM_BANK_OUT", "/tmp/sham_bank")), not a.no_push)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
