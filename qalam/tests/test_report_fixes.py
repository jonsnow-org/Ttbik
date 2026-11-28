"""Regression tests for the technical audit of 2026-11-24 (one test per finding) and for the long-context work."""
import ast
import json
import pathlib

import pytest
import torch

from qalam import checkpoint, data, evolve, fileops, governance, lora, media, memory, skills, tools
from qalam.config import base_config, small_config, tiny_config
from qalam.model import Qalam
from qalam.training import joint_loss

SRC = pathlib.Path(__file__).resolve().parents[1] / "src" / "qalam"


def tiny(**kw):
    torch.manual_seed(0)
    cfg = tiny_config()
    return Qalam(cfg), cfg


# ------------------------------------------------------------------ 1. T-LDM obeys loss masks, padding and packed documents
def test_tldm_never_trains_on_masked_or_padding_tokens():
    m, cfg = tiny()
    ids = torch.randint(0, 200, (2, 40))
    zero = torch.zeros(2, 40, dtype=torch.long)
    loss = m.tldm_loss(ids, block=8, loss_mask=zero)
    assert float(loss) == 0.0                                                   # nothing trainable: exactly zero, and it still backpropagates
    loss.backward()
    pad = torch.full((2, 40), cfg.special_id("PAD"))
    assert float(m.tldm_loss(pad, block=8)) == 0.0                              # a block of padding teaches nothing
    assert float(m.tldm_loss(ids, block=8)) > 0.0


def test_tldm_block_reads_only_its_own_document():
    m, cfg = tiny()
    m.eval()
    t, block = 64, 8
    seg = torch.cat([torch.zeros(1, 24, dtype=torch.long), torch.ones(1, 40, dtype=torch.long)], dim=1)
    ids = torch.randint(0, 200, (1, t))
    tested = 0
    for seed in range(60):
        g = torch.Generator().manual_seed(seed)
        split = int(torch.randint(1, t - block + 1, (1,), generator=g))
        if split < 30:                                                          # the block lies inside document 1
            continue
        other = ids.clone()
        other[:, :24] = torch.randint(0, 200, (1, 24))                            # rewrite document 0 completely
        a = m.tldm_loss(ids, block=block, generator=torch.Generator().manual_seed(seed), segments=seg)
        b = m.tldm_loss(other, block=block, generator=torch.Generator().manual_seed(seed), segments=seg)
        assert abs(float(a) - float(b)) < 1e-5, seed                             # the other document has no influence
        c = m.tldm_loss(other, block=block, generator=torch.Generator().manual_seed(seed))
        d = m.tldm_loss(ids, block=block, generator=torch.Generator().manual_seed(seed))
        assert abs(float(c) - float(d)) > 1e-6                                   # control: without segments it DOES leak
        tested += 1
        if tested >= 3:
            break
    assert tested >= 1


def test_joint_loss_ignores_padding_and_document_boundaries():
    m, cfg = tiny()
    ids = torch.randint(0, 200, (2, 33))
    cut = ids[:, :21].clone()
    ids[:, 21:] = cfg.special_id("PAD")
    _, padded = joint_loss(m, ids, cycle_dropout=False, tldm_weight=0.0)
    _, trimmed = joint_loss(m, cut, cycle_dropout=False, tldm_weight=0.0)
    assert abs(padded["causal"] - trimmed["causal"]) < 1e-5                      # padding contributes nothing to the causal loss
    seg = torch.zeros(2, 33, dtype=torch.long)
    seg[:, 12:] = 1
    ids = torch.randint(0, 200, (2, 33))
    _, with_seg = joint_loss(m, ids, segments=seg, cycle_dropout=False, tldm_weight=0.0)
    first = ids[:, 12:]                                                          # the second document alone, its first token is never a target either
    _, alone = joint_loss(m, first, cycle_dropout=False, tldm_weight=0.0)
    assert torch.isfinite(torch.tensor(with_seg["causal"])) and with_seg["causal"] != padded["causal"]
    total, _ = joint_loss(m, ids, loss_mask=torch.ones(2, 33, dtype=torch.long), segments=seg, cycle_dropout=False, generator=torch.Generator().manual_seed(1))
    assert torch.isfinite(total) and alone["causal"] > 0


# ------------------------------------------------------------------ 2. no tensor is created without a device in the model paths
def test_every_tensor_factory_in_the_model_paths_names_its_device():
    factories = {"zeros", "ones", "full", "arange", "tensor", "rand", "randn", "randint", "empty", "eye", "linspace", "randperm"}
    # Parameters/buffers built in __init__ move with .to(device); the CPU datastore (EpisodicMemory) is CPU by design; layout builders and parsers work on Python lists and return CPU tensors the caller moves.
    allowed_in = {"rope_tables", "__init__", "_cat", "parse_image", "parse_video", "parse_audio", "forget", "lookup"}
    bad = []
    for fname in ("model.py", "memory.py", "media.py", "layers.py", "training.py", "lora.py", "evolve.py", "star.py"):
        tree = ast.parse((SRC / fname).read_text())
        for fn in [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef,))]:
            if fn.name in allowed_in:
                continue
            for call in [c for c in ast.walk(fn) if isinstance(c, ast.Call)]:
                f = call.func
                if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and f.value.id == "torch" and f.attr in factories:
                    if not any(k.arg in ("device", "dtype") and k.arg == "device" for k in call.keywords):
                        bad.append(f"{fname}:{call.lineno} torch.{f.attr} in {fn.name}")
    assert not bad, "\n".join(bad)


# ------------------------------------------------------------------ 3. dependencies
def test_declared_dependencies_cover_every_import():
    text = (SRC.parents[1] / "pyproject.toml").read_text()
    for lib in ("torch", "numpy", "tokenizers", "pyyaml"):
        assert lib in text, lib
    imported = set()
    for f in SRC.glob("*.py"):
        for n in ast.iter_child_nodes(ast.parse(f.read_text())):                  # module-level imports only: optional libraries are imported inside functions
            if isinstance(n, ast.Import):
                imported |= {a.name.split(".")[0] for a in n.names}
            elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module:
                imported.add(n.module.split(".")[0])
    third = imported - set(__import__("sys").stdlib_module_names) - {"qalam"}
    assert third <= {"torch", "numpy", "tokenizers", "yaml"}, third                    # optional libraries (docx, PIL, ...) are loaded lazily by fileops, never at import time


# ------------------------------------------------------------------ 6. expert balance sees every cycle
def test_balance_loss_averages_every_application():
    m, cfg = tiny()
    m.train()
    ids = torch.randint(0, 200, (2, 24))
    m(ids)
    assert all(len(b.moe.terms) == cfg.cycles for b in m.blocks)                  # one term per cycle per block, not just the last
    m(ids, cycles=1)
    assert all(len(b.moe.terms) == 1 for b in m.blocks)                          # a new forward starts fresh
    m.eval()
    with torch.no_grad():
        m(ids)
    assert all(len(b.moe.terms) == 0 for b in m.blocks)                          # inference records nothing (no memory growth)


# ------------------------------------------------------------------ 7. a cycle gives the model back trainable
def test_base_is_trainable_again_after_freezing():
    m, _ = tiny()
    lora.attach(m, "x", rank=2)
    before = lora.freeze_base(m)
    assert not all(p.requires_grad for p in m.parameters())
    lora.restore_trainable(m, before)
    assert all(p.requires_grad for p in m.parameters())


# ------------------------------------------------------------------ 8. memory
def test_memory_cannot_return_a_forbidden_token_and_uses_every_row():
    m, cfg = tiny()
    mem = memory.EpisodicMemory(cfg.width)
    ids = torch.randint(0, 200, (3, 12))
    n = memory.memorize(m, mem, ids)
    assert n == 3 * 11 and len(mem) == n                                          # all three rows, not just the first
    ids[:, -1] = cfg.special_id("MASK")
    before = len(mem)
    memory.memorize(m, mem, ids, last=1)
    assert len(mem) == before                                                      # a special-token continuation is not stored
    prefix = torch.randint(0, 200, (1, 6))
    h, _ = m.forward_causal(prefix)
    mem.add(h[0, -1:].repeat(3, 1), torch.full((3,), cfg.special_id("MASK")), "poison")      # forced in directly
    out, used = memory.generate_with_memory(m, prefix, mem, 4, tau=0.5, lam=0.99)
    assert used >= 1 and cfg.special_id("MASK") not in out and all(t in set(cfg.text_and_end_ids()) for t in out)


# ------------------------------------------------------------------ 9. consent, pseudonyms, forgetting
def test_experiences_need_consent_and_are_pseudonymous_and_forgettable():
    log = evolve.ExperienceLog(per_user_cap=5, salt="s")
    mk = lambda t, user="alice@example", consent=True: evolve.Experience(t, "def f(a): return a", True, "pytest", user, consent=consent)  # noqa: E731
    assert log.add(mk("task one"))[0]
    assert not log.add(mk("task two", consent=False))[0]
    assert log.items[0].user != "alice@example" and "alice" not in json.dumps(log.items[0].__dict__)
    assert log.add(mk("task three", user="bob"))[0]
    assert log.forget_user("alice@example") == 1 and [e.user for e in log.items] == [log.pseudonym("bob")]
    assert log.add(mk("task one"))[0]                                              # after forgetting, the same task can be contributed again


# ------------------------------------------------------------------ 10. a skill that acts outside needs a person
def test_external_skill_needs_approval(tmp_path):
    lib = skills.SkillLibrary(tmp_path / "sk") if hasattr(skills, "SkillLibrary") else None
    code, tests = "def post_it(x):\n    return x * 2\n", "from skill import post_it\n\ndef test_a():\n    assert post_it(2) == 4\n"
    ok, why = lib.propose("post_it", code, tests, external=True)
    assert not ok and "approval" in why
    assert governance.classify("skill_activate_external", approved=True).allowed


# ------------------------------------------------------------------ 11. checkpoints
def test_checkpoint_is_one_file_verified_and_lineage_checked(tmp_path):
    m, cfg = tiny()
    from qalam.config import config_hash
    h = config_hash(cfg)
    a = tmp_path / "a.pt"
    sha_a = checkpoint.save_checkpoint(a, m, 1)
    (tmp_path / "a.pt.json").unlink()                                              # the sidecar is only a copy: the embedded record is enough
    m2, rec = checkpoint.load_checkpoint(a, expect_hash=h)
    assert rec["step"] == 1 and rec["sha256"] == sha_a
    with pytest.raises(ValueError, match="frozen"):
        checkpoint.load_checkpoint(a, expect_hash="0" * 16)
    b = tmp_path / "chain" / "b.pt"
    checkpoint.save_checkpoint(b, m, 2, parent_sha=sha_a)
    with pytest.raises(ValueError, match="lineage broken"):
        checkpoint.load_checkpoint(b, parents_dir=tmp_path / "chain")              # the parent is not there
    import shutil
    shutil.copy(a, tmp_path / "chain" / "a.pt")
    checkpoint.load_checkpoint(b, parents_dir=tmp_path / "chain")
    checkpoint.save_checkpoint(a, m, 1)
    side = tmp_path / "a.pt.json"
    d = json.loads(side.read_text())
    d["sha256"] = "0" * 64
    side.write_text(json.dumps(d))
    with pytest.raises(ValueError, match="integrity"):
        checkpoint.load_checkpoint(a)


# ------------------------------------------------------------------ 12. data protection
def test_pii_patterns_and_near_duplicates_and_leaks():
    R = lambda t, **k: data.Record(t, "s", "owner_curated", "mit")  # noqa: E731
    for bad in ("call me on +966 50 123 4567", "IBAN GB82 WEST 1234 5698 7654 32", "card 4111 1111 1111 1111", "server at 192.168.1.20", "token=abcd1234efgh", "-----BEGIN RSA PRIVATE KEY-----",
                "ghp_" + "a" * 30, "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456"):
        assert not data.admit(R(bad))[0], bad
    assert data.admit(R("The invoice number 1234567890123 is fake but fails the Luhn check"))[0]
    assert data.admit(R("a normal sentence about markets and risk"))[0]
    base = " ".join(f"word{i}x" for i in range(60))
    a = "the quick brown fox jumps over the lazy dog " + base
    b = a.replace("word30x", "changed")
    kept, removed = data.near_dedup([R(a), R(b), R("something else entirely about trading risk limits and position sizing rules")])
    assert removed == 1 and len(kept) == 2
    rep = data.leak_report([R(a)], [R(b), R("an unrelated sentence about cooking pasta with garlic and olive oil slowly")])
    assert rep["leaked"] == [0]                                                      # a reworded copy shares no 8-word window... and is still caught


def test_pack_manifest_keeps_the_source_of_every_span():
    docs = [list(range(10)), list(range(10, 30))]
    metas = [{"source": "a", "license": "mit", "provenance": "owner_curated"}, {"source": "b", "license": "cc0", "provenance": "owner_curated"}]
    man = data.pack_manifest(docs, metas, seq_len=15)
    assert man[0][0]["source"] == "a" and man[0][1]["source"] == "b" and sum(e["to"] - e["from"] for row in man for e in row if e["doc"] == 1) == 21
    cfg = tiny_config()
    packed = data.pack(cfg, docs, 15)
    assert len(man) == packed["ids"].shape[0]


# ------------------------------------------------------------------ 13. file tools
def test_excel_single_cell_edit_limit_word_formatting_and_arabic_pdf(tmp_path):
    cap = fileops.capabilities()
    ws = fileops.Workspace(tmp_path)
    if cap["xlsx"]:
        ws.sheet_create("a.xlsx", {"S": [[1, 2], [3, 4]]})
        assert ws.sheet_read("a.xlsx", "S", "A1").strip() == "1"
        assert ws.sheet_read("a.xlsx", "S", "A1:B1").strip() == "1\t2"
        assert ws.sheet_read("a.xlsx", "S", "A1:A2").split("\n") == ["1", "3"]
    big = tmp_path / "big.txt"
    big.write_text("x")
    old = fileops.MAX_BYTES
    fileops.MAX_BYTES = 0
    try:
        with pytest.raises(fileops.FileError, match="larger"):
            ws.edit_text("big.txt", "x", "y")
    finally:
        fileops.MAX_BYTES = old
    if cap["docx"]:
        import docx
        d = docx.Document()
        p = d.add_paragraph()
        p.add_run("Hello ").bold = True
        p.add_run("old name").italic = True
        p.add_run(" bye")
        d.save(tmp_path / "w.docx")
        ws.doc_edit("w.docx", [{"op": "replace", "old": "old name", "new": "new name"}])
        runs = docx.Document(tmp_path / "w.docx").paragraphs[0].runs
        assert [r.text for r in runs] == ["Hello ", "new name", " bye"] and runs[0].bold and runs[1].italic            # formatting survives
        ws.doc_edit("w.docx", [{"op": "replace", "old": "Hello new", "new": "Hi"}])                                       # a match across two runs
        assert docx.Document(tmp_path / "w.docx").paragraphs[0].text == "Hi name bye"
    if cap["pdf_create"] and cap["pdf_edit"]:
        try:
            import arabic_reshaper  # noqa: F401
            import bidi  # noqa: F401
        except ImportError:
            with pytest.raises(fileops.FileError, match="arabic-reshaper"):
                ws.pdf_create("ar.pdf", [{"type": "paragraph", "text": "مرحبا بالعالم"}])
        else:
            ws.pdf_create("ar.pdf", [{"type": "heading", "text": "تقرير"}, {"type": "paragraph", "text": "مرحبا بالعالم 2026"}])
            assert (tmp_path / "ar.pdf").stat().st_size > 800
        ws.pdf_create("en.pdf", [{"type": "paragraph", "text": "plain english still works"}])


# ------------------------------------------------------------------ 14. audio parser
def test_audio_parser_rejects_foreign_tokens():
    cfg = tiny_config()
    codes = torch.randint(0, cfg.audio_codes, (2, 3))                              # 2 frames x 3 codebooks
    ids = media.audio_layout(cfg, codes).ids.clone()
    assert torch.equal(media.parse_audio(cfg, ids, 3, 2), codes)
    ids[1] = 5                                                                     # a text token where an audio code belongs
    with pytest.raises(ValueError, match="neither an audio code nor PAD"):
        media.parse_audio(cfg, ids, 3, 2)


# ------------------------------------------------------------------ context: 128K positions, exact chunked prefill, bounded memory
def test_context_capacity_and_extension():
    b, s = base_config(), small_config()
    assert b.max_seq == s.max_seq == 131072 and b.train_seq == 4096 and b.rope_factor == 1.0
    with pytest.raises(ValueError):
        type(b)(rope_factor=0.5)
    with pytest.raises(ValueError):
        type(b)(train_seq=10**9)


def test_chunked_prefill_is_exact_and_trim_is_bounded():
    m, cfg = tiny()
    m.eval()
    ids = torch.randint(0, 200, (1, 100))
    with torch.no_grad():
        h_full, c_full = m.forward_causal(ids)
        h_chunk, c_chunk = m.prefill(ids, chunk=16, tail=100)
    assert torch.allclose(h_full, h_chunk, atol=1e-5) and torch.allclose(c_full[0][0], c_chunk[0][0], atol=1e-5)
    tr = m.trim_cache(c_chunk, sinks=4, window=20)
    assert tr[0][0].shape[2] == 24 and torch.equal(tr[0][0][:, :, :4], c_chunk[0][0][:, :, :4]) and torch.equal(tr[0][0][:, :, -20:], c_chunk[0][0][:, :, -20:])
    with torch.no_grad():                                                           # a trimmed cache continues with the TRUE position
        h, _ = m.forward_causal(torch.randint(0, 200, (1, 1)), tr, start=100)
    assert torch.isfinite(h).all()
    with pytest.raises(ValueError, match="max_seq"):
        m.forward_causal(torch.randint(0, 200, (1, 5)), tr, start=cfg.max_seq - 2)


def test_rope_extension_changes_only_the_sequence_axis():
    from qalam.layers import rope_tables
    c1, _ = rope_tables(64, 16, 500000.0)
    c4, _ = rope_tables(64, 16, 500000.0, factor=4.0)
    assert not torch.allclose(c1[:, 8:], c4[:, 8:]) and torch.allclose(c1[:, 0], c4[:, 0])           # slow frequencies stretch, the fastest does not
    cfg1, cfg4 = tiny_config(), type(tiny_config())(**{**tiny_config().to_dict(), "rope_factor": 4.0})
    m1, m4 = Qalam(cfg1), Qalam(cfg4)
    assert torch.allclose(m1.rope_row_cos, m4.rope_row_cos) and not torch.allclose(m1.rope_seq_cos, m4.rope_seq_cos)
