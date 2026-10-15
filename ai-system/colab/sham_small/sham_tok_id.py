"""
Which text tokenizer a checkpoint was trained with — written INTO the checkpoint, checked where it is served (2026-10-14).

Why: the move to the general tokenizer (sham_general_text.py) is installed by sham_inputs in the notebooks only; serve.py and the ModelScope
Studio load the tokenizer file that travels with the checkpoint as it is. Measured on the published sham-merged (step 61,555): with the right
(general) tokenizer chat-answer loss 4.28, with the old Arabic one 10.90 — pure noise in the bot. Nothing recorded which one was right
(the published file had no marker), so a wrong file would have gone unnoticed.

  stamp(tokenizer)                     -> {"text_tokenizer": "general-v1" | "custom", "text_tokenizer_sha1": ...}   (save_checkpoint extra)
  resolve(extra, tokenizer_path)       -> (path to use, note)   — the file itself when it matches; the general tokenizer when the
                                          checkpoint says general and the file is not; RuntimeError on any other mismatch
                                          (SHAM_ALLOW_TOKENIZER_MISMATCH=1 turns that into a warning). An unmarked (older) checkpoint is
                                          served as before, with a note.
Offline self-test: python sham_tok_id.py
"""
from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path

GENERAL_PATH = Path(__file__).with_name("sham_general_tokenizer.json")
GENERAL = "general-v1"


def file_sha1(path) -> str:
    return hashlib.sha1(Path(path).read_bytes()).hexdigest()


def general_sha1() -> str | None:
    return file_sha1(GENERAL_PATH) if GENERAL_PATH.exists() else None


def tokenizer_sha1(tokenizer) -> str:
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "t.json"
        tokenizer.save(str(p))
        return file_sha1(p)


def stamp(tokenizer) -> dict:
    sha = tokenizer_sha1(tokenizer)
    return {"text_tokenizer": GENERAL if sha == general_sha1() else "custom", "text_tokenizer_sha1": sha}


def resolve(extra: dict | None, tokenizer_path) -> tuple[str, str]:
    extra = extra or {}
    want_sha, want_name = extra.get("text_tokenizer_sha1"), extra.get("text_tokenizer")
    have = file_sha1(tokenizer_path)
    if not want_sha and not want_name:
        return str(tokenizer_path), "unverified (checkpoint carries no tokenizer id)"
    if want_sha == have or (not want_sha and want_name == GENERAL and have == general_sha1()):
        return str(tokenizer_path), f"ok ({want_name or 'sha'} matches)"
    if want_name == GENERAL and general_sha1() and (not want_sha or want_sha == general_sha1()):
        return str(GENERAL_PATH), "the file beside the checkpoint is not the general tokenizer the checkpoint was trained with — using the general one"
    msg = f"text tokenizer mismatch: checkpoint expects {want_name or '?'} {str(want_sha)[:10]}, file is {have[:10]}"
    if os.environ.get("SHAM_ALLOW_TOKENIZER_MISMATCH") == "1":
        return str(tokenizer_path), "WARNING " + msg
    raise RuntimeError(msg + " — refusing to serve noise (SHAM_ALLOW_TOKENIZER_MISMATCH=1 overrides)")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as td:
        other = Path(td) / "other.json"
        other.write_text('{"not": "general"}', encoding="utf-8")
        g = general_sha1()
        assert g, "sham_general_tokenizer.json must sit beside this file"
        assert resolve({}, other)[1].startswith("unverified")
        assert resolve({"text_tokenizer": GENERAL, "text_tokenizer_sha1": g}, GENERAL_PATH)[0] == str(GENERAL_PATH)
        assert resolve({"text_tokenizer": GENERAL, "text_tokenizer_sha1": g}, other)[0] == str(GENERAL_PATH)       # repaired
        assert resolve({"text_tokenizer": GENERAL}, other)[0] == str(GENERAL_PATH)                               # old shim marker
        assert resolve({"text_tokenizer": "custom", "text_tokenizer_sha1": file_sha1(other)}, other)[0] == str(other)
        try:
            resolve({"text_tokenizer": "custom", "text_tokenizer_sha1": "0" * 40}, other)
            raise AssertionError("a mismatch must refuse")
        except RuntimeError:
            pass
        os.environ["SHAM_ALLOW_TOKENIZER_MISMATCH"] = "1"
        assert resolve({"text_tokenizer": "custom", "text_tokenizer_sha1": "0" * 40}, other)[1].startswith("WARNING")
        os.environ.pop("SHAM_ALLOW_TOKENIZER_MISMATCH")
        from text_tokenizer import ShamTextTokenizer
        st = stamp(ShamTextTokenizer.load(str(GENERAL_PATH)))
        assert st["text_tokenizer"] == GENERAL, st
    print("sham_tok_id self-test OK")
